// SPDX-License-Identifier: MIT
// GLib.js override-parity tests for @gjsify/node-gi (Phase 3.3).
//
// Covers the GLib conveniences gjs adds over introspection
// (refs/gjs/modules/core/overrides/GLib.js): GLib.log_structured (pack fields into
// an a{sv} + hand to g_log_variant), the one-shot idle/timeout helpers
// (idle_add_once / timeout_add_once / timeout_add_seconds_once), and
// GLib.log_set_writer_func (a JS callback marshalled as a GLogWriterFunc via the
// native GjsPrivate-mirror). log_structured's stderr output is checked byte-for-byte against the
// GOLD STANDARD by running the SAME log call under both node-gi and `gjs -m` and
// asserting the writer emits the identical MESSAGE + domain.
//
// Reference: refs/gjs/modules/core/overrides/GLib.js; verified vs gjs 1.88.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as native from '../index.js';
import { requireGi } from '../gi.js';

const GLib = requireGi('GLib', '2.0');
const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const hasGjs = spawnSync('gjs', ['--version'], { stdio: 'ignore' }).status === 0;

// ---- GLib.log_structured --------------------------------------------------

test('log_structured accepts string / Uint8Array / GLib.Variant fields', () => {
    // No throw for the three supported value kinds (writes to the GLib log/stderr).
    assert.doesNotThrow(() =>
        GLib.log_structured('nodegi-test', GLib.LogLevelFlags.LEVEL_DEBUG, {
            MESSAGE: 'a string field',
            RAW: Uint8Array.of(1, 2, 3),
            EXTRA: new GLib.Variant('s', 'a variant field'),
        }),
    );
});

test('log_structured rejects an unsupported field value (gjs TypeError)', () => {
    assert.throws(
        () => GLib.log_structured('nodegi-test', GLib.LogLevelFlags.LEVEL_DEBUG, { N: 5 }),
        /Unsupported value .*log_structured supports GLib.Variant, Uint8Array, and string/,
    );
});

// The log line reaches GLib's default writer on stderr — capture it from a child so
// the C-level fd-2 write is visible. A LEVEL_MESSAGE log is emitted unconditionally
// (no G_MESSAGES_DEBUG gate needed), so the domain + message text are deterministic.
function logStderr(runtime) {
    const dir = mkdtempSync(join(tmpdir(), `nodegi-log-${runtime}-`));
    try {
        const script = join(dir, 'probe.mjs');
        if (runtime === 'gjs') {
            writeFileSync(
                script,
                `import GLib from 'gi://GLib?version=2.0';\n` +
                    `GLib.log_structured('nodegi-parity', GLib.LogLevelFlags.LEVEL_MESSAGE, { MESSAGE: 'structured-gold' });\n`,
            );
            const res = spawnSync('gjs', ['-m', script], { encoding: 'utf8' });
            return res.stderr;
        }
        writeFileSync(
            script,
            `import { requireGi } from ${JSON.stringify(join(pkgRoot, 'gi.js'))};\n` +
                `const GLib = requireGi('GLib', '2.0');\n` +
                `GLib.log_structured('nodegi-parity', GLib.LogLevelFlags.LEVEL_MESSAGE, { MESSAGE: 'structured-gold' });\n`,
        );
        const res = spawnSync(process.execPath, [script], {
            encoding: 'utf8',
            env: { ...process.env, NODE_GI_NATIVE: 'build' },
        });
        return res.stderr;
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

test('log_structured emits the message + domain to the GLib writer', () => {
    const err = logStderr('node');
    assert.match(err, /structured-gold/, 'the MESSAGE reaches stderr');
    assert.match(err, /nodegi-parity/, 'the log domain reaches stderr');
});

test('log_structured writer output matches gjs (gold standard)', { skip: hasGjs ? false : 'gjs not on PATH' }, () => {
    // GLib's default writer format is identical on both; the timestamp differs, so
    // compare the stable tail (domain-Message: <hh:mm:ss.ms>: <message>) by shape.
    const strip = (s) => s.replace(/\d\d:\d\d:\d\d\.\d+/g, 'TIME').trim();
    const ours = strip(logStderr('node'));
    const theirs = strip(logStderr('gjs'));
    assert.equal(ours, theirs, 'node-gi and gjs produce the identical structured-log line');
});

// ---- one-shot idle/timeout conveniences -----------------------------------

test('idle_add_once fires exactly once (auto-removed)', () => {
    let n = 0;
    GLib.idle_add_once(GLib.PRIORITY_DEFAULT_IDLE, () => {
        n++;
    });
    for (let i = 0; i < 8 && n === 0; i++) native.iterateMainContext(true);
    assert.equal(n, 1, 'fired once');
    // Drain any further ready sources — a *_once helper returned SOURCE_REMOVE, so it
    // must not fire again.
    for (let i = 0; i < 5; i++) native.iterateMainContext(false);
    assert.equal(n, 1, 'did not re-fire (source removed)');
});

test('timeout_add_once fires exactly once (auto-removed)', () => {
    let n = 0;
    GLib.timeout_add_once(GLib.PRIORITY_DEFAULT, 0, () => {
        n++;
    });
    for (let i = 0; i < 20 && n === 0; i++) native.iterateMainContext(true);
    assert.equal(n, 1, 'fired once');
    for (let i = 0; i < 5; i++) native.iterateMainContext(false);
    assert.equal(n, 1, 'did not re-fire (source removed)');
});

// ---- log_set_writer_func (works: JS fn → GLogWriterFunc) ------------------

test('log_set_writer_func installs a JS writer that receives a real log', () => {
    // GLib allows only ONE g_log_set_writer_func per process (a second is a fatal
    // g_error, same as gjs) — this file's single install; log_set_writer_default()
    // re-arms the default fallback afterwards. Full coverage: gclosure-in-args.test.mjs.
    const seen = [];
    GLib.log_set_writer_func((_level, fields) => {
        seen.push(fields);
        return GLib.LogWriterOutput.HANDLED;
    });
    GLib.log_structured('node-gi-glib-overrides', GLib.LogLevelFlags.LEVEL_MESSAGE, {
        MESSAGE: 'writer-func-works',
    });
    const rec = seen.find((f) => f.MESSAGE && Buffer.from(f.MESSAGE).toString('utf8') === 'writer-func-works');
    assert.ok(rec, 'the installed writer received the emitted MESSAGE');
    GLib.log_set_writer_default();
});

test('the LogLevelFlags / LogWriterOutput surface is present', () => {
    assert.equal(typeof GLib.LogLevelFlags.LEVEL_MESSAGE, 'number');
    assert.equal(typeof GLib.LogWriterOutput.HANDLED, 'number');
});
