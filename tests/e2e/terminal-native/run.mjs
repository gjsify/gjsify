#!/usr/bin/env node
// E2E test: GjsifyTerminal optional-dependency behaviour.
//
// Runs the same GJS probe bundle twice:
//   • "without core" — deletes the path variables that could reach the typelib
//   • "with core"    — ensures the typelib is on GI_TYPELIB_PATH
//
// In both cases the probe must exit 0 and return sensible values.
// The test verifies that the optional fallback paths work AND that the native
// paths activate correctly when the library is present.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, join } from 'node:path';

import { e2eSkipReason, installedPrebuildDir, prebuildDir, MONOREPO_ROOT } from '../helpers.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GJS_BUNDLE = resolve(__dirname, 'dist/probe.gjs.mjs');
const RESIZE_BUNDLE = resolve(__dirname, 'dist/resize-probe.gjs.mjs');
// The per-target package, a SIBLING of the bridge since ADR 0017:
// `@gjsify/terminal-native` ships no `prebuilds/` of its own any more, so a
// consumer downloads only the binary their machine can load.
//
// The target is spelled out rather than taken from HOST_TARGET, and that is
// deliberate: this suite is the linux-x64 leg. Gating it on the host's own
// target looks tidier and is wrong — a darwin host would then look for a darwin
// prebuild, find one, and RUN the leg, which cannot pass there. macOS strips
// DYLD_* from the environment of a child spawned by a SIP-protected parent, and
// `node` is SIP-protected, so `execFileSync('gjs', …)` hands gjs no
// DYLD_LIBRARY_PATH however carefully this file sets one. The dylib is fine —
// from a shell, `GI_TYPELIB_PATH=… DYLD_LIBRARY_PATH=… gjs -m dist/probe.gjs.mjs`
// reports `native_loaded: true` — the harness cannot deliver it. Making that leg
// honest on macOS is its own problem, not this commit's.
const PREBUILD_DIR = prebuildDir('node', 'terminal-native', 'linux-x64');
// The same directory under the name CI stages it: `node_modules/@gjsify/*` is a
// symlink to `packages/node/*`, so these two strings name ONE directory — see
// `envWithoutNativeTerminal` for why that difference is the whole bug.
const PREBUILD_DIR_VIA_NODE_MODULES = installedPrebuildDir(
    join(MONOREPO_ROOT, 'node_modules'),
    'terminal-native',
    'linux-x64',
);

/** Every variable that can put a native prebuild within reach of the probe: the
 * typelib search path, plus the loader path under both its ELF and its Mach-O
 * spelling. The same four names `launcher-free-build` deletes for the same
 * reason — kept in step by hand for now, a shared helper in `helpers.mjs` would
 * be the way to stop them drifting. */
const PREBUILD_PATH_VARS = ['GI_TYPELIB_PATH', 'LD_LIBRARY_PATH', 'DYLD_LIBRARY_PATH', 'DYLD_FALLBACK_LIBRARY_PATH'];

/**
 * The probe's environment with the native terminal library out of reach.
 *
 * DELETE the variables rather than filtering PREBUILD_DIR out of them. One
 * directory arrives under more than one string: the `packages/node/…` path this
 * suite knows, and the `node_modules/@gjsify/terminal-native-linux-x64` symlink
 * to the very same directory. CI builds its `GI_TYPELIB_PATH` from exactly that
 * second spelling — a colon-list of every `*-native-linux-x64/prebuilds/…` it
 * staged — so a string filter removed the first and left the second, the probe
 * loaded the native library, and the "without core module" leg asserted
 * `native_loaded === false` against a value the environment had already decided
 * (red on #1820, green on main only because main stages nothing). A filter has
 * to enumerate every spelling and still cannot see a system-wide install; a
 * delete does not have to be right about names to be right about reach.
 */
function envWithoutNativeTerminal(extra = {}) {
    const env = { ...process.env, ...extra };
    for (const name of PREBUILD_PATH_VARS) delete env[name];
    return env;
}

/** The probe's environment with the prebuild directory first on every path, so
 * GjsifyTerminal.typelib and its .so are both found. */
function envWithNativeTerminal(extra = {}) {
    const env = { ...process.env, ...extra };
    for (const name of PREBUILD_PATH_VARS) {
        const existing = env[name] || '';
        env[name] = existing ? `${PREBUILD_DIR}:${existing}` : PREBUILD_DIR;
    }
    return env;
}

/** The environment the last `runProbe` handed to the child. Recorded so the wiring
 * guard can assert on what the child was GIVEN rather than on what the child then
 * managed to load — a load assertion is vacuous wherever the binary cannot load
 * anyway, which is every host but the one CI runs. */
let lastChildEnv = null;

function runProbe(withCore, envOverrides) {
    const env =
        withCore && existsSync(PREBUILD_DIR)
            ? envWithNativeTerminal(envOverrides)
            : envWithoutNativeTerminal(envOverrides);
    lastChildEnv = env;

    const raw = execFileSync('gjs', ['-m', GJS_BUNDLE], {
        env,
        encoding: 'utf8',
        timeout: 10_000,
    }).trim();

    // The probe may print GLib warnings before the JSON line.
    const jsonLine = raw
        .split('\n')
        .reverse()
        .find((l) => l.trim().startsWith('{'));
    assert.ok(jsonLine, `No JSON output found in probe output:\n${raw}`);
    return JSON.parse(jsonLine);
}

const prebuildsBuilt = existsSync(`${PREBUILD_DIR}/GjsifyTerminal-1.0.typelib`);

function runResizeProbe() {
    const raw = execFileSync('gjs', ['-m', RESIZE_BUNDLE], {
        env: envWithNativeTerminal(),
        encoding: 'utf8',
        timeout: 10_000,
    }).trim();
    const jsonLine = raw
        .split('\n')
        .reverse()
        .find((l) => l.trim().startsWith('{'));
    assert.ok(jsonLine, `No JSON output found in probe output:\n${raw}`);
    return JSON.parse(jsonLine);
}

// The core-module half needs a STAGED prebuild, which `test:e2e` does not build — the
// reason this suite is ledgered in `scripts/e2e-unlisted-suites.mjs`. Routed through
// `e2eSkipReason` so a host that means to run it can say so with
// `GJSIFY_E2E_REQUIRE=terminal-native` and get a named failure instead of a silence
// (#1550). No CI job sets it yet: nothing in CI stages this prebuild.
const CORE_SKIP = e2eSkipReason('terminal-native', [
    [
        'a staged GjsifyTerminal-1.0.typelib (gjsify workspace @gjsify/terminal-native run build:prebuilds)',
        prebuildsBuilt,
    ],
]);

// The wiring guard below runs the real probe, so it needs the built bundle. The
// suite's own `test` script builds it, but a bare `node --test` does not — hence a
// second named skip rather than an assumption that the bundle is there.
const PROBE_SKIP = e2eSkipReason('terminal-native', [
    ['the built probe bundle (gjsify run build in tests/e2e/terminal-native)', existsSync(GJS_BUNDLE)],
]);

// The regression guard for the leg below, and the reason it is not a comment.
// The "without core module" leg can only fail on a host that STAGED the
// prebuild, and no CI job stages one — so a filter bug here stays invisible
// until a PR that does stage one, which is how this went red on #1820. These
// assertions need neither `gjs` nor a staged typelib, so they hold wherever the
// suite runs: `tests/e2e/*` are workspace members carrying a `test` script, so
// `gjsify foreach test` picks this up in the sharded `Test N/4` job. The e2e
// shards never see it — `scripts/e2e-suites.mjs` drops everything the ledger
// lists.
await describe('probe environment', async () => {
    // A colon-list shaped like CI's: this suite's own spelling of the prebuild dir,
    // the node_modules symlink to the same dir, and one unrelated staged prebuild
    // that must not be what decides the leg either way.
    const staged = [PREBUILD_DIR, PREBUILD_DIR_VIA_NODE_MODULES, '/staged/http2-native-linux-x64/prebuilds/linux-x64'];
    const poisoned = Object.fromEntries(PREBUILD_PATH_VARS.map((name) => [name, staged.join(':')]));

    it('deletes every prebuild-path variable, not just the one spelling of the dir', () => {
        const env = envWithoutNativeTerminal(poisoned);
        for (const name of PREBUILD_PATH_VARS) {
            assert.ok(
                !(name in env),
                `${name} is still set on the probe, so the native typelib is not out of ` +
                    `reach: ${env[name]}\nBoth spellings of the prebuild dir have to go, ` +
                    `not just PREBUILD_DIR.`,
            );
        }
    });

    it('leaves the rest of the environment alone', () => {
        const env = envWithoutNativeTerminal({ GJSIFY_PROBE_MARKER: 'kept' });
        assert.equal(env.GJSIFY_PROBE_MARKER, 'kept');
        assert.equal(env.PATH, process.env.PATH, 'deleting the path variables must not disturb PATH');
    });

    it('puts the prebuild dir first on every path for the "with core" leg', () => {
        const env = envWithNativeTerminal(Object.fromEntries(PREBUILD_PATH_VARS.map((n) => [n, '/staged/other'])));
        for (const name of PREBUILD_PATH_VARS) {
            assert.equal(env[name].split(':')[0], PREBUILD_DIR, `${name} must start at the prebuild dir`);
            assert.equal(env[name].split(':')[1], '/staged/other', `${name} must keep the inherited path`);
        }
    });

    // The three above pin the HELPERS. This one pins the WIRING, which is where the
    // bug lived: `runProbe` is what hands the child its environment, so an edit
    // there could leave every helper correct and the leg broken again — the exact
    // shape of the original bug, which the helpers alone would not have caught.
    // It needs the built probe, so it skips where the suite already skips: named,
    // never a silent pass (#1550).
    it(
        'hands the probe a clean environment even when the inherited one is full of prebuild paths',
        { skip: PROBE_SKIP },
        () => {
            // What the child was GIVEN, first — this half has teeth on every platform.
            runProbe(false, poisoned);
            for (const name of PREBUILD_PATH_VARS) {
                assert.ok(
                    !(name in lastChildEnv),
                    `runProbe passed ${name} on to the probe: ${lastChildEnv[name]}. The helpers ` +
                        'are correct, so the wiring reintroduced the variable.',
                );
            }
            // And what the child then made of it. Decisive only where the binary can
            // actually load, i.e. on the linux-x64 host CI runs; a darwin host cannot
            // dlopen an ELF .so, so this half passes there either way and says nothing.
            const r = runProbe(false, poisoned);
            assert.strictEqual(
                r.native_loaded,
                false,
                'the probe loaded the native library although runProbe deleted every ' +
                    'prebuild-path variable from its environment, so the typelib is still ' +
                    `reachable. The child saw:\n${JSON.stringify(r)}`,
            );
        },
    );
});

// Needs the staged prebuild: without the typelib there is no ResizeWatcher to measure.
const RESIZE_SKIP = e2eSkipReason('terminal-native', [
    ['the built probe bundle (gjsify run build in tests/e2e/terminal-native)', existsSync(RESIZE_BUNDLE)],
    [
        'a staged GjsifyTerminal-1.0.typelib (gjsify workspace @gjsify/terminal-native run build:prebuilds)',
        prebuildsBuilt,
    ],
]);

await describe('ResizeWatcher owns its SIGWINCH source', { skip: RESIZE_SKIP }, async () => {
    // Deterministic: a started watcher is referenced by its GLib source, so
    // stop() must drop exactly one reference. No terminal or signal is involved.
    const r = runResizeProbe();
    it('stop() is idempotent', () => {
        assert.strictEqual(r.stop_idempotent, true, 'ResizeWatcher.stop() is missing or threw on a second call');
    });
    it('stop() releases the source reference', () => {
        assert.strictEqual(
            r.refs_stopped,
            r.refs_live - 1,
            `a stopped watcher holds ${r.refs_stopped} refs against ${r.refs_live} for a live one; ` +
                'the SIGWINCH source still references it, so it can never be finalized',
        );
    });
});

await describe('terminal-native E2E', async () => {
    await describe('without core module', async () => {
        let r;
        it('probe exits 0 and returns JSON', () => {
            r = runProbe(false);
        });
        it('native_loaded is false', () => {
            // The probe's own env is scrubbed, so a `true` here is not a bug in
            // `envWithoutNativeTerminal` — it means the typelib is reachable through
            // a search path the env does not govern: GJS's built-in default dirs, or a
            // system-wide install of GjsifyTerminal. Say so, instead of leaving the
            // next reader to re-derive it from a bare `false !== true`.
            assert.strictEqual(
                r.native_loaded,
                false,
                'the probe loaded the native terminal library although GI_TYPELIB_PATH ' +
                    'and every library-path variable were deleted from its environment. ' +
                    'GJS also searches its built-in typelib dirs, which the env cannot ' +
                    'remove, so this host has a system-wide GjsifyTerminal. The ' +
                    '"without core module" leg cannot measure absence here.',
            );
        });
        it('isatty returns a boolean (GLib fallback)', () => {
            assert.strictEqual(r.isatty_result_type, 'boolean');
        });
        it('columns is a positive number (env/default fallback)', () => {
            assert.ok(r.columns > 0, `expected columns > 0, got ${r.columns}`);
        });
        it('rows is a positive number (env/default fallback)', () => {
            assert.ok(r.rows > 0, `expected rows > 0, got ${r.rows}`);
        });
        it('stdin has isTTY property', () => {
            assert.ok(r.stdin_has_isTTY);
        });
        it('stdin has setRawMode function', () => {
            assert.ok(r.stdin_has_setRaw);
        });
        it('setRawMode does not crash (no-tty skipped gracefully)', () => {
            assert.ok(
                r.set_raw_mode_ok === 'ok' || r.set_raw_mode_ok === 'skipped_no_tty',
                `unexpected: ${r.set_raw_mode_ok}`,
            );
        });
    });

    if (CORE_SKIP !== false) {
        // A `describe` that SKIPS, not an `it` that logs and passes. The placeholder it
        // replaces was a green test named SKIP: it reported success for a leg that had
        // measured nothing, which is the shape #1550 exists to remove.
        await describe('with core module', { skip: CORE_SKIP }, () => {});
    } else {
        await describe('with core module', async () => {
            let r;
            it('probe exits 0 and returns JSON', () => {
                r = runProbe(true);
            });
            it('native_loaded is true', () => {
                assert.strictEqual(r.native_loaded, true);
            });
            it('isatty returns a boolean (Posix.isatty)', () => {
                assert.strictEqual(r.isatty_result_type, 'boolean');
            });
            it('columns is a positive number (ioctl or fallback)', () => {
                assert.ok(r.columns > 0, `expected columns > 0, got ${r.columns}`);
            });
            it('rows is a positive number (ioctl or fallback)', () => {
                assert.ok(r.rows > 0, `expected rows > 0, got ${r.rows}`);
            });
            it('stdin has isTTY property', () => {
                assert.ok(r.stdin_has_isTTY);
            });
            it('stdin has setRawMode function', () => {
                assert.ok(r.stdin_has_setRaw);
            });
            it('setRawMode does not crash (no-tty skipped gracefully)', () => {
                assert.ok(
                    r.set_raw_mode_ok === 'ok' || r.set_raw_mode_ok === 'skipped_no_tty',
                    `unexpected: ${r.set_raw_mode_ok}`,
                );
            });
        });
    }
});
