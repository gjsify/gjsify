// SPDX-License-Identifier: MIT
// @gjsify/node-gi/cairo — the GJS built-in `cairo` module on Node.
//
// GJS exposes a native cairo binding as `cairo` (`import cairo from 'cairo'` /
// `gi://cairo` / `imports.cairo`): the drawing constructors (Context, Surface,
// ImageSurface, Pattern, SolidPattern, …) plus the plain-object enums (Format,
// Operator, Content, …). Crucially, cairo's types are FOREIGN structs in
// GObject-Introspection, so a GI function taking/returning a cairo pointer (e.g. a
// Gtk.DrawingArea draw-func's cairo_t) marshals through this module — which is why
// an npm cairo package can't stand in.
//
// This module mirrors that surface on Node: the enums are ported verbatim from
// GJS, the constructors wrap the native cairo binding (`src/cairo.cc`, exposed as
// `native.__cairo`), and it registers its wrapper factories so the engine's
// foreign-struct seam can hand a cairo pointer back as a real cairo.Context /
// .Surface / .Pattern instance.
//
// The gjsify `--app node` build aliases the bare `cairo` specifier to this module
// (kept external — `ALIASES_GJS_FOR_NODE`); `imports.cairo` (globals.js) reuses it.
//
// Reference: GJS's cairo module — refs/gjs/modules/core/_cairo.js (enums) +
// refs/gjs/modules/cairo-*.cpp (constructors/methods) + refs/gjs/modules/esm/cairo.js
// (the `Object.assign({}, imports._cairo, cairoNative)` merge shape).
// Copyright (c) 2010 litl, LLC / GJS contributors. MIT OR LGPL-2.0-or-later.

import native from './index.js';

const c = native.__cairo;
if (c === undefined) {
  throw new Error(
    '@gjsify/node-gi/cairo: the native cairo binding is missing from the addon. ' +
      'Rebuild @gjsify/node-gi (node-gyp rebuild) — the addon must link libcairo.',
  );
}

// ---- enums (ported verbatim from refs/gjs/modules/core/_cairo.js) -----------

export const Antialias = { DEFAULT: 0, NONE: 1, GRAY: 2, SUBPIXEL: 3 };

export const Content = { COLOR: 0x1000, ALPHA: 0x2000, COLOR_ALPHA: 0x3000 };

export const Extend = { NONE: 0, REPEAT: 1, REFLECT: 2, PAD: 3 };

export const FillRule = { WINDING: 0, EVEN_ODD: 1 };

export const Filter = { FAST: 0, GOOD: 1, BEST: 2, NEAREST: 3, BILINEAR: 4, GAUSSIAN: 5 };

export const FontSlant = { NORMAL: 0, ITALIC: 1, OBLIQUE: 2 };

export const FontWeight = { NORMAL: 0, BOLD: 1 };

export const Format = { ARGB32: 0, RGB24: 1, A8: 2, A1: 3, RGB16_565: 4 };

export const LineCap = {
  BUTT: 0,
  ROUND: 1,
  SQUARE: 2,
  /** @deprecated Historical typo of {@link LineCap.SQUARE}, kept for compatibility. */
  SQUASH: 2,
};

export const LineJoin = { MITER: 0, ROUND: 1, BEVEL: 2 };

export const Operator = {
  CLEAR: 0,
  SOURCE: 1,
  OVER: 2,
  IN: 3,
  OUT: 4,
  ATOP: 5,
  DEST: 6,
  DEST_OVER: 7,
  DEST_IN: 8,
  DEST_OUT: 9,
  DEST_ATOP: 10,
  XOR: 11,
  ADD: 12,
  SATURATE: 13,
  MULTIPLY: 14,
  SCREEN: 15,
  OVERLAY: 16,
  DARKEN: 17,
  LIGHTEN: 18,
  COLOR_DODGE: 19,
  COLOR_BURN: 20,
  HARD_LIGHT: 21,
  SOFT_LIGHT: 22,
  DIFFERENCE: 23,
  EXCLUSION: 24,
  HSL_HUE: 25,
  HSL_SATURATION: 26,
  HSL_COLOR: 27,
  HSL_LUMINOSITY: 28,
};

export const PatternType = { SOLID: 0, SURFACE: 1, LINEAR: 2, RADIAL: 3 };

export const SurfaceType = {
  IMAGE: 0,
  PDF: 1,
  PS: 2,
  XLIB: 3,
  XCB: 4,
  GLITZ: 5,
  QUARTZ: 6,
  WIN32: 7,
  BEOS: 8,
  DIRECTFB: 9,
  SVG: 10,
  OS2: 11,
  WIN32_PRINTING: 12,
  QUARTZ_IMAGE: 13,
};

// ---- wrappers ---------------------------------------------------------------
//
// Each JS wrapper holds its native cairo handle (a type-tagged External) under a
// non-enumerable `_ptr` property — kept in sync with kCairoPtrProp in src/cairo.cc
// (the foreign to_func reads it; the native methods take `this._ptr` directly).

const H = '_ptr';

function setHandle(obj, handle) {
  Object.defineProperty(obj, H, { value: handle, writable: true, configurable: true });
  return obj;
}

// Build a wrapper for an existing native handle WITHOUT running the class
// constructor (which would allocate a fresh cairo object) — used by the static
// `create*` factories + the foreign from_func factories.
function wrapRaw(Klass, handle) {
  return setHandle(Object.create(Klass.prototype), handle);
}

function handleOf(x, what) {
  const h = x != null ? x[H] : undefined;
  if (h === undefined) throw new TypeError(`expected a ${what}`);
  return h;
}

/** cairo drawing context. `new cairo.Context(surface)` wraps `cairo_create`. */
export class Context {
  constructor(surface) {
    setHandle(this, c.contextCreate(handleOf(surface, 'cairo.Surface')));
  }

  save() {
    c.save(this[H]);
  }
  restore() {
    c.restore(this[H]);
  }
  newPath() {
    c.newPath(this[H]);
  }
  closePath() {
    c.closePath(this[H]);
  }

  moveTo(x, y) {
    c.moveTo(this[H], x, y);
  }
  lineTo(x, y) {
    c.lineTo(this[H], x, y);
  }
  relMoveTo(dx, dy) {
    c.relMoveTo(this[H], dx, dy);
  }
  relLineTo(dx, dy) {
    c.relLineTo(this[H], dx, dy);
  }
  rectangle(x, y, width, height) {
    c.rectangle(this[H], x, y, width, height);
  }
  arc(xc, yc, radius, angle1, angle2) {
    c.arc(this[H], xc, yc, radius, angle1, angle2);
  }
  arcNegative(xc, yc, radius, angle1, angle2) {
    c.arcNegative(this[H], xc, yc, radius, angle1, angle2);
  }
  curveTo(x1, y1, x2, y2, x3, y3) {
    c.curveTo(this[H], x1, y1, x2, y2, x3, y3);
  }

  fill() {
    c.fill(this[H]);
  }
  fillPreserve() {
    c.fillPreserve(this[H]);
  }
  stroke() {
    c.stroke(this[H]);
  }
  strokePreserve() {
    c.strokePreserve(this[H]);
  }
  paint() {
    c.paint(this[H]);
  }
  paintWithAlpha(alpha) {
    c.paintWithAlpha(this[H], alpha);
  }
  clip() {
    c.clip(this[H]);
  }
  clipPreserve() {
    c.clipPreserve(this[H]);
  }

  translate(tx, ty) {
    c.translate(this[H], tx, ty);
  }
  scale(sx, sy) {
    c.scale(this[H], sx, sy);
  }
  rotate(angle) {
    c.rotate(this[H], angle);
  }
  identityMatrix() {
    c.identityMatrix(this[H]);
  }
  newSubPath() {
    c.newSubPath(this[H]);
  }
  /** User → device coordinates as `[x, y]` (GJS return shape). */
  userToDevice(x, y) {
    return c.userToDevice(this[H], x, y);
  }
  /** User → device distance (ignores translation) as `[dx, dy]`. */
  userToDeviceDistance(dx, dy) {
    return c.userToDeviceDistance(this[H], dx, dy);
  }
  /** Device → user coordinates as `[x, y]`. */
  deviceToUser(x, y) {
    return c.deviceToUser(this[H], x, y);
  }
  /** Device → user distance (ignores translation) as `[dx, dy]`. */
  deviceToUserDistance(dx, dy) {
    return c.deviceToUserDistance(this[H], dx, dy);
  }
  /** Copy the current path into an owned {@link Path} handle. */
  copyPath() {
    return wrapRaw(Path, c.copyPath(this[H]));
  }
  /** Like {@link copyPath} but with curves flattened to line segments. */
  copyPathFlat() {
    return wrapRaw(Path, c.copyPathFlat(this[H]));
  }
  appendPath(path) {
    c.appendPath(this[H], handleOf(path, 'cairo.Path'));
  }
  /**
   * Set the stroke dash pattern. GJS semantics: holes/undefined entries are
   * skipped, a non-positive value throws, an empty array disables dashing.
   */
  setDash(dashes, offset) {
    c.setDash(this[H], dashes, offset);
  }
  getDashCount() {
    return c.getDashCount(this[H]);
  }
  /**
   * The current dash pattern as `[dashes, offset]`.
   * Note: GJS ships only `getDashCount`; this is a node-gi convenience.
   */
  getDash() {
    return c.getDash(this[H]);
  }
  inFill(x, y) {
    return c.inFill(this[H], x, y);
  }
  inStroke(x, y) {
    return c.inStroke(this[H], x, y);
  }

  setSourceRGB(red, green, blue) {
    c.setSourceRGB(this[H], red, green, blue);
  }
  setSourceRGBA(red, green, blue, alpha) {
    c.setSourceRGBA(this[H], red, green, blue, alpha);
  }
  setSource(pattern) {
    c.setSource(this[H], handleOf(pattern, 'cairo.Pattern'));
  }
  setSourceSurface(surface, x, y) {
    c.setSourceSurface(this[H], handleOf(surface, 'cairo.Surface'), x, y);
  }
  /** The context's current source pattern (a ref of its own — safe to keep). */
  getSource() {
    return wrapPatternHandle(c.getSource(this[H]));
  }

  setLineWidth(width) {
    c.setLineWidth(this[H], width);
  }
  getLineWidth() {
    return c.getLineWidth(this[H]);
  }
  getOperator() {
    return c.getOperator(this[H]);
  }
  getLineCap() {
    return c.getLineCap(this[H]);
  }
  getLineJoin() {
    return c.getLineJoin(this[H]);
  }
  getFillRule() {
    return c.getFillRule(this[H]);
  }
  getAntialias() {
    return c.getAntialias(this[H]);
  }
  getMiterLimit() {
    return c.getMiterLimit(this[H]);
  }
  getTolerance() {
    return c.getTolerance(this[H]);
  }
  hasCurrentPoint() {
    return c.hasCurrentPoint(this[H]);
  }
  /** The current path point as `[x, y]`. */
  getCurrentPoint() {
    return c.getCurrentPoint(this[H]);
  }
  /** Current-path bounding box as `[x1, y1, x2, y2]`. */
  pathExtents() {
    return c.pathExtents(this[H]);
  }
  /** Fill bounding box as `[x1, y1, x2, y2]`. */
  fillExtents() {
    return c.fillExtents(this[H]);
  }
  /** Stroke bounding box as `[x1, y1, x2, y2]`. */
  strokeExtents() {
    return c.strokeExtents(this[H]);
  }
  /** Clip bounding box as `[x1, y1, x2, y2]`. */
  clipExtents() {
    return c.clipExtents(this[H]);
  }
  setLineCap(lineCap) {
    c.setLineCap(this[H], lineCap);
  }
  setLineJoin(lineJoin) {
    c.setLineJoin(this[H], lineJoin);
  }
  setFillRule(fillRule) {
    c.setFillRule(this[H], fillRule);
  }
  setAntialias(antialias) {
    c.setAntialias(this[H], antialias);
  }
  setOperator(op) {
    c.setOperator(this[H], op);
  }
  setMiterLimit(limit) {
    c.setMiterLimit(this[H], limit);
  }
  setTolerance(tolerance) {
    c.setTolerance(this[H], tolerance);
  }

  status() {
    return c.status(this[H]);
  }

  /** Eagerly destroy the underlying `cairo_t` (GJS `$dispose`). */
  $dispose() {
    c.dispose(this[H]);
  }
}

/** cairo surface base class — the shared Surface API (flush/finish/writeToPNG/…). */
export class Surface {
  getType() {
    return c.surfaceGetType(this[H]);
  }
  status() {
    return c.surfaceStatus(this[H]);
  }
  flush() {
    c.surfaceFlush(this[H]);
  }
  finish() {
    c.surfaceFinish(this[H]);
  }
  writeToPNG(filename) {
    c.surfaceWriteToPNG(this[H], filename);
  }
  /** Eagerly destroy the underlying `cairo_surface_t` (GJS `$dispose`). */
  $dispose() {
    c.dispose(this[H]);
  }
}

/** An in-memory image surface (`cairo_image_surface_*`). */
export class ImageSurface extends Surface {
  constructor(format, width, height) {
    super();
    setHandle(this, c.imageSurfaceCreate(format, width, height));
  }

  static create(format, width, height) {
    return new ImageSurface(format, width, height);
  }
  static createFromPNG(filename) {
    return wrapRaw(ImageSurface, c.imageSurfaceCreateFromPNG(filename));
  }

  getWidth() {
    return c.imageSurfaceGetWidth(this[H]);
  }
  getHeight() {
    return c.imageSurfaceGetHeight(this[H]);
  }
  getStride() {
    return c.imageSurfaceGetStride(this[H]);
  }
  getFormat() {
    return c.imageSurfaceGetFormat(this[H]);
  }
  /**
   * The raw pixel buffer as a fresh Uint8Array copy (length = stride * height).
   * Note: GJS ships no `getData`; this is a node-gi convenience for headless pixel
   * assertions. The buffer is flushed first + copied (independent of the surface).
   */
  getData() {
    return c.imageSurfaceGetData(this[H]);
  }
}

/** cairo pattern base class. */
export class Pattern {
  getType() {
    return c.patternGetType(this[H]);
  }
  status() {
    return c.patternStatus(this[H]);
  }
  /** Eagerly destroy the underlying `cairo_pattern_t` (GJS `$dispose`). */
  $dispose() {
    c.dispose(this[H]);
  }
}

/** A solid-color pattern (`cairo_pattern_create_rgb[a]`). */
export class SolidPattern extends Pattern {
  static createRGB(red, green, blue) {
    return wrapRaw(SolidPattern, c.solidPatternCreateRGB(red, green, blue));
  }
  static createRGBA(red, green, blue, alpha) {
    return wrapRaw(SolidPattern, c.solidPatternCreateRGBA(red, green, blue, alpha));
  }
}

/** Gradient base class — the shared color-stop API (GJS `CairoGradient`). */
export class Gradient extends Pattern {
  addColorStopRGB(offset, red, green, blue) {
    c.patternAddColorStopRGB(this[H], offset, red, green, blue);
  }
  addColorStopRGBA(offset, red, green, blue, alpha) {
    c.patternAddColorStopRGBA(this[H], offset, red, green, blue, alpha);
  }
}

/** A linear gradient (`cairo_pattern_create_linear`). */
export class LinearGradient extends Gradient {
  constructor(x0, y0, x1, y1) {
    super();
    setHandle(this, c.linearGradientCreate(x0, y0, x1, y1));
  }
}

/** A radial gradient (`cairo_pattern_create_radial`). */
export class RadialGradient extends Gradient {
  constructor(cx0, cy0, radius0, cx1, cy1, radius1) {
    super();
    setHandle(this, c.radialGradientCreate(cx0, cy0, radius0, cx1, cy1, radius1));
  }
}

/** A surface-backed pattern (`cairo_pattern_create_for_surface`). */
export class SurfacePattern extends Pattern {
  constructor(surface) {
    super();
    setHandle(this, c.surfacePatternCreate(handleOf(surface, 'cairo.Surface')));
  }

  setExtend(extend) {
    c.patternSetExtend(this[H], extend);
  }
  getExtend() {
    return c.patternGetExtend(this[H]);
  }
  setFilter(filter) {
    c.patternSetFilter(this[H], filter);
  }
  getFilter() {
    return c.patternGetFilter(this[H]);
  }
}

/**
 * An opaque copied path (`cairo_path_t`, from `Context.copyPath[Flat]()`).
 * Method-less in GJS too — it only round-trips through `appendPath` / GI calls.
 * The underlying path is destroyed on GC (`cairo_path_destroy`).
 */
export class Path {}

// Fan a pattern handle out to the concrete subclass by cairo runtime type —
// mirrors gjs_cairo_pattern_from_pattern (MESH/RASTER_SOURCE fall back to the
// base Pattern; gjs throws for those, but they are unreachable from this module).
function wrapPatternHandle(handle) {
  const t = c.patternGetType(handle);
  const Klass =
    t === PatternType.SOLID
      ? SolidPattern
      : t === PatternType.SURFACE
        ? SurfacePattern
        : t === PatternType.LINEAR
          ? LinearGradient
          : t === PatternType.RADIAL
            ? RadialGradient
            : Pattern;
  return wrapRaw(Klass, handle);
}

// Register the wrapper factories so the engine's foreign-struct from_func can turn
// a returned/callback cairo pointer into the right JS instance. Surface + Pattern
// fan out to the concrete subclass by cairo runtime type (mirrors
// CairoSurface::from_c_ptr / gjs_cairo_pattern_from_pattern).
c.setup({
  context: (handle) => wrapRaw(Context, handle),
  surface: (handle) =>
    wrapRaw(c.surfaceGetType(handle) === SurfaceType.IMAGE ? ImageSurface : Surface, handle),
  pattern: (handle) => wrapPatternHandle(handle),
  path: (handle) => wrapRaw(Path, handle),
});

// The default export mirrors GJS's ESM `cairo` object (enums + constructors), the
// shape `import cairo from 'cairo'` returns.
const cairo = {
  Antialias,
  Content,
  Extend,
  FillRule,
  Filter,
  FontSlant,
  FontWeight,
  Format,
  LineCap,
  LineJoin,
  Operator,
  PatternType,
  SurfaceType,
  Context,
  Surface,
  ImageSurface,
  Pattern,
  SolidPattern,
  Gradient,
  LinearGradient,
  RadialGradient,
  SurfacePattern,
  Path,
};

export default cairo;
