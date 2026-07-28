// E2E: an unresolvable `@gjsify/*` edge must FAIL the build, not be silently
// externalised (repo task #63).
//
// The fixture project lives in `mkdtemp` — OUTSIDE the gjsify checkout — so
// there is no `node_modules` anywhere up its parent chain and every `@gjsify/*`
// alias target is unresolvable. That is the same condition that produced the
// broken committed `cli.gjs.mjs`: a worktree whose `@gjsify/*` links pointed at
// source-only packages with no built `lib/`, so `exports["."]` named a file that
// does not exist.
//
// Before the fix, all four cases below exited 0 and wrote a bundle that
// re-imported the ORIGINAL bare specifier — unloadable on the target it was
// built for. The `--app gjs` + `node:` case additionally trips the emit-time
// `gjs-bundle-guard` (PR #828); the other three had NOTHING watching them.
//
// No workspace tarballs are packed (unlike most e2e suites here): the CLI's own
// Node entry is invoked straight out of the checkout, so this suite is cheap and
// parallel-safe.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MONOREPO_ROOT } from '../helpers.mjs';

const CLI = join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'lib', 'index.js');

let projectDir;

/** Run `gjsify build` in the fixture; never throws. */
function build(entry, app, outfile) {
    const res = spawnSync('node', [CLI, 'build', `src/${entry}`, '--app', app, '--outfile', `dist/${outfile}`], {
        cwd: projectDir,
        encoding: 'utf8',
        timeout: 5 * 60 * 1000,
        env: { ...process.env, GJSIFY_BUILD_CACHE: '0' },
    });
    return {
        status: res.status,
        output: `${res.stdout ?? ''}${res.stderr ?? ''}`,
        bundle: join(projectDir, 'dist', outfile),
    };
}

describe('Unresolvable @gjsify/* workspace import E2E', { timeout: 10 * 60 * 1000 }, () => {
    before(() => {
        assert.ok(existsSync(CLI), `CLI entry not built: ${CLI} (run \`gjsify run build:infra\`)`);
        projectDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-unresolved-workspace-'));
        mkdirSync(join(projectDir, 'src'), { recursive: true });
        writeFileSync(
            join(projectDir, 'package.json'),
            JSON.stringify({ name: 'unresolved-fixture', version: '0.0.0', type: 'module', private: true }, null, 2),
        );
        // (1) a Node builtin — the substitution table promises `@gjsify/fs`.
        writeFileSync(
            join(projectDir, 'src', 'builtin.ts'),
            `import { readFileSync } from 'node:fs';\nexport const read = (p: string): string => readFileSync(p, 'utf8');\n`,
        );
        // (2) a DIRECT `@gjsify/*` workspace edge — the shape task #63 names.
        writeFileSync(
            join(projectDir, 'src', 'workspace.ts'),
            `import { Readable } from '@gjsify/stream';\nexport const make = (): unknown => new Readable();\n`,
        );
        // (3) control: nothing to substitute, nothing to resolve.
        writeFileSync(join(projectDir, 'src', 'pure.ts'), `export const add = (a: number, b: number) => a + b;\n`);
    });

    after(() => {
        if (projectDir && !process.env.GJSIFY_E2E_KEEP_TEMP) rmSync(projectDir, { recursive: true, force: true });
    });

    // Which `@gjsify/*` package a given specifier routes to is the alias
    // table's business and differs per target (`node:fs` is `@gjsify/fs` on
    // gjs but `@gjsify/empty` on browser), so only the SHAPE is asserted here —
    // pinning the exact target would make this suite a change-detector for the
    // slot tables. The gjs+`node:` case below adds the specific assertion,
    // because that one IS the reported failure.
    for (const [app, entry, outfile] of [
        ['gjs', 'builtin.ts', 'builtin.gjs.mjs'],
        ['browser', 'builtin.ts', 'builtin.browser.mjs'],
        ['node', 'workspace.ts', 'workspace.node.mjs'],
        ['gjs', 'workspace.ts', 'workspace.gjs.mjs'],
    ]) {
        it(`--app ${app}: refuses to externalise an unresolvable @gjsify/* edge (${entry})`, () => {
            const { status, output, bundle } = build(entry, app, outfile);
            assert.notEqual(status, 0, `build should have failed, but exited 0.\n${output}`);
            // The message must name the missing edge, the importer and a cause.
            assert.match(output, /cannot resolve[^\n]*@gjsify\//, output);
            assert.match(output, /imported by:.*src[/\\]/, output);
            assert.match(output, /gjsify install/, output);
            assert.ok(!existsSync(bundle), `a broken bundle was still written to ${bundle}`);
        });
    }

    it('--app gjs: names the @gjsify/fs substitution and the GJS load symptom for node:fs', () => {
        // The verbatim reported failure: without the guard this build emitted a
        // bundle whose `node:fs` survived, and stock GJS aborted the whole
        // module graph with `ImportError: Unsupported URI scheme for importing: node`.
        const { status, output } = build('builtin.ts', 'gjs', 'builtin.named.gjs.mjs');
        assert.notEqual(status, 0, output);
        assert.match(output, /@gjsify\/fs/, output);
        assert.match(output, /node:fs/, output);
        assert.match(output, /Unsupported URI scheme for importing: node/, output);
    });

    it('a build with no @gjsify/* edge is unaffected', () => {
        const { status, output, bundle } = build('pure.ts', 'gjs', 'pure.gjs.mjs');
        assert.equal(status, 0, output);
        assert.ok(existsSync(bundle), `expected a bundle at ${bundle}\n${output}`);
        const code = readFileSync(bundle, 'utf8');
        assert.ok(code.length > 0);
    });
});
