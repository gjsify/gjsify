// SPDX-License-Identifier: MIT
// GError-typed OUT / INOUT / IN parameters (`GI_TYPE_TAG_ERROR`) — the direction
// half of the GError contract; `gerror-return.test.mjs` is the RETURN half.
//
// Regression for #1495: `IsSupportedOutType` (calls.cc) allow-listed every tag but
// this one, so `Gst.Message.parse_error()` threw
// `TypeError: GstMessage.parse_error: OUT type tag 20 parameters are not yet
// supported` BEFORE the invoke — and with it every other way to learn why a
// GStreamer pipeline stopped. A sweep of the installed typelibs found most GError
// OUT parameters to BE the bus-error accessors of Gst / GstPlay / GstTranscoder,
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
//   * BOTH JS shapes      — node-gi hands out two `GLib.Error`s (the L1 JS class for
//     a thrown one, a boxed handle for a marshalled one) and an IN arg takes either.
//
// gjs is the reference and every expectation below was measured against
// gjs 1.88.1 first (`GLib.propagate_error(e)` returns a copy there too, and
// `msg.parse_info()` on an ERROR message yields `[null, null]`).
import test from 'node:test';
import assert from 'node:assert/strict';

import { __boxedAddress } from '../index.js';
import { requireGi, unwrap } from '../gi.js';
import { drainFinalizers } from './gc-drain.mjs';
import { Gst, gstSkip } from './gst-gate.mjs';

const GLib = requireGi('GLib', '2.0');
const Gio = requireGi('Gio', '2.0');

/** The address the GError behind a wrapped GLib.Error occupies (`null` for anything else). */
const boxedAddress = (value) => __boxedAddress(unwrap(value));

// A private error domain, so no other test's quark can make an assertion pass.
const DOMAIN = GLib.quark_from_string('node-gi-gerror-out-test');
const OTHER_DOMAIN = GLib.quark_from_string('node-gi-gerror-out-test-other');

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
    // queue, long after the call.
    //
    // ASSERTED ON THE POINTERS, not on a crash. g_propagate_error stores the very
    // pointer it was handed, so `dest` wraps whatever went in: two equal addresses
    // mean two owners of one GError. The rounds-and-wait-for-SIGABRT form this
    // replaces does NOT discriminate — with TransferBoxedIn reduced to a bare
    // borrow, a double free on every round, it passed 5 runs out of 5 (and under
    // valgrind), because the allocator recycles the block between the two frees.
    const src = GLib.set_error_literal(DOMAIN, 1, 'identity');
    const dest = GLib.propagate_error(src);
    assert.notEqual(
        boxedAddress(dest),
        boxedAddress(src),
        'a (transfer full) IN arg must hand the callee an independent g_error_copy',
    );
    assert.equal(typeof boxedAddress(src), 'string', 'both sides must BE boxed handles');

    // Rounds + a drain on top: the identity check proves the copy, this proves the
    // copies are then released rather than piling up.
    for (let i = 0; i < 200; i++) {
        const src = GLib.set_error_literal(DOMAIN, i, `round ${i}`);
        const dest = GLib.propagate_error(src);
        assert.equal(dest.code, i);
        assert.equal(dest.message, `round ${i}`);
    }

    await drainFinalizers();

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
    // The arg is (transfer full) too, so the callee got a COPY and rewrote that —
    // and g_prefix_error_literal edits in place, so the slot reads back the very
    // pointer it was handed. Two distinct addresses is the whole ownership claim:
    // one owner each, no double free when both handles finalize.
    assert.notEqual(boxedAddress(prefixed), boxedAddress(err), 'INOUT must not surrender the slot');
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
    // is a wild dereference inside GLib, not a catchable JS error. gjs 1.88.1
    // refuses the same four (`… is not a subclass of GLib_Error`, and
    // `Expected type error for Argument 'src'` for the string) — the wording
    // diverges, which of them is refused does not.
    assert.throws(() => GLib.propagate_error({}), /expected a GLib.Error/);
    assert.throws(() => GLib.propagate_error('not an error'), /expected a GLib.Error/);
    assert.throws(() => GLib.propagate_error(GLib.TimeZone.new_utc()), /expected a GLib.Error/);
    // The refusal must DISCRIMINATE by more than "not a boxed handle": an object
    // that merely LOOKS like an error is not one, and duck-typing would take it.
    assert.throws(
        () => GLib.propagate_error({ domainQuark: DOMAIN, code: 1, message: 'lookalike' }),
        /expected a GLib.Error/,
    );
});

// ---- the SECOND JS shape: the L1 GLib.Error class ---------------------------
//
// A GError reaches JS as one of two objects, and only one of them used to be
// accepted back: a MARSHALLED error (a GError-typed OUT/RETURN) is a boxed handle
// over the real GError*, while a THROWN one — the implicit `throws=1` GError of a
// failed invoke, and anything `new GLib.Error(…)` builds — is L1's JS class with
// no GError* behind it at all. gjs has ONE object for both and takes either.
//
// Refusing the JS class closed the hand-back direction for exactly the errors an
// application is holding: you catch a failure and cannot post it. Measured on
// gjs 1.88.1 first — `GLib.propagate_error(caught)` and
// `GLib.propagate_error(new GLib.Error(q, c, m))` both succeed there.

test('a CAUGHT GLib.Error can be handed back into a GError IN arg', () => {
    let caught = null;
    try {
        Gio.File.new_for_path('/nonexistent-node-gi-gerror-in').load_contents(null);
    } catch (err) {
        caught = err;
    }
    assert.notEqual(caught, null, 'the failing call must throw — otherwise this proves nothing');
    assert.ok(caught instanceof GLib.Error, 'a thrown GError is the L1 class, not a boxed handle');

    // (transfer full) IN: the binding builds a GError from the JS class and the
    // callee adopts it, so `dest` carries the same domain/code/message.
    const propagated = GLib.propagate_error(caught);
    assert.equal(propagated.message, caught.message);
    assert.equal(propagated.code, caught.code);
    assert.equal(
        propagated.matches(Gio.io_error_quark(), Gio.IOErrorEnum.NOT_FOUND),
        true,
        'the DOMAIN survives the rebuild — a wrong quark would still carry the message',
    );
    assert.equal(propagated.matches(OTHER_DOMAIN, caught.code), false, 'a wrong domain must not match');
});

test('a CONSTRUCTED GLib.Error can be handed back into a GError IN arg', async () => {
    // `new GLib.Error(...)` is the other producer of the JS class, and the only one
    // an application controls. Many rounds + a drain: the built GError is released
    // per transfer, so a wrong rule surfaces here as a double free rather than at
    // process exit, where nothing is watching.
    for (let i = 0; i < 200; i++) {
        const made = new GLib.Error(DOMAIN, i, `built ${i}`);
        const propagated = GLib.propagate_error(made);
        assert.equal(propagated.code, i);
        assert.equal(propagated.message, `built ${i}`);
        assert.equal(propagated.matches(DOMAIN, i), true);
    }

    await drainFinalizers();

    // The INOUT arm takes the JS class too, and does not rewrite the JS object.
    const made = new GLib.Error(DOMAIN, 4, 'built');
    const prefixed = GLib.prefix_error_literal(made, 'context: ');
    assert.equal(prefixed.message, 'context: built');
    assert.equal(made.message, 'built', 'the JS error the caller still holds is not rewritten');
});

test('a GLib.Error with no domain is refused BY NAME, not marshalled as quark 0', () => {
    // Quark 0 would build an error `matches()` can never answer for — a silent
    // mismatch far from here. `new GLib.Error(undefined, …)` sets neither `.domain`
    // nor `.domainQuark`, and the refusal has to say which of the two problems it is.
    // gjs refuses this too, one step earlier — at construction, with
    // `Error.new_literal: undefined is not a valid domain`, because there the JS
    // class IS the introspected boxed. Here the class is L1's, so the refusal can
    // only land at the marshalling boundary; refused either way, never marshalled.
    assert.throws(
        () => GLib.propagate_error(new GLib.Error(undefined, 1, 'no domain')),
        /expected a GLib\.Error for argument 'src', got a GLib\.Error with no domain/,
    );
});

// ---- the issue's own call, where GStreamer exists ---------------------------
//
// The GLib tests above prove the same marshalling; these prove the reported call.
// `gst-gate.mjs` answers whether this host has GStreamer at all.

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

test('a caught error POSTS to a Gst bus: the (transfer none) IN arm', { skip: gstSkip }, async () => {
    // The round trip the IN direction exists for, with the error shape an
    // application actually has: catch a failure, post it, read it back off the bus.
    // `error` is (transfer none) here, so the GError built from the JS class is
    // OURS to free after the invoke — the arm gst_message_new_error copies from.
    // Many rounds, so a missing release shows as a growing heap and a premature one
    // as a use-after-free inside GStreamer, rather than as nothing at all.
    let caught = null;
    try {
        Gio.File.new_for_path('/nonexistent-node-gi-gerror-post').load_contents(null);
    } catch (err) {
        caught = err;
    }
    const src = Gst.ElementFactory.make('fakesrc', 'gerror-post-test-src');
    assert.notEqual(src, null, 'fakesrc must resolve — an empty registry would fake a pass');

    for (let i = 0; i < 200; i++) {
        const [parsed] = Gst.Message.new_error(src, caught, `dbg ${i}`).parse_error();
        assert.equal(parsed.message, caught.message);
        assert.equal(parsed.matches(Gio.io_error_quark(), Gio.IOErrorEnum.NOT_FOUND), true);
    }

    await drainFinalizers();
    assert.equal(caught.message.length > 0, true, 'the JS error survives every hand-over');
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
