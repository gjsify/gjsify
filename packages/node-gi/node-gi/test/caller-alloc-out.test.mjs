// SPDX-License-Identifier: MIT
// Caller-allocates OUT struct params for PLAIN (non-boxed) C structs — the
// PangoRectangle family: PangoLayout.get_pixel_extents / get_extents return two
// rectangles via caller-allocated storage (`(out caller-allocates)`), the
// canvas2d-core measureText path. The engine g_malloc0's each struct, hands its
// address to the callee, and wraps the filled blob as a field-readable handle
// the JS side OWNS (g_free on GC) — matching gjs's CallerAllocatesOut
// (g_malloc0 → fill → wrap → g_free). Boxed caller-allocates (GValue, boxed
// structs) were already live; this file covers the non-boxed slice.
//
// SELF-SKIPPING: needs the Pango + PangoCairo typelibs (mirrors the PangoCairo
// self-skip in test/cairo.test.mjs), so a minimal GLib-only host stays green;
// the node-gi CI job installs pango so it runs there. Values are gjs-verified
// (byte-identical output for the same program under `gjs -m`).
import test from 'node:test';
import assert from 'node:assert/strict';

import { requireGi } from '../gi.js';

let Pango = null;
let PangoCairo = null;
try {
    Pango = requireGi('Pango', '1.0');
    PangoCairo = requireGi('PangoCairo', '1.0');
} catch {
    Pango = null;
    PangoCairo = null;
}
const skip = Pango !== null && PangoCairo !== null ? false : 'Pango/PangoCairo typelib unavailable';

function makeLayout(text) {
    const ctx = PangoCairo.FontMap.get_default().create_context();
    const layout = Pango.Layout.new(ctx);
    layout.set_text(text, -1);
    return layout;
}

test('get_pixel_extents → [ink, logical] with readable int fields', { skip }, () => {
    const [ink, logical] = makeLayout('Hello').get_pixel_extents();
    for (const rect of [ink, logical]) {
        assert.equal(typeof rect.x, 'number');
        assert.equal(typeof rect.y, 'number');
        assert.equal(typeof rect.width, 'number');
        assert.equal(typeof rect.height, 'number');
    }
    assert.ok(logical.width > 0, 'text has a positive logical width');
    assert.ok(logical.height > 0, 'text has a positive logical height');
});

test('empty text → all-zero ink extents (gjs-verified)', { skip }, () => {
    const [ink, logical] = makeLayout('').get_pixel_extents();
    assert.equal(ink.x, 0);
    assert.equal(ink.width, 0);
    assert.equal(ink.height, 0);
    assert.equal(logical.x, 0);
    assert.equal(logical.width, 0);
});

test('Pango-unit get_extents (the sibling annotation) marshals too', { skip }, () => {
    const [, logical] = makeLayout('Hello').get_extents();
    const [, logicalPx] = makeLayout('Hello').get_pixel_extents();
    // Pango units are 1024ths of a pixel; the pixel rect is the units rect
    // converted, so the unit width must be positive and >= the pixel width.
    assert.ok(logical.width >= logicalPx.width);
    assert.ok(logical.width > 0);
});

test('the two OUT rectangles are independent storage', { skip }, () => {
    const [ink, logical] = makeLayout('Hi').get_pixel_extents();
    ink.x = 1234; // a field WRITE through the handle (setBoxedField)
    assert.equal(ink.x, 1234);
    assert.notEqual(logical.x, 1234);
});

test('returned rects outlive the call and survive GC (owned storage)', { skip }, () => {
    const rects = [];
    for (let i = 0; i < 25; i++) rects.push(makeLayout('Hello').get_pixel_extents()[1]);
    if (globalThis.gc) globalThis.gc();
    for (const r of rects) {
        assert.equal(typeof r.width, 'number');
        assert.ok(r.width > 0);
    }
});
