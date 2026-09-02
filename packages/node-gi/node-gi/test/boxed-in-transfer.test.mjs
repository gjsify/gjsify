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
//
// The same contract holds one level down, PER CONTAINER ELEMENT, and did not when
// pointer-struct elements were first admitted: `ElementToGIArgument` wrote the
// borrowed pointer whatever the container's transfer said. The third test below is
// that case. Its element rule: NOTHING and CONTAINER leave the elements ours (a
// borrow), EVERYTHING hands them over (ref/copy) — the mirror of the read side.
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

test('a (transfer full) IN container hands over COPIES of its boxed elements: Pango.Font.descriptions_free', async () => {
    const Pango = requireGi('Pango', '1.0');

    // `descs` is `(transfer full)`: pango_font_descriptions_free() calls
    // pango_font_description_free() on EVERY element and then g_free()s the array.
    // Each element handle came from a `(transfer full)` return, so it owns its own
    // PangoFontDescription — handing the callee that very pointer makes both sides
    // free it. Measured before the fix, on the first run of exactly this call:
    // `to_string()` read back `typeName<garbage> style=-1657706014 …` and the process
    // died in `free(): invalid size`.
    for (let i = 0; i < 200; i++) {
        const a = Pango.FontDescription.from_string('Sans 12');
        const b = Pango.FontDescription.from_string('Serif 10');
        Pango.Font.descriptions_free([a, b]);
        // Read AFTER the callee freed its side: a surrendered pointer shows up here as
        // garbage, not as a missing value, so the exact string is the assertion.
        assert.equal(a.to_string(), 'Sans 12');
        assert.equal(b.to_string(), 'Serif 10');
    }

    // …and the handles survive collection, which is where the double free aborts.
    await collect();

    const c = Pango.FontDescription.from_string('Monospace 9');
    Pango.Font.descriptions_free([c]);
    assert.equal(c.to_string(), 'Monospace 9');
});

test('a (transfer none) IN container still borrows its boxed elements: GLib.Variant.new_tuple', async () => {
    const GLib = requireGi('GLib', '2.0');

    // The borrow half of the same rule: `children` is `(transfer none)`, so the callee
    // gets the handle's own pointer and nothing is copied or ref'd for it.
    // g_variant_new_tuple then takes its OWN ref per child — g_variant_ref_sink on an
    // already-sunk child, and every node-gi GLib.Variant handle holds a sunk,
    // non-floating ref (WrapVariant sinks a borrow, take_refs a transfer-full one) — so
    // caller and callee each own exactly one and neither over-frees. That is why the
    // floating-ref clause in g_variant_new_tuple's docs is not a hazard here.
    //
    // WHAT THIS PINS, stated because it is narrower than the name suggests: it pins
    // that the borrow path WORKS end to end, and it goes red if the element admission
    // or the borrow regresses. It does NOT detect a wrongful COPY on a transfer-none
    // container — for a refcounted boxed that is a leak, and this suite has no leak
    // oracle. Only the transfer-full test above can fail on the ownership rule.
    for (let i = 0; i < 200; i++) {
        const child = GLib.Variant.new_int32(42);
        const tuple = GLib.Variant.new_tuple([child]);
        assert.equal(tuple.get_type_string(), '(i)');
        assert.equal(tuple.get_child_value(0).get_int32(), 42);
        // The child is untouched by the call and still independently usable.
        assert.equal(child.get_int32(), 42);
    }

    await collect();

    const child = GLib.Variant.new_string('kept');
    assert.equal(GLib.Variant.new_tuple([child]).get_type_string(), '(s)');
    assert.equal(child.get_string()[0], 'kept');
});
