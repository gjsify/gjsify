// SPDX-License-Identifier: MIT
// GValue return/OUT auto-unboxing for @gjsify/node-gi (marshal.cc GIArgumentToJs
// INTERFACE branch). A GI function returning a `GValue` (GType G_TYPE_VALUE) is
// AUTO-UNBOXED to its contained JS value — int/string/double/boolean/null — exactly
// as GJS does, NOT handed back as an opaque GObject.Value boxed handle. Before this
// fix such a return marshalled to `[object Object]` (a boxed handle), which is what
// the @gjsify/sqlite consumer hit reading `Gda.DataModel.get_value_at()`.
//
// Source = headless libgda SQLite (the sqlite consumer's own path): a `get_value_at`
// on a SELECT model returns a transfer-none GValue whose contained GType is pinned by
// the column's declared type (INTEGER→int, TEXT→string, REAL→double, BOOLEAN→boolean),
// with a NULL row for the unset→null case. Gated on libgda availability (skip cleanly
// if absent — node/CI have it). Byte-parity is asserted against the GOLD STANDARD:
// the SAME query body run under `gjs -m`, compared line-for-line.
//
// int64 + NaN-float/double GValue returns are covered by the tier-B gimarshalling
// port (gvalue_int64_out / gvalue_noncanonical_nan_*), which has the purpose-built
// GIMarshallingTests functions this file's headless Gda source cannot express.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { requireGi } from '../gi.js';

// Load libgda; a box without the Gda-6.0 typelib skips the whole file cleanly.
let Gda = null;
let gdaError = '';
try {
    Gda = requireGi('Gda', '6.0');
} catch (e) {
    gdaError = String(e?.message ?? e);
}
const skip = Gda ? false : `libgda (Gda-6.0) unavailable: ${gdaError}`;

// The SHARED probe body — runs UNCHANGED under node-gi AND gjs (see the parity test
// below, which embeds this exact `.toString()`). Only `gi://` + plain JS, so it is
// runtime-neutral; it returns the formatted lines and lets the caller print them.
function probeGValues(GdaNs) {
    const cnc = GdaNs.Connection.open_from_string(
        'SQLite',
        'DB_DIR=.;DB_NAME=:memory:',
        null,
        GdaNs.ConnectionOptions.NONE,
    );
    cnc.execute_non_select_command('CREATE TABLE t (i INTEGER, s TEXT, d REAL, b BOOLEAN)');
    cnc.execute_non_select_command("INSERT INTO t VALUES (42, 'hi', 3.5, 1)");
    cnc.execute_non_select_command('INSERT INTO t VALUES (NULL, NULL, NULL, NULL)');
    const model = cnc.execute_select_command('SELECT i, s, d, b FROM t');
    const labels = ['INTEGER', 'TEXT', 'REAL', 'BOOLEAN'];
    const out = [];
    for (let row = 0; row < model.get_n_rows(); row++) {
        for (let col = 0; col < model.get_n_columns(); col++) {
            const v = model.get_value_at(col, row);
            out.push(`row${row} ${labels[col]}: ${v === null ? 'null' : v} (${typeof v})`);
        }
    }
    return out;
}

test('GValue return unboxes to the contained JS primitive (Gda.DataModel.get_value_at)', { skip }, () => {
    const cnc = Gda.Connection.open_from_string(
        'SQLite',
        'DB_DIR=.;DB_NAME=:memory:',
        null,
        Gda.ConnectionOptions.NONE,
    );
    cnc.execute_non_select_command('CREATE TABLE t (i INTEGER, s TEXT, d REAL, b BOOLEAN)');
    cnc.execute_non_select_command("INSERT INTO t VALUES (42, 'hi', 3.5, 1)");
    cnc.execute_non_select_command('INSERT INTO t VALUES (NULL, NULL, NULL, NULL)');
    const model = cnc.execute_select_command('SELECT i, s, d, b FROM t');

    // int → a JS number (NOT a boxed GObject.Value handle: typeof 'object' would be
    // the pre-fix regression).
    const i = model.get_value_at(0, 0);
    assert.equal(i, 42);
    assert.equal(typeof i, 'number');

    // string → a JS string.
    const s = model.get_value_at(1, 0);
    assert.equal(s, 'hi');
    assert.equal(typeof s, 'string');

    // double → a JS number.
    const d = model.get_value_at(2, 0);
    assert.equal(d, 3.5);
    assert.equal(typeof d, 'number');

    // boolean → a JS boolean (a BOOLEAN column pins G_TYPE_BOOLEAN → true, not 1).
    const b = model.get_value_at(3, 0);
    assert.equal(b, true);
    assert.equal(typeof b, 'boolean');

    // NULL / unset GValue → null (every column of the second, all-NULL row).
    for (let col = 0; col < 4; col++) {
        assert.equal(model.get_value_at(col, 1), null, `NULL column ${col} unboxes to null`);
    }
});

test(
    'GValue unbox is byte-identical to gjs (gold standard)',
    {
        skip: skip || (spawnSync('gjs', ['--version'], { stdio: 'ignore' }).status === 0 ? false : 'gjs not on PATH'),
    },
    () => {
        const ours = probeGValues(Gda).join('\n');

        // Run the IDENTICAL probe body under `gjs -m` (native gi:// + GValue unbox) and
        // compare its stdout line-for-line — the exactness oracle.
        const dir = mkdtempSync(join(tmpdir(), 'nodegi-gvalue-gjs-'));
        try {
            const script = join(dir, 'probe.js');
            const src =
                `import Gda from 'gi://Gda?version=6.0';\n` +
                `const probeGValues = ${probeGValues.toString()};\n` +
                `for (const line of probeGValues(Gda)) print(line);\n`;
            writeFileSync(script, src);
            const res = spawnSync('gjs', ['-m', script], { encoding: 'utf8' });
            assert.equal(res.status, 0, `gjs probe failed: ${res.stderr}`);
            assert.equal(ours, res.stdout.trimEnd(), 'node-gi and gjs GValue unbox output are byte-identical');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    },
);
