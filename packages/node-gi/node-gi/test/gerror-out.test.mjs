// SPDX-License-Identifier: MIT
// GError-typed OUT / INOUT / IN parameters (`GI_TYPE_TAG_ERROR`) — the direction
// half of the GError contract; `gerror-return.test.mjs` is the RETURN half.
//
// Regression for #1495: `IsSupportedOutType` (calls.cc) allow-listed every tag but
// this one, so `Gst.Message.parse_error()` threw
// `TypeError: GstMessage.parse_error: OUT type tag 20 parameters are not yet
// supported` BEFORE the invoke — and with it every other way to learn why a
// GStreamer pipeline stopped. Ten of the eighteen GError OUT parameters in a
// 264-typelib sweep are the bus-error accessors of Gst / GstPlay / GstTranscoder,
// and `parse_error_details` hands back a GstStructure, not the error, so there was
// no route around it. The read-back it needed already existed (marshal.cc's
// `GI_TYPE_TAG_ERROR` arm, written for `Gtk.GLArea.get_error()`); only the gate
// stood in front of it. ADR 0024 stages 4+5 put the shipped `.app` and the Windows
// program directory on Node, so on two of three target OSes this path is the
// ONLY path.
//
// GLib carries the whole shape and is present on every runtime leg (the arm64 CI
// container has no GStreamer), so the mechanism is proven with GLib and the
// issue's own call is proven where GStreamer exists:
//   * OUT, transfer-full  — `GLib.set_error_literal` writes a fresh GError the JS
//     handle then owns (finalizer → g_boxed_free = g_error_free).
//   * IN, transfer-full   — `GLib.propagate_error` ADOPTS its `src`, so the handle
//     must hand over an independent g_error_copy or both sides free it.
//   * IN, transfer-none   — `Gst.Message.new_error` borrows.
//   * INOUT               — `GLib.prefix_error_literal` reads and rewrites the slot.
//   * NULL is a VALUE     — a callee that leaves the slot alone must read back as
//     `null`, never as an empty GLib.Error.
//
// gjs is the reference and every expectation below was measured against
// gjs 1.88.1 first (`GLib.propagate_error(e)` returns a copy there too, and
// `msg.parse_info()` on an ERROR message yields `[null, null]`).
import test from 'node:test';
import assert from 'node:assert/strict';

import { requireGi } from '../gi.js';

const GLib = requireGi('GLib', '2.0');

// A private error domain, so no other test's quark can make an assertion pass.
const DOMAIN = GLib.quark_from_string('node-gi-gerror-out-test');
const OTHER_DOMAIN = GLib.quark_from_string('node-gi-gerror-out-test-other');

/**
 * Drain the napi finalizer queue: boxed finalizers run off the GC's callback
 * queue on a later loop turn, so a double free only aborts after both a
 * collection AND a turn of the loop. Same helper as boxed-in-transfer.test.mjs.
 */
async function collect() {
    for (let i = 0; i < 2; i++) {
        globalThis.gc?.();
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
}

test('a (transfer full) GError OUT reads back as a field-readable GLib.Error', () => {
    // void return + one GError OUT → the error, bare (the GJS return-tuple convention).
    const err = GLib.set_error_literal(DOMAIN, 7, 'boom');

    assert.notEqual(err, null, 'the OUT slot must not read back as null — the callee filled it');
    assert.equal(err.message, 'boom', 'the message FIELD must read back');
    assert.equal(err.code, 7, 'the code FIELD must read back');
    assert.equal(err.domain, DOMAIN, 'the domain FIELD is the numeric GQuark, as on gjs');

    // matches() has to DISCRIMINATE, not just answer: a stub returning true would
    // pass the positive assertion alone.
    assert.equal(err.matches(DOMAIN, 7), true);
    assert.equal(err.matches(DOMAIN, 8), false, 'a wrong code must not match');
    assert.equal(err.matches(OTHER_DOMAIN, 7), false, 'a wrong domain must not match');
});

test('a (transfer full) GError IN arg is copied, not surrendered: GLib.propagate_error', async () => {
    // g_propagate_error ADOPTS `src` (transfer full) and stores it in `dest`, which
    // the returned handle then owns too. Handing over the borrowed pointer makes
    // both handles own one GError — `free(): invalid pointer` from the finalizer
    // queue, long after the call. Many rounds so at least one pair is collected
    // while the test still runs.
    for (let i = 0; i < 200; i++) {
        const src = GLib.set_error_literal(DOMAIN, i, `round ${i}`);
        const dest = GLib.propagate_error(src);
        assert.equal(dest.code, i);
        assert.equal(dest.message, `round ${i}`);
    }

    await collect();

    // Both instances are independent and still readable afterwards.
    const original = GLib.set_error_literal(DOMAIN, 42, 'original');
    const propagated = GLib.propagate_error(original);
    assert.equal(original.message, 'original', 'the source handle survives the hand-over');
    assert.equal(propagated.message, 'original');
    assert.equal(propagated.code, 42);
    assert.equal(propagated.domain, DOMAIN);
});

test('a GError INOUT slot is read and rewritten: GLib.prefix_error_literal', () => {
    const err = GLib.set_error_literal(DOMAIN, 3, 'boom');
    const prefixed = GLib.prefix_error_literal(err, 'context: ');

    assert.equal(prefixed.message, 'context: boom', 'the callee rewrote the slot it was handed');
    assert.equal(prefixed.code, 3, 'domain and code survive the rewrite');
    assert.equal(prefixed.domain, DOMAIN);
    // The arg is (transfer full) too, so the callee got a copy and the original
    // is untouched — the same ownership rule as propagate_error above.
    assert.equal(err.message, 'boom');
});

test('an untouched GError OUT slot reads back as null, not an empty GLib.Error', () => {
    // g_prefix_error_literal is a no-op when `*err` is NULL (no precondition
    // warning, unlike g_propagate_error), so this is the plain "the callee wrote
    // nothing" case: the zero-initialised slot must marshal to `null`.
    const nothing = GLib.prefix_error_literal(null, 'context: ');

    assert.strictEqual(nothing, null, 'a NULL GError is `null`, not an object');
    // The guard against passing for the wrong reason: `null` here must be the
    // MARSHALLED slot, not a refusal that returned nothing. The same call with a
    // real error returns a real error.
    const something = GLib.prefix_error_literal(GLib.set_error_literal(DOMAIN, 1, 'x'), 'context: ');
    assert.equal(something.message, 'context: x');
});

test('a non-GError value at a GError IN arg is refused, not forwarded', () => {
    // The refusal is load-bearing: forwarding a wrong pointer into a GError slot
    // is a wild dereference inside GLib, not a catchable JS error.
    assert.throws(() => GLib.propagate_error({}), /expected a GLib.Error/);
    assert.throws(() => GLib.propagate_error('not an error'), /expected a GLib.Error/);
    assert.throws(() => GLib.propagate_error(GLib.TimeZone.new_utc()), /expected a GLib.Error/);
});

// ---- the issue's own call, where GStreamer exists ---------------------------
//
// Gated on the typelib rather than on the platform: the aarch64 CI leg runs the
// suite on a plain fedora:44 with no GStreamer, and every other leg has it. The
// GLib tests above prove the same marshalling; these prove the reported call.
let Gst = null;
let gstError = null;
try {
    Gst = requireGi('Gst', '1.0');
    Gst.init(null);
} catch (err) {
    gstError = err;
}
const gstSkip = gstError ? `Gst 1.0 unavailable: ${gstError.message}` : false;

test('Gst.Message.parse_error returns the bus error and its debug string', { skip: gstSkip }, () => {
    const src = Gst.ElementFactory.make('fakesrc', 'gerror-out-test-src');
    assert.notEqual(src, null, 'fakesrc must resolve — an empty registry would fake a pass');

    const err = GLib.set_error_literal(DOMAIN, 11, 'no such file');
    // (transfer none) GError IN — the callee copies what it keeps.
    const message = Gst.Message.new_error(src, err, 'debug-detail');

    const [parsed, debug] = message.parse_error();
    assert.notEqual(parsed, null, 'the GError OUT — the parameter #1495 refused');
    assert.equal(parsed.message, 'no such file');
    assert.equal(parsed.code, 11);
    assert.equal(parsed.domain, DOMAIN);
    assert.equal(parsed.matches(DOMAIN, 11), true);
    assert.equal(debug, 'debug-detail', 'the second OUT still marshals beside the GError');
    assert.equal(err.message, 'no such file', 'the borrowed IN error is untouched');
});

test('a real pipeline failure is READABLE off the bus', { skip: gstSkip }, () => {
    // The effect the fix exists for, end to end: not "parse_error returns an
    // object" but "an application learns why playback stopped". A synthesised
    // Gst.Message cannot show that — the error has to come from GStreamer itself.
    // filesrc on a missing path fails its READY transition and posts the error
    // synchronously, so no main loop and no network are involved.
    const pipeline = Gst.parse_launch('filesrc location=/nonexistent-node-gi-gerror ! fakesink');
    pipeline.set_state(Gst.State.PLAYING);
    const message = pipeline.get_bus().timed_pop_filtered(5 * Gst.SECOND, Gst.MessageType.ERROR);
    pipeline.set_state(Gst.State.NULL);

    assert.notEqual(message, null, 'the pipeline must post an ERROR message');
    const [err, debug] = message.parse_error();
    assert.notEqual(err, null);
    assert.equal(err.matches(Gst.resource_error_quark(), Gst.ResourceError.NOT_FOUND), true);
    assert.equal(typeof err.message, 'string');
    assert.ok(err.message.length > 0, 'the reason must be a readable string');
    assert.match(String(debug), /nonexistent-node-gi-gerror/, 'the debug string names the file');
});

test('parse_info on an ERROR message yields [null, null], as on gjs', { skip: gstSkip }, () => {
    const src = Gst.ElementFactory.make('fakesrc', 'gerror-out-test-src2');
    const message = Gst.Message.new_error(src, GLib.set_error_literal(DOMAIN, 5, 'boom'), 'dbg');

    // gst_message_parse_info's g_return_if_fail rejects the wrong message type and
    // returns WITHOUT touching either OUT slot — the GStreamer-CRITICAL on stderr
    // is expected and is the point. gjs 1.88.1 prints the same critical and returns
    // [null, null]; an empty GLib.Error here would be the defect.
    assert.deepEqual(message.parse_info(), [null, null]);
});
