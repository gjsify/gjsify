// SPDX-License-Identifier: MIT
// Boxed/struct IN-argument TRANSFER handling — the ownership half of the boxed
// marshalling contract (the OUT half is `boxed-out.test.mjs`). Headless, GLib +
// Pango only, so it runs on every runtime leg.
//
// Regression for a double-free: `JsToGIArgument` handed the callee the very
// pointer the JS boxed handle still owned, ignoring the argument's
// `(transfer full)` annotation. The callee frees it, then the handle's finalizer
// frees it again — `free(): invalid pointer` / SIGSEGV, raised asynchronously
// from the napi finalizer queue long after the call. Found via `@gjsify/webrtc`,
// which passes an SDPMessage obtained `(transfer full)` straight into a
// `(transfer full)` IN arg; GStreamer is not a node-gi test dependency, so the
// same shape is reproduced with Pango (`pango_attr_size_new()` returns
// `(transfer full)`, `pango_attr_list_insert()` takes its `attr` the same way).
//
// gjs is the reference: `GIWrapperBase::transfer_to_gi_argument`
// (refs/gjs/gi/wrapperutils.h) COPIES on a transferring IN arg — `g_boxed_copy`,
// or `g_variant_ref` for GVariant — so callee and JS wrapper own independent
// instances.
import test from 'node:test';
import assert from 'node:assert/strict';

import { requireGi } from '../gi.js';

/**
 * Drain the napi finalizer queue: boxed finalizers run off the GC's callback
 * queue on a later loop turn, so a double free only aborts after both a
 * collection AND a turn of the loop.
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
        // `attr` is (transfer full) too: the list ADOPTS it and destroys it with the list.
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

    // No copy, no ownership move: the handle keeps owning its instance across the call.
    const a = GLib.DateTime.new_from_unix_utc(1136214245);
    const b = a.add_hours(1);
    for (let i = 0; i < 200; i++) assert.equal(b.difference(a), 3600000000);

    await collect();

    assert.equal(a.get_year(), 2006);
    assert.equal(b.difference(a), 3600000000);
});
