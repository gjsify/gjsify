// E2E: `gjsify build` under GJS with NO launcher and NO prebuild env. ADR 0021.
//
// The regression this pins: the GJS bundler engine used to resolve only when
// the process had been started through the `gjsify` launcher, which exports
// GI_TYPELIB_PATH + the host library-path variable before exec. Invoked any
// other way — `gjs -m …/dist/cli.gjs.mjs build …`, which is what several e2e
// suites and any embedding consumer do — the build died with "no usable
// bundler engine under GJS" on a tree where the engine was installed, built and
// loadable. It was worked around each time it was met (most recently by
// retargeting an e2e assertion from `gjsify build` to `gjsify copy`) rather
// than fixed, because the CLI's own diagnostic asserted it could not be fixed:
// "those must be set BEFORE the process starts — the CLI cannot repair it from
// the inside".
//
// Half of that is true forever (LD_LIBRARY_PATH is frozen by ld.so at process
// start) and it is the wrong frame: girepository keeps its OWN typelib and
// library search paths, consults both before the system loader, and both are
// writable at runtime. `activateNativePrebuilds()` writes them.
//
// WHAT MAKES THIS TEST NON-VACUOUS: the child env has GI_TYPELIB_PATH and the
// library-path variable DELETED, not merely left unset — so the suite fails on
// any tree without the fix, and cannot accidentally pass by inheriting a
// developer shell that happens to carry them. It is deliberately the mirror
// image of `gjs-cli-config-load`, which sets both explicitly.
//
// SKIP (no false failures off a capable host): non-Linux, no `gjs`, no built
// CLI bundle, or no `@gjsify/rolldown-native` prebuild for this arch.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prebuildDir } from '../helpers.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const CLI_BUNDLE = join(REPO_ROOT, 'packages', 'infra', 'cli', 'dist', 'cli.gjs.mjs');

function archDir() {
    if (process.arch === 'x64') return 'linux-x64';
    if (process.arch === 'arm64') return 'linux-arm64';
    return null;
}

function hasGjs() {
    const r = spawnSync('gjs', ['--version'], { stdio: 'ignore' });
    return r.status === 0 && r.error === undefined;
}

const arch = archDir();
const PREBUILD = arch ? prebuildDir('infra', 'rolldown-native', arch) : null;

const SKIP =
    process.platform !== 'linux' ||
    !arch ||
    !hasGjs() ||
    !existsSync(CLI_BUNDLE) ||
    !PREBUILD ||
    !existsSync(join(PREBUILD, 'GjsifyRolldown-1.0.typelib'));

/**
 * The host environment with every variable the launcher would have exported
 * REMOVED. `LD_LIBRARY_PATH` is the ELF spelling; the suite is Linux-only (see
 * SKIP), so naming it directly is honest rather than under-specified.
 */
function envWithoutPrebuildPaths(extra = {}) {
    const env = { ...process.env, ...extra };
    delete env.GI_TYPELIB_PATH;
    delete env.LD_LIBRARY_PATH;
    return env;
}

describe('gjsify build under a bare `gjs -m` (no launcher)', { skip: SKIP, timeout: 5 * 60 * 1000 }, () => {
    let tmpDir;

    before(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-launcher-free-'));
        mkdirSync(join(tmpDir, 'src'), { recursive: true });
        writeFileSync(join(tmpDir, 'src', 'index.ts'), 'export const marker = "launcher-free-marker";\n');
    });

    after(() => {
        if (!process.env.GJSIFY_E2E_KEEP_TEMP && tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    });

    // Runs from REPO_ROOT so the cwd anchor finds the workspace prebuilds — the
    // plain "invoke the bundle directly" shape, no fixture tree needed.
    it('builds with GI_TYPELIB_PATH and LD_LIBRARY_PATH deleted from the env', () => {
        const outfile = join(tmpDir, 'out.node.mjs');
        const r = spawnSync(
            'gjs',
            [
                '-m',
                CLI_BUNDLE,
                'build',
                join(tmpDir, 'src', 'index.ts'),
                '--app',
                'node',
                '--outfile',
                outfile,
                '--no-minify',
            ],
            {
                cwd: REPO_ROOT,
                encoding: 'utf-8',
                timeout: 4 * 60 * 1000,
                env: envWithoutPrebuildPaths({ HOME: tmpDir, XDG_CACHE_HOME: join(tmpDir, '.cache') }),
            },
        );
        const log = `${r.stdout ?? ''}${r.stderr ?? ''}`;
        assert.doesNotMatch(
            log,
            /no usable bundler engine under GJS/,
            `the engine must load without the launcher. Output:\n${log}`,
        );
        assert.equal(r.status, 0, `build must succeed with no prebuild env. Output:\n${log}`);
        assert.match(
            readFileSync(outfile, 'utf-8'),
            /launcher-free-marker/,
            'the build must have really run, not just exited 0',
        );
    });

    // The API spelling `gi-search-path.ts` depends on, pinned. A GJS/GLib
    // upgrade that renamed or moved any of these three would NOT fail loudly:
    // the capability probe would simply find nothing, activation would go back
    // to returning an empty set, and every build would quietly need the
    // launcher again — a silent regression to the behaviour this ADR removed.
    // Asserting the shape is what turns that into a red test.
    it('pins the girepository API the activation depends on', () => {
        const probe = join(tmpDir, 'gi-api-probe.js');
        writeFileSync(
            probe,
            [
                'const R = globalThis.imports.gi.GIRepository.Repository;',
                'const repo = R.dup_default();',
                'print(typeof R.dup_default);',
                'print(typeof repo.prepend_search_path);',
                'print(typeof repo.prepend_library_path);',
                '',
            ].join('\n'),
        );
        const r = spawnSync('gjs', ['-m', probe], { encoding: 'utf-8', env: envWithoutPrebuildPaths() });
        assert.equal(
            r.stdout.trim().split('\n').join(','),
            'function,function,function',
            'GIRepository.Repository.dup_default() + prepend_search_path + prepend_library_path must all exist — ' +
                `gi-search-path.ts silently degrades to "launcher required" without them. Output:\n${r.stdout}${r.stderr}`,
        );
    });

    // DELIBERATELY NOT TESTED HERE: that `diagnoseNativeEngine()` no longer
    // advises exporting the launcher env. Such a test was written and removed —
    // it passed against a tree WITHOUT the fix, because a build that fails for
    // any other reason never reaches that diagnostic at all, and on a tree WITH
    // the fix the engine loads so the diagnostic is unreachable by construction.
    // It asserted the absence of a string from output that could not contain it
    // either way: a check whose input set is empty, which `docs/governance.md`
    // § simplicity names as passing while checking nothing.
});
