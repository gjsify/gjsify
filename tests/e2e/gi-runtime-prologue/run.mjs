// E2E: the byte-1 GI runtime-path prologue actually reaches a `--app gjs` bundle.
//
// THE DEFECT THIS PINS. The prologue was built across three PRs (#1152 the generator,
// #1160 the system-libdir rule, #1026 the in-process activation it mirrors) and then
// wired to nothing: `app/gjs.ts` called `processStubPlugin({…})` with two options,
// neither of them the paths, and `giRuntimePathsStub` returns `''` for an empty list
// BY DESIGN — so every bundle ever built emitted an empty prologue while every unit
// test of the generator stayed green. Only a real build can see that, which is why
// this suite asserts on the BUNDLE.
//
// What it repairs: on macOS a typelib names its library by bare leaf, and SIP strips
// an inherited `DYLD_*` at the `/bin/sh` exec a launcher goes through, so nothing
// OUTSIDE the process can point GI at Homebrew's prefix. What it does NOT reach is
// measured here too (`a byte-1 banner and the module graph`): ESM evaluates imports
// before the body, so a static `import … from 'gi://Ns'` has already loaded its
// typelib. Both, with the macOS numbers: `status/open-todos.md` § "A globally
// installed GJS launcher still cannot load a system GTK on macOS".
//
// The runtime leg deletes GI_TYPELIB_PATH and the loader-path variables rather than
// leaving them unset, so it cannot pass by inheriting a developer shell.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { MONOREPO_ROOT } from '../helpers.mjs';
import { runCli } from '../mock-registry.mjs';

const CLI_ENTRY = join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'lib', 'index.js');

/**
 * The candidates `giSystemProbes()` puts in every bundle — READ FROM THE TABLE, never
 * restated. A copy here would keep passing after someone edits the prefixes, which is
 * exactly the drift this suite is supposed to catch.
 */
const PROBED_DIRS = (() => {
    const src = readFileSync(join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'src', 'utils', 'system-gi.ts'), 'utf-8');
    const table = /PROBED_GI_LIBDIRS[^=]*=\s*\{([\s\S]*?)\n\};/.exec(src);
    if (!table) throw new Error('[gi-runtime-prologue] could not read PROBED_GI_LIBDIRS from system-gi.ts');
    const dirs = [...table[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    if (dirs.length === 0) throw new Error('[gi-runtime-prologue] PROBED_GI_LIBDIRS parsed to an empty list');
    return dirs;
})();

/**
 * The platform gate the same generator puts in front of those candidates — read from
 * the CLI source for the same reason as the table above. A copy here would keep
 * passing after someone changes or drops the gate, which is what would put
 * `/usr/local/lib` ahead of the distro's GI stack on every Linux host that has one.
 */
const HOST_MARKER = (() => {
    const src = readFileSync(
        join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'src', 'utils', 'gi-runtime-paths.ts'),
        'utf-8',
    );
    const table = /HOST_MARKERS[^=]*=\s*\{([\s\S]*?)\n\};/.exec(src);
    if (!table) throw new Error('[gi-runtime-prologue] could not read HOST_MARKERS from gi-runtime-paths.ts');
    const markers = [...table[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    // One platform in the table, one gate here. A second one makes "which candidate
    // belongs to this host" a per-candidate question, and the runtime leg below would
    // silently expect the wrong side of it — so widen this suite deliberately.
    if (markers.length !== 1) {
        throw new Error(`[gi-runtime-prologue] HOST_MARKERS names ${markers.length} platforms; this suite reads one`);
    }
    return markers[0];
})();

/** A string only the fixture's own code can contain, so "is the banner ahead of it" is decidable. */
const APP_MARKER = 'gi-prologue-fixture-ran';

function hasGjs() {
    const r = spawnSync('gjs', ['--version'], { stdio: 'ignore' });
    return r.status === 0 && r.error === undefined;
}

describe('the GI runtime-path prologue in a --app gjs bundle', { timeout: 5 * 60 * 1000 }, () => {
    let projectDir;
    let bundle;

    before(async () => {
        // THROWS rather than skips, like `build-watch` and `flatpak-sync` beside it: a
        // suite that exists because a generator was wired to nothing, and whose unit
        // tests stayed green through the whole defect, is the last one that may report
        // green having measured nothing.
        if (!existsSync(CLI_ENTRY)) {
            throw new Error(`CLI entry not built: ${CLI_ENTRY} — run \`gjsify workspace @gjsify/cli run build\``);
        }
        projectDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-gi-prologue-'));
        mkdirSync(join(projectDir, 'src'), { recursive: true });
        writeFileSync(
            join(projectDir, 'package.json'),
            JSON.stringify({ name: 'gi-prologue-fixture', version: '0.0.0', private: true, type: 'module' }, null, 2) +
                '\n',
        );
        // `globalThis.imports`, never a bare `imports`: the same TDZ rule the banner
        // itself follows. The app prints the repository's search path so the runtime
        // leg can assert on what the prologue DID, not just that it survived.
        writeFileSync(
            join(projectDir, 'src', 'app.ts'),
            [
                `const host = globalThis as unknown as { imports: any };`,
                `const repo = host.imports.gi.GIRepository.Repository.dup_default();`,
                `console.log('${APP_MARKER}:' + repo.get_search_path().join(':'));`,
                '',
            ].join('\n'),
        );

        const built = await runCli(CLI_ENTRY, ['build', 'src/app.ts', '--app', 'gjs', '--outfile', 'dist/app.js'], {
            cwd: projectDir,
            env: process.env,
            timeoutMs: 4 * 60 * 1000,
        });
        assert.equal(built.status, 0, `gjsify build failed:\n${built.stdout}\n${built.stderr}`);
        bundle = readFileSync(join(projectDir, 'dist', 'app.js'), 'utf-8');
    });

    after(() => {
        if (projectDir) rmSync(projectDir, { recursive: true, force: true });
    });

    it('emits a prologue at all', () => {
        // The whole defect in one assertion: before the wiring, both of these were
        // absent from every bundle this repo has ever produced.
        assert.ok(bundle.includes('prepend_search_path'), 'no typelib search-path prepend in the bundle');
        assert.ok(bundle.includes('prepend_library_path'), 'no library-path prepend in the bundle');
    });

    it('runs it BEFORE the bundle it prefixes', () => {
        // A prologue after the program has started is a prologue that runs after the
        // first `gi://` import has already failed.
        const banner = bundle.indexOf('prepend_search_path');
        const app = bundle.indexOf(APP_MARKER);
        assert.ok(app > -1, 'the fixture code is not in its own bundle');
        // Checked before the comparison: an ABSENT prologue is index -1, which would
        // satisfy `banner < app` and turn this into a test that cannot fail.
        assert.ok(banner > -1, 'no prologue in the bundle');
        assert.ok(banner < app, `prologue at ${banner} is not ahead of the app code at ${app}`);
    });

    it('carries every system candidate with its girepository-1.0 marker', () => {
        for (const dir of PROBED_DIRS) {
            assert.ok(bundle.includes(dir), `candidate ${dir} missing from the bundle`);
            assert.ok(bundle.includes(`${dir}/girepository-1.0`), `marker for ${dir} missing from the bundle`);
        }
        // Probed, not prepended blind: an unconditional prepend of a LIBRARY path can
        // shadow a correctly resolved library process-wide on a host that has the
        // directory for unrelated reasons.
        assert.ok(bundle.includes('file_test'), 'candidates are not probed on the running host');
        assert.ok(bundle.includes('FileTest.IS_DIR'), 'the probe does not test for a directory');
    });

    it('gates them on the host the candidates belong to', () => {
        // The candidates are macOS prefixes, and `/usr/local/lib/girepository-1.0` is a
        // normal shape on Linux (`meson setup --prefix=/usr/local`, jhbuild). Without
        // this gate every such host would get it prepended ahead of the distro's
        // typelibs and libraries — ADR 0023 § 4, #910.
        assert.ok(bundle.includes(HOST_MARKER), `the host marker ${HOST_MARKER} is not in the bundle`);
        assert.ok(bundle.includes('FileTest.EXISTS'), 'the host marker is not tested for existence');
    });

    it('bakes no path that belongs to the build machine', () => {
        // A shipped bundle runs where the build tree does not exist. This is the
        // decision that keeps `dist/affected.gjs.mjs` — itself a `--app gjs` bundle
        // that `scripts/verify-committed-bundles.mjs` rebuilds and compares byte for
        // byte — reproducible on a host with different platform siblings installed.
        const prologue = bundle.slice(0, bundle.indexOf(APP_MARKER));
        assert.ok(!prologue.includes(projectDir), 'the build directory is baked into the bundle');
        assert.ok(!prologue.includes(MONOREPO_ROOT), 'the build tree is baked into the bundle');
        assert.ok(!prologue.includes('node_modules/@gjsify/'), 'a build-tree prebuild path is baked into the bundle');
    });

    describe(
        'under a bare `gjs -m`, with no launcher and no GI environment',
        { skip: hasGjs() ? false : 'no gjs on PATH' },
        () => {
            let output;

            before(() => {
                // DELETED, not left unset: inheriting a developer shell that happens to
                // carry them would let this pass on a tree where the prologue is broken.
                const env = { ...process.env };
                delete env.GI_TYPELIB_PATH;
                delete env.LD_LIBRARY_PATH;
                delete env.DYLD_LIBRARY_PATH;
                delete env.DYLD_FALLBACK_LIBRARY_PATH;
                const run = spawnSync('gjs', ['-m', join(projectDir, 'dist', 'app.js')], {
                    cwd: projectDir,
                    encoding: 'utf-8',
                    env,
                    timeout: 60 * 1000,
                });
                assert.equal(run.status, 0, `the bundle did not run:\n${run.stdout}\n${run.stderr}`);
                const line = run.stdout.split('\n').find((l) => l.startsWith(`${APP_MARKER}:`));
                assert.ok(line, `no marker line in:\n${run.stdout}`);
                output = line
                    .slice(APP_MARKER.length + 1)
                    .split(':')
                    .filter(Boolean);
            });

            it('leaves the program running rather than throwing at byte 1', () => {
                // `assert` in `before` already failed the run on a non-zero exit; this
                // states what that proves, since the byte-1 throw is the failure mode the
                // wrapped namespace load exists for.
                assert.ok(output.length > 0, 'the repository reported no search path at all');
            });

            it('prepends exactly the candidates this host actually has', () => {
                // Non-vacuous in both directions: a candidate the host lacks must be
                // ABSENT (the marker gate works) and one it has must be PRESENT (the
                // prepend happened). Which side each candidate lands on is the host's
                // fact, so the expectation is measured here, not assumed — INCLUDING the
                // platform gate, so a Linux runner with a /usr/local GI stack fails this
                // if the candidate is prepended anyway.
                const isThisHost = existsSync(HOST_MARKER);
                for (const dir of PROBED_DIRS) {
                    const expected = isThisHost && existsSync(`${dir}/girepository-1.0`);
                    assert.equal(
                        output.includes(dir),
                        expected,
                        expected
                            ? `${dir} has a girepository-1.0 and was not prepended`
                            : `${dir} is not this host's candidate and was prepended anyway`,
                    );
                }
            });
        },
    );

    // Not about the bundler: about the host semantics the banner's PLACEMENT rests on.
    // Written as two plain files so the claim is readable without a build in the way.
    describe('a byte-1 banner and the module graph', { skip: hasGjs() ? false : 'no gjs on PATH' }, () => {
        it('runs AFTER every static gi:// import of the module it prefixes', () => {
            // The bundle's exact shape: banner text first, external `gi://` import
            // after it. If GJS ever evaluated the body first, the marker would print
            // before the failure and this prologue would cover the static case too.
            const dir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-gi-order-'));
            try {
                writeFileSync(
                    join(dir, 'entry.js'),
                    `(function(){globalThis.print('BANNER RAN')})();\nimport 'gi://NoSuchNamespaceForThisTest?version=1.0';\n`,
                );
                const run = spawnSync('gjs', ['-m', join(dir, 'entry.js')], { encoding: 'utf-8', timeout: 60 * 1000 });
                assert.match(
                    run.stderr,
                    /NoSuchNamespaceForThisTest/,
                    `expected the typelib to be missing:\n${run.stderr}`,
                );
                assert.ok(!run.stdout.includes('BANNER RAN'), `the banner ran before the import:\n${run.stdout}`);
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });

        it('runs BEFORE anything the body loads, which is what it repairs', () => {
            // The other half of the same measurement, and the reason the mechanism is
            // worth having: `await import('gi://\u2026')` is the established gjsify shape
            // for an optional namespace (`@gjsify/fetch`'s Soup, `@gjsify/gamepad`'s
            // Manette) \u2014 exactly the libraries a macOS host keeps in a prefix GI cannot
            // find on its own.
            const dir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-gi-order-'));
            try {
                writeFileSync(
                    join(dir, 'entry.js'),
                    `(function(){globalThis.print('BANNER RAN')})();\nawait import('gi://NoSuchNamespaceForThisTest?version=1.0');\n`,
                );
                const run = spawnSync('gjs', ['-m', join(dir, 'entry.js')], { encoding: 'utf-8', timeout: 60 * 1000 });
                assert.ok(
                    run.stdout.includes('BANNER RAN'),
                    `the banner did not run first:\n${run.stdout}\n${run.stderr}`,
                );
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });
    });

    // ── the ICU gap the banner covers ─────────────────────────────────────
    //
    // `Intl.Segmenter` is missing from GJS builds whose ICU was trimmed. Not a
    // version story: measured on `ubuntu-latest` with **gjs 1.88.1**, the SAME
    // version as the Fedora container where it is present. A `.deb` declaring
    // `Depends: gjs >= 1.82` therefore installs there and the program dies at
    // startup — which is how this was found, by the first CI leg that handed a
    // package to a real `dpkg`.
    //
    // Reached through the argument parser, so it is every command and no
    // application code: `yargs@18` -> `string-width@7` -> `get-east-asian-width`
    // constructs one AT MODULE SCOPE, before anything can intervene.
    describe('on a GJS whose ICU carries no Intl.Segmenter', { skip: hasGjs() ? false : 'no gjs on PATH' }, () => {
        let run;

        before(() => {
            // Deleting it in a wrapper is the only way to reach that host's
            // condition from one that has it — and it is exactly what the failing
            // runner presents to the bundle.
            const wrapper = join(projectDir, 'no-segmenter.mjs');
            const bundleUrl = pathToFileURL(join(projectDir, 'dist', 'app.js')).href;
            writeFileSync(
                wrapper,
                [
                    'delete Intl.Segmenter;',
                    "if (typeof Intl.Segmenter === 'function') throw new Error('probe did not remove it');",
                    `await import('${bundleUrl}');`,
                    "print('SEGMENTER:' + typeof Intl.Segmenter);",
                    "print('SEGMENTS:' + [...new Intl.Segmenter().segment('ab')].map((s) => s.segment).join(','));",
                    '',
                ].join('\n'),
            );
            run = spawnSync('gjs', ['-m', wrapper], {
                cwd: projectDir,
                encoding: 'utf-8',
                timeout: 60 * 1000,
            });
        });

        it('runs the bundle instead of throwing at byte 1', () => {
            assert.equal(run.status, 0, `the bundle did not run:\n${run.stdout}\n${run.stderr}`);
            assert.ok(run.stdout.includes(APP_MARKER), `no marker line in:\n${run.stdout}`);
        });

        it('leaves a working Intl.Segmenter behind', () => {
            // Not just "defined": a stub that constructs and yields nothing would
            // satisfy `typeof` and still break every width calculation.
            assert.match(run.stdout, /SEGMENTER:function/);
            assert.match(run.stdout, /SEGMENTS:a,b/);
        });
    });
});
