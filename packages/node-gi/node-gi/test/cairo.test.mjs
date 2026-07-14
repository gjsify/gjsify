// SPDX-License-Identifier: MIT
// @gjsify/node-gi — cairo binding + foreign-struct seam, HEADLESS (no display).
//
// Proves the native cairo binding + the foreign-struct marshalling seam that lets
// a GI argument of a cairo type round-trip to/from the JS cairo objects (cairo is a
// FOREIGN struct in GObject-Introspection — GI delegates its marshalling to the
// module). Covers:
//  • ImageSurface + Context drawing → getData() pixel bytes (exact + checksum);
//  • BYTE-FOR-BYTE PIXEL PARITY vs. gjs — the same scene drawn under `gjs -m`,
//    written to PNG, decoded back, and compared pixel-for-pixel (the killer test);
//  • SolidPattern + setSource; $dispose semantics (a disposed handle throws);
//  • the FOREIGN-IN seam headlessly via PangoCairo.create_layout(cr) (a GI function
//    taking a cairo_t — self-skips when the PangoCairo typelib is absent).
// The foreign-FROM seam (a draw-func's cairo_t handed INTO JS) needs a display and
// lives in test/cairo-drawfunc.test.mjs.
//
// Part of the cross-runtime conformance subset (runs on node / bun / deno).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import cairo from '../cairo.js';
import { requireGi } from '../gi.js';

// djb2 — order-sensitive checksum over the raw pixel bytes.
function djb2(u8) {
  let h = 5381 >>> 0;
  for (let i = 0; i < u8.length; i++) h = (((h << 5) + h) + u8[i]) >>> 0;
  return h;
}

// The deterministic scene, as ONE source of truth: called directly under node-gi,
// and its own source (drawScene.toString()) is embedded into the `gjs -m` parity
// child (native cairo) below. Takes the cairo module explicitly so the same
// function body runs verbatim in the gjs child (which binds `cairo` to its native
// module). Returns the flushed surface.
function drawScene(cairo) {
  const W = 64;
  const H = 48;
  const surface = new cairo.ImageSurface(cairo.Format.ARGB32, W, H);
  const cr = new cairo.Context(surface);
  cr.setSourceRGB(1, 1, 1);
  cr.paint();
  cr.setSourceRGB(0.8, 0.1, 0.1);
  cr.rectangle(8, 8, 20, 16);
  cr.fill();
  cr.setLineWidth(2);
  cr.setSourceRGB(0.1, 0.2, 0.9);
  cr.rectangle(30, 10, 20, 20);
  cr.stroke();
  cr.setSourceRGBA(0.1, 0.7, 0.2, 1);
  cr.arc(48, 36, 8, 0, 2 * Math.PI);
  cr.fill();
  cr.setLineWidth(1);
  cr.setSourceRGBA(0, 0, 0, 1);
  cr.moveTo(2, 44);
  cr.lineTo(60, 44);
  cr.stroke();
  cr.$dispose();
  surface.flush();
  return surface;
}

test('ImageSurface geometry (ARGB32) is deterministic', () => {
  const s = new cairo.ImageSurface(cairo.Format.ARGB32, 4, 4);
  assert.equal(s.getWidth(), 4);
  assert.equal(s.getHeight(), 4);
  assert.equal(s.getStride(), 16); // 4px * 4 bytes
  assert.equal(s.getFormat(), cairo.Format.ARGB32);
  assert.equal(s.getType(), cairo.SurfaceType.IMAGE);
  s.$dispose();
});

test('filling a red rectangle yields the exact ARGB32 pixel bytes', () => {
  const s = new cairo.ImageSurface(cairo.Format.ARGB32, 4, 4);
  const cr = new cairo.Context(s);
  cr.setSourceRGB(1, 0, 0);
  cr.rectangle(0, 0, 4, 4);
  cr.fill();
  cr.$dispose();
  s.flush();

  const data = s.getData();
  assert.ok(data instanceof Uint8Array, 'getData() is a Uint8Array');
  assert.equal(data.length, 64); // stride(16) * height(4)
  // Opaque red on little-endian ARGB32 (premultiplied) = B,G,R,A = 0,0,255,255.
  assert.deepEqual([...data.slice(0, 4)], [0, 0, 255, 255]);
  let sum = 0;
  for (const b of data) sum = (sum + b) >>> 0;
  assert.equal(sum, 8160);
  assert.equal(djb2(data), 3156304613);
  s.$dispose();
});

test('a full drawing scene produces a deterministic pixel checksum', () => {
  const s = drawScene(cairo);
  const data = s.getData();
  assert.equal(data.length, 12288); // stride(256) * height(48)
  assert.equal(djb2(data), 4004317761);
  s.$dispose();
});

test('SolidPattern.createRGB(A) + setSource', () => {
  const p = cairo.SolidPattern.createRGBA(0.2, 0.4, 0.6, 0.8);
  assert.ok(p instanceof cairo.SolidPattern);
  assert.ok(p instanceof cairo.Pattern);
  assert.equal(p.getType(), cairo.PatternType.SOLID);

  const s = new cairo.ImageSurface(cairo.Format.ARGB32, 8, 8);
  const cr = new cairo.Context(s);
  cr.setSource(p);
  cr.paint();
  cr.$dispose();
  s.$dispose();
});

test('$dispose is idempotent and a disposed context throws', () => {
  const s = new cairo.ImageSurface(cairo.Format.ARGB32, 4, 4);
  const cr = new cairo.Context(s);
  cr.$dispose();
  cr.$dispose(); // idempotent — no throw, no double-free
  assert.throws(() => cr.moveTo(0, 0), /live cairo\.Context/);
  s.$dispose();
});

test('createFromPNG round-trips writeToPNG pixels', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nodegi-cairo-'));
  try {
    const s = drawScene(cairo);
    const png = join(dir, 'scene.png');
    s.writeToPNG(png);
    const loaded = cairo.ImageSurface.createFromPNG(png);
    assert.equal(loaded.getWidth(), 64);
    assert.equal(loaded.getHeight(), 48);
    // The decoded pixels match the drawn surface exactly.
    assert.equal(djb2(loaded.getData()), djb2(s.getData()));
    s.$dispose();
    loaded.$dispose();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// THE KILLER TEST: draw the identical scene under `gjs -m` (native cairo), write a
// PNG, decode it back with node-gi, and assert the pixels are byte-for-byte equal
// to node-gi's own rendering. Proves node-gi's cairo binding paints identically to
// GJS. Self-skips when gjs is not on PATH (bun/deno legs, or a gjs-less box).
const haveGjs = spawnSync('gjs', ['--version'], { stdio: 'ignore' }).status === 0;
test('pixel parity with gjs (byte-for-byte)', { skip: haveGjs ? false : 'gjs not on PATH' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'nodegi-cairo-gjs-'));
  try {
    const gjsPng = join(dir, 'gjs.png');
    const gjsScript = join(dir, 'draw.js');
    // Embed drawScene's OWN source (its .toString()) so gjs runs the identical
    // body against its native cairo, then writes the PNG.
    const src =
      `import cairo from 'cairo';\n` +
      `const drawScene = ${drawScene.toString()};\n` +
      `const s = drawScene(cairo);\n` +
      `s.writeToPNG(${JSON.stringify(gjsPng)});\n`;
    writeFileSync(gjsScript, src);
    const res = spawnSync('gjs', ['-m', gjsScript], { encoding: 'utf8' });
    assert.equal(res.status, 0, `gjs draw failed: ${res.stderr}`);
    assert.ok(existsSync(gjsPng), 'gjs produced a PNG');

    // Decode gjs's PNG + node-gi's own render; compare pixels.
    const fromGjs = cairo.ImageSurface.createFromPNG(gjsPng);
    const own = drawScene(cairo);
    const a = fromGjs.getData();
    const b = own.getData();
    assert.equal(a.length, b.length, 'same pixel-buffer length');
    assert.deepEqual(Buffer.from(a), Buffer.from(b), 'gjs and node-gi pixels are byte-identical');
    fromGjs.$dispose();
    own.$dispose();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The FOREIGN-IN seam headlessly: PangoCairo.create_layout(cr) is a GI function
// TAKING a cairo_t — so calling it proves the foreign to_func marshals a node-gi
// cairo.Context into a GI argument. Self-skips when the PangoCairo typelib is absent.
let PangoCairo = null;
try {
  PangoCairo = requireGi('PangoCairo', '1.0');
} catch {
  PangoCairo = null;
}
test('foreign-IN seam: a cairo.Context marshals into a GI call (PangoCairo)', {
  skip: PangoCairo ? false : 'PangoCairo typelib unavailable',
}, () => {
  const s = new cairo.ImageSurface(cairo.Format.ARGB32, 32, 32);
  const cr = new cairo.Context(s);
  const layout = PangoCairo.create_layout(cr); // foreign IN: cairo_t -> GIArgument
  assert.ok(layout, 'create_layout returned a Pango.Layout');
  layout.set_width(12345);
  assert.equal(layout.get_width(), 12345);
  PangoCairo.show_layout(cr, layout); // foreign IN again (cr + layout)
  cr.$dispose();
  s.$dispose();
});
