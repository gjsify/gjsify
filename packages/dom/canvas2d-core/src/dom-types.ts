// Internal interface declarations for the DOM-shaped objects that
// CanvasRenderingContext2D consumes.
//
// canvas2d-core deliberately has *no* dependency on @gjsify/dom-elements (that
// would create a cycle: dom-elements → canvas2d-core → dom-elements). Instead
// it accepts duck-typed inputs that match the relevant slice of the WHATWG
// Canvas 2D API. These interfaces document those slices and let the rest of
// the package work against concrete types instead of `any`.

import type Cairo from 'cairo';
import type GdkPixbuf from 'gi://GdkPixbuf';

/**
 * The HTMLCanvasElement-shaped object passed into the
 * `CanvasRenderingContext2D` constructor by the registered context factory.
 *
 * `@gjsify/dom-elements`' `HTMLCanvasElement` satisfies this — but so does any
 * lightweight `{ width, height }` mock used by unit tests. Width/height
 * default to the WHATWG canvas defaults (300×150) when missing.
 */
export interface CanvasLike {
    width?: number;
    height?: number;
}

/**
 * GdkPixbuf-backed image source produced by `@gjsify/dom-elements`'
 * `HTMLImageElement` (and other pixbuf-bearing wrappers).
 *
 * The `isPixbuf()` brand keeps us decoupled from the concrete class while
 * preventing accidental matches against unrelated objects.
 */
export interface PixbufImageSource {
    isPixbuf(): boolean;
    /** @internal — populated by HTMLImageElement once decoding completes. */
    _pixbuf: GdkPixbuf.Pixbuf;
}

/**
 * Canvas-like image source carrying a 2D context whose backing surface can be
 * sampled (used for `drawImage(canvas, …)` and `createPattern(canvas, …)`).
 */
export interface CanvasImageSource extends CanvasLike {
    getContext(contextId: '2d', options?: unknown): CanvasContext2DLike | null;
    getContext(contextId: string, options?: unknown): unknown;
}

/**
 * The minimal slice of `CanvasRenderingContext2D` required to extract pixel
 * data for `drawImage` / `createPattern`. Our own context naturally satisfies
 * this through `_getSurface()`.
 */
export interface CanvasContext2DLike {
    /** @internal — exposes the Cairo backing surface. */
    _getSurface?(): Cairo.ImageSurface;
}

/** Type guard for {@link PixbufImageSource}. */
export function isPixbufImageSource(value: unknown): value is PixbufImageSource {
    if (value === null || typeof value !== 'object') return false;
    const candidate = value as { isPixbuf?: unknown };
    return typeof candidate.isPixbuf === 'function' && (value as PixbufImageSource).isPixbuf();
}

/** Type guard for {@link CanvasImageSource}. */
export function isCanvasImageSource(value: unknown): value is CanvasImageSource {
    if (value === null || typeof value !== 'object') return false;
    return typeof (value as { getContext?: unknown }).getContext === 'function';
}

/**
 * Minimal `DOMMatrix` shape returned by `CanvasRenderingContext2D.getTransform()`
 * when no native `DOMMatrix` constructor is registered. Mirrors the
 * `is2D`-only subset of the WHATWG matrix interface.
 */
export interface DOMMatrix2DLike {
    a: number; b: number; c: number; d: number; e: number; f: number;
    m11: number; m12: number; m13: number; m14: number;
    m21: number; m22: number; m23: number; m24: number;
    m31: number; m32: number; m33: number; m34: number;
    m41: number; m42: number; m43: number; m44: number;
    is2D: boolean;
    isIdentity: boolean;
}

/**
 * Constructor signature for the platform `DOMMatrix`. Lets us reach the
 * runtime constructor through `globalThis` without an `any` cast when an
 * embedder (e.g. `@gjsify/dom-elements`) has registered one.
 */
export type DOMMatrixConstructor = new (init?: number[] | string) => DOMMatrix;

/** Subset of `globalThis` we touch inside this package. */
export interface CanvasGlobalThis {
    DOMMatrix?: DOMMatrixConstructor;
}
