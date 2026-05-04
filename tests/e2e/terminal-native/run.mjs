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

const __dirname = dirname(fileURLToPath(import.meta.url));
const GJS_BUNDLE  = resolve(__dirname, 'dist/probe.gjs.mjs');
const PREBUILD_DIR = resolve(__dirname, '../../../packages/node/terminal-native/prebuilds/linux-x86_64');

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
            .split(':').filter(p => p !== PREBUILD_DIR).join(':');
        env.LD_LIBRARY_PATH = (env.LD_LIBRARY_PATH || '')
            .split(':').filter(p => p !== PREBUILD_DIR).join(':');
    }

    const raw = execFileSync('gjs', ['-m', GJS_BUNDLE], {
        env,
        encoding: 'utf8',
        timeout: 10_000,
    }).trim();

    // The probe may print GLib warnings before the JSON line.
    const jsonLine = raw.split('\n').reverse().find(l => l.trim().startsWith('{'));
    assert.ok(jsonLine, `No JSON output found in probe output:\n${raw}`);
    return JSON.parse(jsonLine);
}

const prebuildsBuilt = existsSync(`${PREBUILD_DIR}/GjsifyTerminal-1.0.typelib`);

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
                r.set_raw_mode_ok === 'ok' ||
                r.set_raw_mode_ok === 'skipped_no_tty',
                `unexpected: ${r.set_raw_mode_ok}`
            );
        });
    });

    if (!prebuildsBuilt) {
        await describe('with core module', async () => {
            it('SKIP — run yarn build:prebuilds in packages/node/terminal-native first', () => {
                console.log('Skipping: prebuilds not built. Run: yarn workspace @gjsify/terminal-native build:prebuilds');
            });
        });
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
                    r.set_raw_mode_ok === 'ok' ||
                    r.set_raw_mode_ok === 'skipped_no_tty',
                    `unexpected: ${r.set_raw_mode_ok}`
                );
            });
        });
    }
});
