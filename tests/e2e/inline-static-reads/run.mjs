// E2E test for the rewriter's static-read inlining.
//
// Verifies that bundles produced by `gjsify build` are portable across
// filesystem layouts (gjsify dlx cache, manual moves, CI artifact downloads)
// because static `readFileSync(new URL(...), "utf8")` patterns are evaluated
// at build time and replaced with literal contents.
//
// The test fixture is a tiny `node_modules/@fixture/reads-via-url` package
// whose entry reads its own `package.json` via `import.meta.url`. Without
// inlining, the bundle would crash with ENOENT from any location other than
// the build site. With inlining, the bundle prints the embedded value and
// runs from any directory.
//
// A SECOND fixture covers what the first structurally cannot: a FIRST-PARTY
// TypeScript source. Until 2026-08-22 the inliner was gated on `node_modules`
// and parsed with plain acorn, and this suite could see neither limitation —
// an installed package ships JS, and the gate let it through. What that cost:
// every static read in @gjsify/cli's own sources shipped LIVE into
// `dist/cli.gjs.mjs`, so `gjs -m dist/cli.gjs.mjs ship --stage` died with ENOENT
// on `templates/app/desktop.tmpl` while the identical command through
// `lib/index.js` staged it fine. A fixture that only exercises the covered path
// reports on the covered path.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync, cpSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { createTestEnvironment, cleanupTestEnvironment, setupProject, hasCommand } from '../helpers.mjs';

/**
 * Drop a tiny `node_modules/@fixture/reads-via-url` package that exercises
 * the inliner: `readFileSync(new URL("./data.json", import.meta.url), "utf8")`
 * + `JSON.parse(readFileSync(new URL("./package.json", ...), "utf8"))`.
 */
function createFixture(projectDir) {
    const pkgDir = join(projectDir, 'node_modules', '@fixture', 'reads-via-url');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
        join(pkgDir, 'package.json'),
        JSON.stringify(
            {
                name: '@fixture/reads-via-url',
                version: '4.2.0',
                type: 'module',
                main: './index.js',
                exports: { '.': './index.js' },
            },
            null,
            2,
        ),
    );
    writeFileSync(join(pkgDir, 'data.json'), JSON.stringify({ secret: 'inlined-at-build-time' }) + '\n');
    writeFileSync(
        join(pkgDir, 'index.js'),
        `import { readFileSync } from 'node:fs';\n` +
            `\n` +
            `// Inliner pattern A: readFileSync(new URL(<lit>, import.meta.url), "utf8")\n` +
            `const dataText = readFileSync(new URL("./data.json", import.meta.url), "utf8");\n` +
            `const data = JSON.parse(dataText);\n` +
            `\n` +
            `// Inliner pattern B: JSON.parse(readFileSync(new URL(<lit>, import.meta.url), "utf8"))\n` +
            `const pkg = JSON.parse(\n` +
            `  readFileSync(new URL("./package.json", import.meta.url), "utf8")\n` +
            `);\n` +
            `\n` +
            `export function getReport() {\n` +
            `  return data.secret + ":" + pkg.name + "@" + pkg.version;\n` +
            `}\n`,
    );
}

describe('Inline static reads E2E', { timeout: 10 * 60 * 1000 }, () => {
    let tmpDir;
    let tarballsDir;
    let tarballMap;
    let projectDir;

    before(() => {
        const env = createTestEnvironment('gjsify-e2e-inline-static-reads-');
        tmpDir = env.tmpDir;
        tarballsDir = env.tarballsDir;
        tarballMap = env.tarballMap;

        projectDir = join(tmpDir, 'project');
        mkdirSync(join(projectDir, 'src'), { recursive: true });

        setupProject(
            projectDir,
            {
                name: 'test-inline-static-reads',
                version: '0.1.0',
                type: 'module',
                private: true,
                dependencies: {
                    '@gjsify/cli': '^0.1.0',
                },
            },
            tarballsDir,
            tarballMap,
        );

        createFixture(projectDir);

        writeFileSync(
            join(projectDir, 'src', 'app.ts'),
            `import { getReport } from '@fixture/reads-via-url';\n` + `console.log('OK:' + getReport());\n`,
        );
    });

    after(() => {
        cleanupTestEnvironment(tmpDir);
    });

    it('bundle inlines static readFileSync calls and stays portable', () => {
        const outDir = join(projectDir, 'dist');
        mkdirSync(outDir, { recursive: true });
        const bundlePath = join(outDir, 'app.js');
        // --no-minify: this test asserts inlined fixture content via substring
        // matches against object-literal property names. With the default-on
        // minifier those names get mangled and the asserts can't survive.
        execFileSync(
            'npx',
            ['gjsify', 'build', 'src/app.ts', '--app', 'node', '--outfile', bundlePath, '--no-minify'],
            { cwd: projectDir, stdio: 'pipe', timeout: 60 * 1000 },
        );

        assert.ok(existsSync(bundlePath), 'bundle missing');

        const bundle = readFileSync(bundlePath, 'utf-8');
        // The fixture's literal data string should appear in the bundle source —
        // proving the read was evaluated at build time.
        assert.ok(
            bundle.includes('inlined-at-build-time'),
            'bundle does not contain the fixture data — inliner did not fire',
        );
        assert.ok(
            bundle.includes('"@fixture/reads-via-url"') || bundle.includes(`"name":"@fixture/reads-via-url"`),
            'bundle does not contain the fixture package.json — JSON.parse pattern did not fire',
        );

        // Bundle should NOT contain a runtime call to readFileSync against the
        // fixture's URL (proves the inlining replaced the call rather than just
        // rewriting the URL).
        assert.ok(
            !/readFileSync\(\s*new URL\(\s*["']\.\/(data\.json|package\.json)["']/m.test(bundle),
            'bundle still has a runtime readFileSync(new URL("./data.json"|"./package.json")) call',
        );

        if (!hasCommand('node')) return;

        // Run from build location.
        const out1 = execFileSync('node', [bundlePath], { stdio: 'pipe', timeout: 30 * 1000 }).toString();
        assert.match(
            out1,
            /^OK:inlined-at-build-time:@fixture\/reads-via-url@4\.2\.0/,
            `bundle produced unexpected output. Got: ${out1}`,
        );

        // Move the entire bundle and re-run — proves the bundle no longer
        // depends on `node_modules/@fixture/reads-via-url/` existing in any
        // particular relative location.
        const movedDir = join(projectDir, 'moved');
        cpSync(outDir, movedDir, { recursive: true });
        const out2 = execFileSync('node', [join(movedDir, 'app.js')], { stdio: 'pipe', timeout: 30 * 1000 }).toString();
        assert.match(
            out2,
            /^OK:inlined-at-build-time:@fixture\/reads-via-url@4\.2\.0/,
            `moved bundle failed — bundle is not self-contained. Got: ${out2}`,
        );

        // Even from a path that doesn't have node_modules anywhere upward.
        const isolatedDir = '/tmp/gjsify-inline-isolated-' + Date.now();
        mkdirSync(isolatedDir, { recursive: true });
        cpSync(bundlePath, join(isolatedDir, 'app.js'));
        const out3 = execFileSync('node', [join(isolatedDir, 'app.js')], {
            stdio: 'pipe',
            timeout: 30 * 1000,
        }).toString();
        assert.match(
            out3,
            /^OK:inlined-at-build-time:@fixture\/reads-via-url@4\.2\.0/,
            `bundle in isolated dir failed — bundle is not self-contained. Got: ${out3}`,
        );
        rmSync(isolatedDir, { recursive: true, force: true });
        rmSync(movedDir, { recursive: true, force: true });
    });

    // The case the fixture above cannot reach: the source is first-party AND it
    // is TypeScript, so it fails BOTH of the limitations this suite used to be
    // blind to. Deleting the read's target before running is the discriminator —
    // a bundle that still reads at runtime cannot pass, and without the deletion
    // a live read would find the file and the test would be green having proven
    // nothing.
    it('inlines a static read from a first-party TypeScript source', () => {
        const srcDir = join(projectDir, 'src');
        writeFileSync(join(srcDir, 'greeting.txt'), 'first-party-inlined\n');
        writeFileSync(
            join(srcDir, 'first-party.ts'),
            `import { readFileSync } from 'node:fs';\n` +
                // A type annotation and an interface: the syntax that made the
                // parser throw, which the catch then reported as "nothing to inline".
                `interface Unused { readonly a: string }\n` +
                `const greeting: string = readFileSync(new URL('./greeting.txt', import.meta.url), 'utf-8');\n` +
                `console.log('FP:' + greeting.trim());\n`,
        );

        const bundlePath = join(projectDir, 'dist', 'first-party.js');
        execFileSync(
            'npx',
            ['gjsify', 'build', 'src/first-party.ts', '--app', 'node', '--outfile', bundlePath, '--no-minify'],
            { cwd: projectDir, stdio: 'pipe', timeout: 60 * 1000 },
        );

        const bundle = readFileSync(bundlePath, 'utf-8');
        assert.ok(
            bundle.includes('first-party-inlined'),
            'bundle does not carry the template text — the inliner never saw the TypeScript source',
        );
        assert.ok(
            !/readFileSync\(\s*new URL\(\s*["']\.\/greeting\.txt["']/m.test(bundle),
            'bundle still reads greeting.txt at runtime — the call was repointed, not replaced',
        );

        if (!hasCommand('node')) return;

        // Remove the file the read pointed at, then run the bundle from a
        // directory with no project above it. Both halves matter: the deletion
        // makes a surviving read fail, the isolation makes a surviving relative
        // path fail.
        rmSync(join(srcDir, 'greeting.txt'), { force: true });
        const isolated = join('/tmp', `gjsify-inline-first-party-${Date.now()}`);
        mkdirSync(isolated, { recursive: true });
        cpSync(bundlePath, join(isolated, 'app.js'));
        const out = execFileSync('node', [join(isolated, 'app.js')], {
            stdio: 'pipe',
            timeout: 30 * 1000,
        }).toString();
        assert.match(out, /^FP:first-party-inlined/, `first-party bundle failed. Got: ${out}`);
        rmSync(isolated, { recursive: true, force: true });
    });
});
