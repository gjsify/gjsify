// SPDX-License-Identifier: MIT
// Boxed/struct IN-argument TRANSFER handling for @gjsify/node-gi — the
// ownership half of the boxed marshalling contract (the OUT half lives in
// `boxed-out.test.mjs`). Cross-runtime safe: headless, no display, no test
// typelib (GLib + Pango only; Pango is already a CI dependency of the unit job
// because the caller-alloc-struct-out conformance programs need it).
//
// Regression for a double-free: `JsToGIArgument` handed the callee the very
// pointer the JS boxed handle still owned, ignoring the argument's
// `(transfer full)` annotation. The callee frees it, then the handle's
// finalizer frees it again — `free(): invalid pointer` / SIGSEGV, raised
// asynchronously from the napi finalizer queue long after the call.
//
// Found via `@gjsify/webrtc` on the node-gi reverse bridge: `RTCSessionDescription
// .toGstDesc()` does
//
//   const [ret, sdp] = GstSdp.SDPMessage.new_from_text(text);      // OUT (transfer full)
//   GstWebRTC.WebRTCSessionDescription.new(type, sdp);             // IN  (transfer full)
//
// so `gst_webrtc_session_description_free` and the SDPMessage handle's own
// finalizer both freed the same `GstSDPMessage`. GStreamer is not a node-gi test
// dependency, so the same shape is reproduced here with Pango:
// `pango_attr_size_new()` returns `(transfer full)` and `pango_attr_list_insert()`
// takes its `attr` `(transfer full)`.
//
// gjs is the reference behaviour: refs/gjs/gi/wrapperutils.h
// `GIWrapperBase::transfer_to_gi_argument` COPIES on a transferring IN arg
// (`Instance::copy_ptr` → `g_boxed_copy`, or `g_variant_ref` for GVariant), so
// the callee and the JS wrapper own independent instances.
import test from 'node:test';
import assert from 'node:assert/strict';

import { requireGi } from '../gi.js';

/**
 * Drain the napi finalizer queue: the boxed handles' finalizers run off the
 * GC's callback queue on a later event-loop turn, so a double free only aborts
 * after both a collection AND a turn of the loop.
 */
async function collect() {
    for (let i = 0; i < 2; i++) {
        globalThis.gc?.();
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
}

test('a (transfer full) boxed IN arg is copied, not surrendered: Pango.AttrList.insert', async () => {
    const Pango = requireGi('Pango', '1.0');

    // Many rounds so at least one pair of handles is collected while the test
    // is still running (a single round would defer the abort to process exit).
    for (let i = 0; i < 200; i++) {
        const list = Pango.AttrList.new();
        // (transfer full) RETURN → the handle owns this PangoAttribute.
        const attr = Pango.AttrSize.new(12 * 1024);
        // `attr` is (transfer full): the list ADOPTS it and destroys it with the
        // list. Pre-fix this handed over the handle's own pointer, so the
        // finalizer destroyed an already-destroyed attribute.
        list.insert(attr);
    }

    await collect();

    // Still usable afterwards — the copy is a real, independent attribute.
    const list = Pango.AttrList.new();
    list.insert(Pango.AttrSize.new(20 * 1024));
    assert.equal(typeof list.to_string(), 'string');
});

test('a (transfer none) boxed IN arg is still a plain borrow: GLib.DateTime.difference', async () => {
    const GLib = requireGi('GLib', '2.0');

    // The unchanged side of the contract: no copy, no ownership move — the
    // handle stays valid and keeps owning its instance across the call.
    const a = GLib.DateTime.new_from_unix_utc(1136214245);
    const b = a.add_hours(1);
    for (let i = 0; i < 200; i++) assert.equal(b.difference(a), 3600000000);

    await collect();

    assert.equal(a.get_year(), 2006);
    assert.equal(b.difference(a), 3600000000);
});
