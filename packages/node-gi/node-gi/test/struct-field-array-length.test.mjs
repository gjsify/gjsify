// SPDX-License-Identifier: MIT
// @gjsify/node-gi — a struct FIELD annotated `array length=<n>` reads its length
// from sibling field <n>, instead of marshalling empty in silence.
//
// `GstMapInfo.data` is `<array length="3" zero-terminated="0" c:type="guint8*">`
// and field 3 of that record is `size`. The field reader passed a hard `-1` to
// `GIArrayToJs` for every array field, so the only lengths it could derive were
// zero-terminated and fixed-size — and a length-in-a-sibling pointer came back as
// an EMPTY array with no error. Measured before the fix, on a 32-byte buffer:
//
//     node-gi:  ok=true size=32 data.length=0
//     gjs:      ok=true size=32 data.length=32
//
// The empty result is indistinguishable from a genuinely empty buffer, which is
// what made audio inaudible on node for an entire investigation: every layer above
// reported success on nothing. That is the class this guards — not one struct.
//
// Note for anyone reproducing this by hand: `nativeCandidates()` prefers
// `prebuilds/<target>/node_gi.node` over `build/Release`, so a bare
// `node probe.mjs` after `node-gyp build` measures the COMMITTED prebuild and the
// fix looks like it did nothing. The `test` scripts set `NODE_GI_NATIVE=build`
// for exactly this reason; an ad-hoc probe has to set it too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { requireGi } from '../gi.js';

let Gst = null;
let loadError = null;
try {
    Gst = requireGi('Gst', '1.0');
    Gst.init(null);
} catch (err) {
    loadError = err;
}

// One shared probe, no runtime branches: the SAME source runs on node-gi and gjs,
// so a disagreement is a marshalling difference and nothing else. It reads only
// fields gjs can read — `user_data` is deliberately NOT here, see below.
function mapInfoProbe(GstNs) {
    const out = [];
    const SIZE = 32;
    const buf = GstNs.Buffer.new_allocate(null, SIZE, null);
    const [ok, map] = buf.map(GstNs.MapFlags.READ);
    out.push(['mapped', ok === true]);
    out.push(['size', Number(map.size)]);
    // The point of the whole file: `data` carries no length of its own.
    out.push(['data-length', map.data == null ? -1 : map.data.length]);
    buf.unmap(map);
    return out;
}

test('a struct field with `array length=` resolves it from the sibling field', { skip: skipReason() }, () => {
    const [mapped, size, dataLength] = mapInfoProbe(Gst);
    assert.deepEqual(mapped, ['mapped', true]);
    assert.deepEqual(size, ['size', 32]);
    assert.deepEqual(
        dataLength,
        ['data-length', 32],
        'GstMapInfo.data must be as long as GstMapInfo.size — 0 here is the silent-empty regression',
    );
});

test('the reader still derives a FIXED-SIZE field without an annotation', { skip: skipReason() }, () => {
    const buf = Gst.Buffer.new_allocate(null, 32, null);
    const [, map] = buf.map(Gst.MapFlags.READ);
    // `user_data` is `<array zero-terminated="0" fixed-size="4">` with no `length=`,
    // so `FieldArrayLength` must decline and leave the fixed-size path in charge.
    //
    // Node-only, and not an oversight: gjs throws `Unknown Array element-type 0` on
    // this same field (its elements are bare `gpointer`), so it cannot serve as an
    // oracle here. node-gi reading it is a capability gjs lacks, not a divergence to
    // repair — recorded so nobody "fixes" the parity probe by adding it back.
    assert.equal(map.user_data.length, 4);
    buf.unmap(map);
});

test('the contents match, not merely the count', { skip: skipReason() }, () => {
    const SIZE = 8;
    const buf = Gst.Buffer.new_allocate(null, SIZE, null);
    const written = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
    buf.fill(0, written);
    const [ok, map] = buf.map(Gst.MapFlags.READ);
    assert.equal(ok, true);
    // A length taken from the wrong sibling would still produce SOME array; only
    // comparing bytes proves it is the right memory read the right distance.
    assert.deepEqual(Array.from(map.data), Array.from(written));
    buf.unmap(map);
});

// Gold-standard parity: gjs is the reference (the conformance README contract).
const haveGjs = spawnSync('gjs', ['--version'], { stdio: 'ignore' }).status === 0;

test('gjs reads the same struct identically', { skip: skipReason() ?? gjsSkip() }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'node-gi-field-array-'));
    try {
        const script = join(dir, 'probe.js');
        writeFileSync(
            script,
            `import Gst from 'gi://Gst?version=1.0';\n` +
                `Gst.init(null);\n` +
                `const probe = ${mapInfoProbe.toString()};\n` +
                `print(JSON.stringify(probe(Gst)));\n`,
        );
        const res = spawnSync('gjs', ['-m', script], { encoding: 'utf8' });
        assert.equal(res.status, 0, `gjs probe failed: ${res.stderr}`);
        assert.deepEqual(JSON.parse(res.stdout.trim()), mapInfoProbe(Gst));
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

/** Why this file cannot run here, or undefined when it can. */
function skipReason() {
    if (loadError !== null) return `GStreamer not available: ${loadError.message}`;
    return undefined;
}

function gjsSkip() {
    return haveGjs ? undefined : 'gjs not on PATH';
}
