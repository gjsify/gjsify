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
print('surface:', surface.getWidth() + 'x' + surface.getHeight(), 'stride', surface.getStride(), 'format', surface.getFormat());
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

cr.$dispose();
cr2.$dispose();
print('done');
