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
// THE SIP SHAPE (third case): on macOS with SIP on — every stock Mac; CI runners
// have it off — `/bin/sh` strips every `DYLD_*` variable and KEEPS
// `GI_TYPELIB_PATH`. So a compound package script started from the launcher
// (`gjsify run a && gjsify run b`) hands its nested GJS CLI half the launcher's
// environment: typelibs found, their libraries not. `@gjsify/terminal-native`
// then reported itself available and `process.stdout.columns` threw
// "Unsupported type void" while the CLI's modules evaluated — measured on the
// `cli` template's own `gjsify run build`. The case reproduces that half-env
// directly, so it needs neither SIP nor macOS to go red: the same deletion
// fails the same way on Linux.
//
// Runs on linux and darwin (the macOS leg in `macos-suites.yml`). SKIP (no
// false failures off a capable host): another OS, no `gjs`, no built CLI
// bundle, or no `@gjsify/rolldown-native` prebuild for this host target.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOST_TARGET, prebuildDir } from '../helpers.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const CLI_BUNDLE = join(REPO_ROOT, 'packages', 'infra', 'cli', 'dist', 'cli.gjs.mjs');

function hostTarget() {
    if (process.platform !== 'linux' && process.platform !== 'darwin') return null;
    if (process.arch !== 'x64' && process.arch !== 'arm64') return null;
    return HOST_TARGET;
}

function hasGjs() {
    const r = spawnSync('gjs', ['--version'], { stdio: 'ignore' });
    return r.status === 0 && r.error === undefined;
}

const target = hostTarget();
const PREBUILD = target ? prebuildDir('infra', 'rolldown-native', target) : null;
const TERMINAL_PREBUILD = target ? prebuildDir('node', 'terminal-native', target) : null;

const SKIP =
    !target ||
    !hasGjs() ||
    !existsSync(CLI_BUNDLE) ||
    !PREBUILD ||
    !existsSync(join(PREBUILD, 'GjsifyRolldown-1.0.typelib'));

/** Every library-path variable the launcher may export, both loader spellings. */
const LIBRARY_PATH_VARS = ['LD_LIBRARY_PATH', 'DYLD_LIBRARY_PATH', 'DYLD_FALLBACK_LIBRARY_PATH'];

/**
 * The host environment with every variable the launcher would have exported
 * REMOVED — `GI_TYPELIB_PATH` and the library path under both its ELF and its
 * Mach-O spelling, since the suite runs on linux and darwin.
 */
function envWithoutPrebuildPaths(extra = {}) {
    const env = { ...process.env, ...extra };
    delete env.GI_TYPELIB_PATH;
    for (const name of LIBRARY_PATH_VARS) delete env[name];
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
    it('builds with GI_TYPELIB_PATH and the library-path variables deleted from the env', () => {
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

    // What a SIP `/bin/sh` leaves of the launcher's environment (header): the
    // typelib directory, no library directory. The CLI must still start — the
    // terminal loader names the library directory from where it FOUND the
    // typelib, and a namespace whose library cannot open is reported absent
    // rather than available.
    it('starts with GI_TYPELIB_PATH set and every library-path variable deleted', () => {
        assert.ok(
            TERMINAL_PREBUILD && existsSync(join(TERMINAL_PREBUILD, 'GjsifyTerminal-1.0.typelib')),
            `@gjsify/terminal-native has no ${target} prebuild at ${TERMINAL_PREBUILD} — the case would measure nothing`,
        );
        const r = spawnSync('gjs', ['-m', CLI_BUNDLE, '--version'], {
            cwd: tmpDir,
            encoding: 'utf-8',
            timeout: 60 * 1000,
            env: envWithoutPrebuildPaths({ GI_TYPELIB_PATH: TERMINAL_PREBUILD, HOME: tmpDir }),
        });
        const log = `${r.stdout ?? ''}${r.stderr ?? ''}`;
        assert.doesNotMatch(log, /Unsupported type void/, `a half-loaded GI namespace escaped. Output:\n${log}`);
        assert.equal(r.status, 0, `the CLI must start on the typelib path alone. Output:\n${log}`);
        assert.match(r.stdout, /^\d+\.\d+\.\d+/, `--version must print the version. Output:\n${log}`);
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
