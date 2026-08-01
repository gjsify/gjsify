// SPDX-License-Identifier: MIT
// Marshalling-correctness close-out for @gjsify/node-gi — display-free, headless.
// Three gaps, each asserted against the gjs GOLD STANDARD (the SAME probe body run
// under `gjs -m`, compared line-for-line — the exactness oracle):
//
//   Gap 1  empty Uint8Array / empty array as an IN byte container (marshal.cc
//          JsToCArray): an EMPTY typed array has a NULL backing-store pointer, which
//          used to defeat the byte fast-path and throw "expected an array"; now it
//          marshals to an empty C container (count 0) like gjs.
//   Gap 2  GValue byte-array marshalling + the boxed-handle Proxy (object.cc
//          GValueToJs/JsToGValue + gi.js wrapBoxed): a GByteArray GValue round-trips
//          a Uint8Array (gjs value.cpp:1091/783), and a boxed handle's Proxy returns
//          `undefined` for a name that is neither a method nor a field (so
//          `typeof x.toArray` is `'undefined'`, not `'function'` — the divergence
//          that broke the @gjsify/sqlite BLOB round-trip via its
//          `typeof value.toArray === 'function'` duck-type). Gda checks gate on libgda.
//   Gap 3  INOUT containers are covered by the tier-B gimarshalling port
//          (array_inout / *_utf8_none_inout / init_function / ...) and by the INOUT
//          strv chain-up in vfunc-chainup.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { requireGi } from '../gi.js';

const GLib = requireGi('GLib', '2.0');
const GObject = requireGi('GObject', '2.0');

const gjsAvailable = spawnSync('gjs', ['--version'], { stdio: 'ignore' }).status === 0;

// Run a self-contained probe body (only `gi://` + plain JS) under `gjs -m` and
// return its stdout — the gold-standard oracle. `imports` maps a local name to its
// `gi://` specifier; the body is `.toString()`-inlined + called via `callExpr`.
function goldStandard(imports, bodyFn, callExpr) {
    const dir = mkdtempSync(join(tmpdir(), 'nodegi-marshal-gjs-'));
    try {
        const script = join(dir, 'probe.js');
        const importLines = Object.entries(imports)
            .map(([name, spec]) => `import ${name} from '${spec}';`)
            .join('\n');
        const src = `${importLines}\nconst probe = ${bodyFn.toString()};\nfor (const line of ${callExpr}) print(line);\n`;
        writeFileSync(script, src);
        const res = spawnSync('gjs', ['-m', script], { encoding: 'utf8' });
        assert.equal(res.status, 0, `gjs probe failed: ${res.stderr}`);
        return res.stdout.trimEnd();
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

// ---- Gap 1 - empty Uint8Array / empty array as an IN byte container ----------

function probeEmptyByteIn(GLib) {
    const out = [];
    out.push(`base64(new Uint8Array([])) = ${JSON.stringify(GLib.base64_encode(new Uint8Array([])))}`);
    out.push(`base64([]) = ${JSON.stringify(GLib.base64_encode([]))}`);
    out.push(`base64(new Uint8Array([104,105])) = ${JSON.stringify(GLib.base64_encode(new Uint8Array([104, 105])))}`);
    out.push(`md5(new Uint8Array([])) = ${GLib.compute_checksum_for_data(GLib.ChecksumType.MD5, new Uint8Array([]))}`);
    out.push(`md5([]) = ${GLib.compute_checksum_for_data(GLib.ChecksumType.MD5, [])}`);
    out.push(`md5([97,98,99]) = ${GLib.compute_checksum_for_data(GLib.ChecksumType.MD5, [97, 98, 99])}`);
    return out;
}

test('Gap 1: an empty Uint8Array / array marshals as an empty byte container (no throw)', () => {
    // The regression: an empty typed array used to throw "expected an array".
    assert.equal(GLib.base64_encode(new Uint8Array([])), '');
    assert.equal(GLib.base64_encode([]), '');
    assert.equal(GLib.base64_encode(new Uint8Array([104, 105])), 'aGk=');
    // MD5 of the empty string - proves an empty typed array reached C as a 0-length buffer.
    assert.equal(
        GLib.compute_checksum_for_data(GLib.ChecksumType.MD5, new Uint8Array([])),
        'd41d8cd98f00b204e9800998ecf8427e',
    );
});

test(
    'Gap 1: empty-byte-container IN is byte-identical to gjs',
    { skip: gjsAvailable ? false : 'gjs not on PATH' },
    () => {
        const ours = probeEmptyByteIn(GLib).join('\n');
        const gold = goldStandard({ GLib: 'gi://GLib?version=2.0' }, probeEmptyByteIn, 'probe(GLib)');
        assert.equal(ours, gold, 'node-gi and gjs empty-byte-container IN output are byte-identical');
    },
);

// ---- Gap 2 - GByteArray GValue round-trips a Uint8Array (object.cc) ----------

test('Gap 2: a GByteArray GValue round-trips a Uint8Array (signal param)', () => {
    // A byte-array signal param exercises BOTH directions: emit marshals the JS
    // Uint8Array INTO a G_TYPE_BYTE_ARRAY GValue (JsToGValue), the handler receives it
    // back OUT (GValueToJs). gjs gold standard (verified): a Uint8Array in the handler.
    const Klass = GObject.registerClass(
        { GTypeName: 'NodeGiByteArrayGValueSig', Signals: { 'sig-ba': { param_types: ['GByteArray'] } } },
        class extends GObject.Object {},
    );
    const o = new Klass();
    let got;
    o.connect('sig-ba', (_o, v) => {
        got = v;
    });
    o.emit('sig-ba', new Uint8Array([10, 20, 30]));
    assert.ok(got instanceof Uint8Array, 'a GByteArray GValue unboxes to a Uint8Array, not a boxed handle');
    assert.deepEqual([...got], [10, 20, 30]);
});

// ---- Gap 2 - the boxed-handle Proxy + the Gda BLOB round-trip (libgda) -------

let Gda = null;
let gdaError = '';
try {
    Gda = requireGi('Gda', '6.0');
} catch (e) {
    gdaError = String(e?.message ?? e);
}
const gdaSkip = Gda ? false : `libgda (Gda-6.0) unavailable: ${gdaError}`;

// The SHARED probe body - a BLOB read returns a boxed GdaBinary handle on BOTH
// node-gi and gjs (NOT a Uint8Array - verified). What must match is the JS shape of
// that handle: a name that is not a real member reads `undefined` (`typeof
// v.toArray`), `'x' in v` is false, and a REAL method (`get_size`) is a callable
// returning the byte count. The constructor NAME (Gda_Binary vs a generic proxy) is
// intentionally NOT compared - that wrapper-shape difference is orthogonal here.
function probeBlobHandle(Gda) {
    const cnc = Gda.Connection.open_from_string(
        'SQLite',
        'DB_DIR=.;DB_NAME=:memory:',
        null,
        Gda.ConnectionOptions.NONE,
    );
    cnc.execute_non_select_command('CREATE TABLE t (b BLOB)');
    cnc.execute_non_select_command("INSERT INTO t VALUES (x'68656c6c6f')");
    const model = cnc.execute_select_command('SELECT b FROM t');
    const v = model.get_value_at(0, 0);
    const out = [];
    out.push(`isUint8Array: ${v instanceof Uint8Array}`);
    out.push(`typeof toArray: ${typeof v.toArray}`);
    out.push(`toArray in v: ${'toArray' in v}`);
    out.push(`typeof nope123: ${typeof v.nope123}`);
    out.push(`typeof get_size: ${typeof v.get_size}`);
    out.push(`get_size(): ${v.get_size()}`);
    return out;
}

test('Gap 2: a BLOB get_value_at() boxed handle exposes no phantom members', { skip: gdaSkip }, () => {
    const cnc = Gda.Connection.open_from_string(
        'SQLite',
        'DB_DIR=.;DB_NAME=:memory:',
        null,
        Gda.ConnectionOptions.NONE,
    );
    cnc.execute_non_select_command('CREATE TABLE t (b BLOB)');
    cnc.execute_non_select_command("INSERT INTO t VALUES (x'68656c6c6f')");
    const v = cnc.execute_select_command('SELECT b FROM t').get_value_at(0, 0);
    // The gi.js Proxy fix: a non-member reads `undefined` (was a fabricated function),
    // matching gjs - this is what let the sqlite reader's `typeof value.toArray ===
    // 'function'` duck-type stop falsely matching + throwing on a non-existent call.
    assert.equal(typeof v.toArray, 'undefined', 'a non-member is undefined, not a phantom function');
    assert.equal(typeof v.nope123, 'undefined');
    assert.equal('toArray' in v, false);
    // A REAL introspected method is still callable + returns the byte count.
    assert.equal(typeof v.get_size, 'function');
    assert.equal(v.get_size(), 5);
});

test(
    'Gap 2: the BLOB boxed-handle shape is byte-identical to gjs',
    {
        skip: gdaSkip || (gjsAvailable ? false : 'gjs not on PATH'),
    },
    () => {
        const ours = probeBlobHandle(Gda).join('\n');
        const gold = goldStandard({ Gda: 'gi://Gda?version=6.0' }, probeBlobHandle, 'probe(Gda)');
        assert.equal(ours, gold, 'node-gi and gjs BLOB boxed-handle JS shape are byte-identical');
    },
);
