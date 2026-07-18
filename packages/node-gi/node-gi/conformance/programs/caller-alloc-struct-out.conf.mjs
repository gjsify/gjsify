// SPDX-License-Identifier: MIT
// Caller-allocates OUT struct params for PLAIN (non-boxed) C structs — the
// PangoRectangle family (PangoLayout.get_pixel_extents / get_extents). The
// engine g_malloc0's the struct, hands its address to the callee, and wraps the
// filled blob as a field-readable handle the JS side owns (g_free on GC) —
// gjs's CallerAllocatesOut. Only FONT-INDEPENDENT values are printed (an empty
// layout has all-zero ink extents and zero logical x/width; the logical height
// is the font's line height, so only its TYPE is asserted) — the golden must be
// deterministic across machines. The golden is the gjs output.
import Pango from 'gi://Pango?version=1.0';
import PangoCairo from 'gi://PangoCairo?version=1.0';

const fontMap = PangoCairo.FontMap.get_default();
const ctx = fontMap.create_context();
const layout = Pango.Layout.new(ctx);
layout.set_text('', -1);

// Pixel units: void return + two caller-allocates OUT rectangles → [ink, logical].
const [ink, logical] = layout.get_pixel_extents();
print('ink x/width/height:', ink.x, ink.width, ink.height);
print('logical x/width:', logical.x, logical.width);
print('field types:', typeof ink.y, typeof logical.y, typeof logical.height);

// Pango units (the sibling annotation): same caller-allocates OUT family.
const [inkU, logicalU] = layout.get_extents();
print('units ink x/width/height:', inkU.x, inkU.width, inkU.height);
print('units logical x/width:', logicalU.x, logicalU.width);

// Text makes the logical rect non-empty — assert the relation, not the value.
layout.set_text('Hello', -1);
const [ink2, logical2] = layout.get_pixel_extents();
print('hello widths positive:', ink2.width > 0, logical2.width > 0);
print('hello ink inside logical:', ink2.width <= logical2.width + ink2.x);
