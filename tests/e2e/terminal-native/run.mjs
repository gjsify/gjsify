#!/usr/bin/env node
// E2E test: GjsifyTerminal optional-dependency behaviour.
//
// Runs the same GJS probe bundle twice:
//   • "without core" — removes the GjsifyTerminal typelib from GI_TYPELIB_PATH
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
import { resolve, dirname } from 'node:path';

import { e2eSkipReason } from '../helpers.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GJS_BUNDLE = resolve(__dirname, 'dist/probe.gjs.mjs');
// The per-target package, a SIBLING of the bridge since ADR 0017:
// `@gjsify/terminal-native` ships no `prebuilds/` of its own any more, so a
// consumer downloads only the binary their machine can load.
const PREBUILD_DIR = resolve(__dirname, '../../../packages/node/terminal-native-linux-x64/prebuilds/linux-x64');

function runProbe(withCore) {
    const env = { ...process.env };
    if (withCore && existsSync(PREBUILD_DIR)) {
        // Prepend the prebuilds directory so GjsifyTerminal.typelib is found.
        const existing = env.GI_TYPELIB_PATH || '';
        env.GI_TYPELIB_PATH = existing ? `${PREBUILD_DIR}:${existing}` : PREBUILD_DIR;
        const existingLib = env.LD_LIBRARY_PATH || '';
        env.LD_LIBRARY_PATH = existingLib ? `${PREBUILD_DIR}:${existingLib}` : PREBUILD_DIR;
    } else {
        // Strip the prebuild path so the native library is invisible.
        env.GI_TYPELIB_PATH = (env.GI_TYPELIB_PATH || '')
            .split(':')
            .filter((p) => p !== PREBUILD_DIR)
            .join(':');
        env.LD_LIBRARY_PATH = (env.LD_LIBRARY_PATH || '')
            .split(':')
            .filter((p) => p !== PREBUILD_DIR)
            .join(':');
    }

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

await describe('terminal-native E2E', async () => {
    await describe('without core module', async () => {
        let r;
        it('probe exits 0 and returns JSON', () => {
            r = runProbe(false);
        });
        it('native_loaded is false', () => {
            assert.strictEqual(r.native_loaded, false);
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
