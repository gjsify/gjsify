// SPDX-License-Identifier: MIT
// @gjsify/node-gi/cairo — types for the GJS built-in `cairo` module on Node.

export type CairoEnum = Readonly<Record<string, number>>;

export const Antialias: CairoEnum;
export const Content: CairoEnum;
export const Extend: CairoEnum;
export const FillRule: CairoEnum;
export const Filter: CairoEnum;
export const FontSlant: CairoEnum;
export const FontWeight: CairoEnum;
export const Format: CairoEnum;
export const LineCap: CairoEnum;
export const LineJoin: CairoEnum;
export const Operator: CairoEnum;
export const PatternType: CairoEnum;
export const SurfaceType: CairoEnum;

/** cairo drawing context (`cairo_t`). */
export class Context {
  constructor(surface: Surface);
  save(): void;
  restore(): void;
  newPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  relMoveTo(dx: number, dy: number): void;
  relLineTo(dx: number, dy: number): void;
  rectangle(x: number, y: number, width: number, height: number): void;
  arc(xc: number, yc: number, radius: number, angle1: number, angle2: number): void;
  arcNegative(xc: number, yc: number, radius: number, angle1: number, angle2: number): void;
  curveTo(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): void;
  fill(): void;
  fillPreserve(): void;
  stroke(): void;
  strokePreserve(): void;
  paint(): void;
  paintWithAlpha(alpha: number): void;
  clip(): void;
  clipPreserve(): void;
  translate(tx: number, ty: number): void;
  scale(sx: number, sy: number): void;
  rotate(angle: number): void;
  setSourceRGB(red: number, green: number, blue: number): void;
  setSourceRGBA(red: number, green: number, blue: number, alpha: number): void;
  setSource(pattern: Pattern): void;
  setSourceSurface(surface: Surface, x: number, y: number): void;
  /** The context's current source pattern (own reference; concrete subclass). */
  getSource(): Pattern;
  identityMatrix(): void;
  newSubPath(): void;
  /** User → device coordinates as `[x, y]` (GJS return shape). */
  userToDevice(x: number, y: number): [number, number];
  /** User → device distance (ignores translation) as `[dx, dy]`. */
  userToDeviceDistance(dx: number, dy: number): [number, number];
  /** Device → user coordinates as `[x, y]`. */
  deviceToUser(x: number, y: number): [number, number];
  /** Device → user distance (ignores translation) as `[dx, dy]`. */
  deviceToUserDistance(dx: number, dy: number): [number, number];
  /** Copy the current path into an owned {@link Path} handle. */
  copyPath(): Path;
  /** Like {@link copyPath} but with curves flattened to line segments. */
  copyPathFlat(): Path;
  appendPath(path: Path): void;
  /**
   * Set the stroke dash pattern. GJS semantics: holes/undefined entries are
   * skipped, a non-positive value throws, an empty array disables dashing.
   */
  setDash(dashes: number[], offset: number): void;
  getDashCount(): number;
  /**
   * The current dash pattern as `[dashes, offset]`.
   * Note: GJS ships only `getDashCount`; this is a node-gi convenience.
   */
  getDash(): [number[], number];
  inFill(x: number, y: number): boolean;
  inStroke(x: number, y: number): boolean;
  setLineWidth(width: number): void;
  getLineWidth(): number;
  setLineCap(lineCap: number): void;
  setLineJoin(lineJoin: number): void;
  setFillRule(fillRule: number): void;
  setAntialias(antialias: number): void;
  setOperator(op: number): void;
  setMiterLimit(limit: number): void;
  setTolerance(tolerance: number): void;
  status(): number;
  $dispose(): void;
}

/** cairo surface base class (`cairo_surface_t`). */
export class Surface {
  getType(): number;
  status(): number;
  flush(): void;
  finish(): void;
  writeToPNG(filename: string): void;
  $dispose(): void;
}

/** cairo image surface (`cairo_image_surface_*`). */
export class ImageSurface extends Surface {
  constructor(format: number, width: number, height: number);
  static create(format: number, width: number, height: number): ImageSurface;
  static createFromPNG(filename: string): ImageSurface;
  getWidth(): number;
  getHeight(): number;
  getStride(): number;
  getFormat(): number;
  /** Raw pixel buffer as a fresh Uint8Array copy (length = stride * height). */
  getData(): Uint8Array;
}

/** cairo pattern base class (`cairo_pattern_t`). */
export class Pattern {
  getType(): number;
  status(): number;
  $dispose(): void;
}

/** solid-color pattern. */
export class SolidPattern extends Pattern {
  static createRGB(red: number, green: number, blue: number): SolidPattern;
  static createRGBA(red: number, green: number, blue: number, alpha: number): SolidPattern;
}

/** gradient base class — shared color-stop API. */
export class Gradient extends Pattern {
  addColorStopRGB(offset: number, red: number, green: number, blue: number): void;
  addColorStopRGBA(offset: number, red: number, green: number, blue: number, alpha: number): void;
}

/** linear gradient (`cairo_pattern_create_linear`). */
export class LinearGradient extends Gradient {
  constructor(x0: number, y0: number, x1: number, y1: number);
}

/** radial gradient (`cairo_pattern_create_radial`). */
export class RadialGradient extends Gradient {
  constructor(cx0: number, cy0: number, radius0: number, cx1: number, cy1: number, radius1: number);
}

/** surface-backed pattern (`cairo_pattern_create_for_surface`). */
export class SurfacePattern extends Pattern {
  constructor(surface: Surface);
  setExtend(extend: number): void;
  getExtend(): number;
  setFilter(filter: number): void;
  getFilter(): number;
}

/**
 * Opaque copied path (`cairo_path_t`, from `Context.copyPath[Flat]()`).
 * Method-less in GJS too — round-trips through `appendPath` / GI calls.
 */
export class Path {}

/** The GJS `cairo` module object (`import cairo from 'cairo'`). */
declare const cairo: {
  Antialias: CairoEnum;
  Content: CairoEnum;
  Extend: CairoEnum;
  FillRule: CairoEnum;
  Filter: CairoEnum;
  FontSlant: CairoEnum;
  FontWeight: CairoEnum;
  Format: CairoEnum;
  LineCap: CairoEnum;
  LineJoin: CairoEnum;
  Operator: CairoEnum;
  PatternType: CairoEnum;
  SurfaceType: CairoEnum;
  Context: typeof Context;
  Surface: typeof Surface;
  ImageSurface: typeof ImageSurface;
  Pattern: typeof Pattern;
  SolidPattern: typeof SolidPattern;
  Gradient: typeof Gradient;
  LinearGradient: typeof LinearGradient;
  RadialGradient: typeof RadialGradient;
  SurfacePattern: typeof SurfacePattern;
  Path: typeof Path;
};

export default cairo;
