// Duck-typed slices of the WHATWG Canvas 2D API that CanvasRenderingContext2D consumes. Declared
// here because a dependency on @gjsify/dom-elements would close the cycle
// dom-elements → canvas2d-core → dom-elements.

import type Cairo from 'cairo';

import type { CanvasImageHandle } from './pixel-bridge.js';

/**
 * The HTMLCanvasElement-shaped object the context factory passes into the
 * `CanvasRenderingContext2D` constructor. Missing width/height fall back to the WHATWG canvas
 * defaults, 300×150.
 */
export interface CanvasLike {
    width?: number;
    height?: number;
}

/**
 * GdkPixbuf-backed image source produced by `HTMLImageElement` and other pixbuf-bearing wrappers.
 * The `isPixbuf()` brand keeps this decoupled from the concrete class without matching unrelated
 * objects by accident.
 */
export interface PixbufImageSource {
    isPixbuf(): boolean;
    /**
     * @internal — populated by HTMLImageElement once decoding completes. Typed as
     * {@link CanvasImageHandle} so the headless core needs no `gi://` import; a real
     * `GdkPixbuf.Pixbuf` satisfies it structurally.
     */
    _pixbuf: CanvasImageHandle;
}

/**
 * Canvas-like image source whose 2D context's backing surface can be sampled, for
 * `drawImage(canvas, …)` and `createPattern(canvas, …)`.
 */
export interface CanvasImageSource extends CanvasLike {
    getContext(contextId: '2d', options?: unknown): CanvasContext2DLike | null;
    getContext(contextId: string, options?: unknown): unknown;
}

/**
 * The minimal slice of `CanvasRenderingContext2D` needed to extract pixel data for `drawImage` /
 * `createPattern`.
 */
export interface CanvasContext2DLike {
    /** @internal */
    _getSurface?(): Cairo.ImageSurface;
}

export function isPixbufImageSource(value: unknown): value is PixbufImageSource {
    if (value === null || typeof value !== 'object') return false;
    const candidate = value as { isPixbuf?: unknown };
    return typeof candidate.isPixbuf === 'function' && (value as PixbufImageSource).isPixbuf();
}

export function isCanvasImageSource(value: unknown): value is CanvasImageSource {
    if (value === null || typeof value !== 'object') return false;
    return typeof (value as { getContext?: unknown }).getContext === 'function';
}

/**
 * What `CanvasRenderingContext2D.getTransform()` returns when no native `DOMMatrix` constructor is
 * registered: the `is2D`-only subset of the WHATWG matrix interface.
 */
export interface DOMMatrix2DLike {
    a: number;
    b: number;
    c: number;
    d: number;
    e: number;
    f: number;
    m11: number;
    m12: number;
    m13: number;
    m14: number;
    m21: number;
    m22: number;
    m23: number;
    m24: number;
    m31: number;
    m32: number;
    m33: number;
    m34: number;
    m41: number;
    m42: number;
    m43: number;
    m44: number;
    is2D: boolean;
    isIdentity: boolean;
}

/**
 * Constructor signature for the platform `DOMMatrix`, so the runtime constructor an embedder
 * registered on `globalThis` is reachable without an `any` cast.
 */
export type DOMMatrixConstructor = new (init?: number[] | string) => DOMMatrix;

export interface CanvasGlobalThis {
    DOMMatrix?: DOMMatrixConstructor;
}
