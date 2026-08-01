// SPDX-License-Identifier: MIT
// cairo module — the foreign-struct binding (Context/Surface/ImageSurface/
// SolidPattern) driven headlessly. Builds a deterministic ImageSurface scene
// (exercising every ported drawing op — a broken op throws), then prints cairo's
// own computed, font/zlib/display-independent state: surface geometry, the enum
// values, the drawing context's getters (line width, cap/join/rule, current point,
// path/fill extents), and the solid pattern's type. Byte-identical across gjs /
// node / bun / deno (the golden is the gjs output).
//
// Only methods GJS's native cairo exposes are used (so gjs — the reference — runs
// unchanged). Pixel bytes are NOT checksummed here: GJS ships no getData (pixels
// unreadable on the reference), and cairo's PNG encoder rides the host zlib (node
// bundles its own → not cross-runtime stable). Pixel parity vs. gjs is proven in
// test/cairo.test.mjs (decode + compare); the foreign-struct round-trip in
// test/cairo.test.mjs (IN, via PangoCairo) + test/cairo-drawfunc.test.mjs (FROM).
import cairo from 'cairo';

// Enum values (ported verbatim from GJS).
print('Format.ARGB32:', cairo.Format.ARGB32);
print('Content.COLOR_ALPHA:', cairo.Content.COLOR_ALPHA);
print('Operator.OVER:', cairo.Operator.OVER);
print('PatternType.SOLID:', cairo.PatternType.SOLID);
print('LineCap.ROUND:', cairo.LineCap.ROUND);

const W = 64;
const H = 48;
const surface = new cairo.ImageSurface(cairo.Format.ARGB32, W, H);
print(
    'surface:',
    surface.getWidth() + 'x' + surface.getHeight(),
    'stride',
    surface.getStride(),
    'format',
    surface.getFormat(),
);
print('surface type:', surface.getType());

const cr = new cairo.Context(surface);
cr.save();
cr.setSourceRGB(1, 1, 1);
cr.paint();
cr.setSourceRGB(0.8, 0.1, 0.1);
cr.rectangle(8, 8, 20, 16);
print('fill extents:', JSON.stringify(cr.fillExtents()));
print('path extents:', JSON.stringify(cr.pathExtents()));
cr.fill();
cr.setLineWidth(2);
cr.setSourceRGB(0.1, 0.2, 0.9);
cr.rectangle(30, 10, 20, 20);
cr.stroke();
cr.setSourceRGBA(0.1, 0.7, 0.2, 1);
cr.arc(48, 36, 8, 0, 2 * Math.PI);
cr.fill();
cr.setLineWidth(3);
cr.setSourceRGBA(0, 0, 0, 1);
cr.moveTo(2, 44);
cr.lineTo(60, 44);
cr.curveTo(10, 40, 20, 46, 30, 42);
print('has current point:', cr.hasCurrentPoint());
print('current point:', JSON.stringify(cr.getCurrentPoint()));
cr.stroke();
cr.setOperator(cairo.Operator.OVER);
cr.setLineCap(cairo.LineCap.ROUND);
cr.setLineJoin(cairo.LineJoin.BEVEL);
cr.setFillRule(cairo.FillRule.EVEN_ODD);
cr.setMiterLimit(8);
cr.setTolerance(0.25);
cr.restore();

// State survives restore (save/restore was balanced around the whole scene).
print('lineWidth:', cr.getLineWidth());
print('operator:', cr.getOperator());
print('lineCap:', cr.getLineCap(), 'lineJoin:', cr.getLineJoin(), 'fillRule:', cr.getFillRule());

// State set INSIDE save/restore then queried after restore returns to the default.
cr.save();
cr.setLineWidth(7);
cr.setLineCap(cairo.LineCap.SQUARE);
print('inside save lineWidth:', cr.getLineWidth(), 'lineCap:', cr.getLineCap());
cr.restore();
print('after restore lineWidth:', cr.getLineWidth(), 'lineCap:', cr.getLineCap());

// A solid pattern as the context source (exercises setSource through the pattern).
const pattern = cairo.SolidPattern.createRGBA(0.2, 0.4, 0.6, 0.8);
print('pattern type:', pattern.getType());
const cr2 = new cairo.Context(surface);
cr2.setSource(pattern);
cr2.paint();
print('setSource ok');

// ---- the canvas2d slice: gradients, surface patterns, dash, paths, matrix ----
// (only methods GJS's native cairo exposes — gjs, the reference, runs unchanged)

// Gradients: color stops + pattern types.
const lin = new cairo.LinearGradient(0, 0, 0, H);
lin.addColorStopRGB(0, 1, 1, 1);
lin.addColorStopRGBA(1, 0.2, 0.25, 0.5, 1);
print('linear type:', lin.getType());
const rad = new cairo.RadialGradient(10, 10, 2, 10, 10, 9);
rad.addColorStopRGBA(0, 1, 0.9, 0.2, 1);
rad.addColorStopRGBA(1, 0.8, 0.2, 0.1, 0);
print('radial type:', rad.getType());

// SurfacePattern: extend + filter get/set (defaults come from cairo itself).
const tile = new cairo.ImageSurface(cairo.Format.ARGB32, 8, 8);
const sp = new cairo.SurfacePattern(tile);
print('surface-pattern type:', sp.getType());
print('extend default:', sp.getExtend(), 'filter default:', sp.getFilter());
sp.setExtend(cairo.Extend.REPEAT);
sp.setFilter(cairo.Filter.NEAREST);
print('extend set:', sp.getExtend(), 'filter set:', sp.getFilter());

// getSource fans out to the concrete pattern subclass (SurfacePattern exposes
// getFilter) — the canvas2d imageSmoothing path.
const cr3 = new cairo.Context(surface);
cr3.setSource(lin);
print('source type linear:', cr3.getSource().getType());
cr3.setSource(sp);
print('source type surface:', cr3.getSource().getType(), 'filter:', cr3.getSource().getFilter());

// Dash: count + GJS validation semantics (skip undefined, throw on <= 0).
print('dash count initial:', cr3.getDashCount());
cr3.setDash([6, 3, 2, 3], 1);
print('dash count:', cr3.getDashCount());
cr3.setDash([1, undefined, 2], 0);
print('dash count skip-undefined:', cr3.getDashCount());
try {
    cr3.setDash([1, -1], 0);
} catch (e) {
    print('dash error:', e.message);
}
cr3.setDash([], 0);
print('dash count off:', cr3.getDashCount());

// Matrix point/distance transforms + identityMatrix.
cr3.translate(10, 20);
cr3.scale(2, 3);
print('userToDevice:', JSON.stringify(cr3.userToDevice(1, 1)));
print('userToDeviceDistance:', JSON.stringify(cr3.userToDeviceDistance(1, 1)));
print('deviceToUser:', JSON.stringify(cr3.deviceToUser(12, 23)));
print('deviceToUserDistance:', JSON.stringify(cr3.deviceToUserDistance(2, 3)));
cr3.identityMatrix();
print('identity userToDevice:', JSON.stringify(cr3.userToDevice(5, 6)));

// inFill / inStroke + newSubPath current-point semantics.
cr3.newPath();
cr3.rectangle(2, 2, 10, 8);
print('inFill:', cr3.inFill(5, 5), cr3.inFill(30, 25));
cr3.setLineWidth(4);
print('inStroke:', cr3.inStroke(2, 5), cr3.inStroke(7, 6));
cr3.newPath();
cr3.moveTo(3, 3);
cr3.newSubPath();
print('current point after newSubPath:', cr3.hasCurrentPoint());

// Path copy/append round-trip (copyPath + copyPathFlat) via extents.
cr3.newPath();
cr3.moveTo(1, 2);
cr3.lineTo(11, 2);
cr3.curveTo(11, 5, 11, 7, 11, 9);
cr3.closePath();
print('extents before:', JSON.stringify(cr3.pathExtents()));
const copied = cr3.copyPath();
const flattened = cr3.copyPathFlat();
cr3.newPath();
print('extents cleared:', JSON.stringify(cr3.pathExtents()));
cr3.appendPath(copied);
print('extents round-trip:', JSON.stringify(cr3.pathExtents()));
cr3.newPath();
cr3.appendPath(flattened);
print('extents flattened:', JSON.stringify(cr3.pathExtents()));

cr.$dispose();
cr2.$dispose();
cr3.$dispose();
print('done');
