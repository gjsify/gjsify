// Affine-transform methods for CanvasRenderingContext2D.
// Reference: refs/node-canvas — Canvas 2D affine transform semantics.
// Original: see canvas-rendering-context-2d.ts pre-split.

import type { CanvasRenderingContext2D } from '../canvas-rendering-context-2d.js';
import type { CanvasGlobalThis, DOMMatrix2DLike } from '../dom-types.js';

export interface TransformMethods {
    translate(x: number, y: number): void;
    rotate(angle: number): void;
    scale(x: number, y: number): void;
    transform(a: number, b: number, c: number, d: number, e: number, f: number): void;
    setTransform(matrix?: DOMMatrix2DInit): void;
    setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
    getTransform(): DOMMatrix;
    resetTransform(): void;
}

declare module '../canvas-rendering-context-2d.js' {
    interface CanvasRenderingContext2D extends TransformMethods { }
}

const transformMethods: TransformMethods & ThisType<CanvasRenderingContext2D> = {
    translate(this: CanvasRenderingContext2D, x: number, y: number): void {
        this._ensureSurface();
        this._ctx.translate(x, y);
    },

    rotate(this: CanvasRenderingContext2D, angle: number): void {
        this._ensureSurface();
        this._ctx.rotate(angle);
    },

    scale(this: CanvasRenderingContext2D, x: number, y: number): void {
        this._ensureSurface();
        this._ctx.scale(x, y);
    },

    /**
     * Multiply the current transformation matrix by the given values.
     * Matrix: [a c e]
     *         [b d f]
     *         [0 0 1]
     */
    transform(
        this: CanvasRenderingContext2D,
        a: number, b: number, c: number, d: number, e: number, f: number,
    ): void {
        this._ensureSurface();
        // Guard against NaN / undefined / Infinity — Cairo will hard-crash
        // on invalid matrix values.
        if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c) ||
            !Number.isFinite(d) || !Number.isFinite(e) || !Number.isFinite(f)) {
            return;
        }
        // Cairo.Context in GJS does NOT expose a generic `transform(matrix)` /
        // `setMatrix()` call — only `translate()`, `rotate()`, `scale()` and
        // `identityMatrix()`. So we decompose the affine 2D matrix
        //   [a c e]
        //   [b d f]
        //   [0 0 1]
        // into translate + rotate + scale (ignoring shear, which Excalibur /
        // three.js 2D users don't rely on). Shear would require a combined
        // matrix multiply, which isn't available in this binding.
        const tx = e;
        const ty = f;
        const sx = Math.hypot(a, b);
        const sy = Math.hypot(c, d);
        const rotation = Math.atan2(b, a);
        this._ctx.translate(tx, ty);
        if (rotation !== 0) this._ctx.rotate(rotation);
        if (sx !== 1 || sy !== 1) this._ctx.scale(sx, sy);
    },

    /**
     * Reset the transform to identity, then apply the given matrix.
     */
    setTransform(
        this: CanvasRenderingContext2D,
        a?: number | DOMMatrix2DInit, b?: number, c?: number, d?: number, e?: number, f?: number,
    ): void {
        this._ensureSurface();
        if (typeof a === 'object' && a !== null) {
            const m = a;
            this._ctx.identityMatrix();
            this.transform(
                m.a ?? m.m11 ?? 1, m.b ?? m.m12 ?? 0,
                m.c ?? m.m21 ?? 0, m.d ?? m.m22 ?? 1,
                m.e ?? m.m41 ?? 0, m.f ?? m.m42 ?? 0,
            );
        } else if (typeof a === 'number') {
            this._ctx.identityMatrix();
            this.transform(a, b!, c!, d!, e!, f!);
        } else {
            this._ctx.identityMatrix();
        }
    },

    /**
     * Return the current transformation matrix as a DOMMatrix-like object.
     */
    getTransform(this: CanvasRenderingContext2D): DOMMatrix {
        // Cairo.Context in GJS doesn't expose `getMatrix()`, but it does
        // expose `userToDevice(x, y)`. We reconstruct the current affine
        // matrix [a,b,c,d,e,f] by transforming three reference points:
        //   userToDevice(0, 0) = (e,     f)      — translation
        //   userToDevice(1, 0) = (a + e, b + f)  — first basis vector
        //   userToDevice(0, 1) = (c + e, d + f)  — second basis vector
        const origin = this._ctx.userToDevice(0, 0);
        const xAxis  = this._ctx.userToDevice(1, 0);
        const yAxis  = this._ctx.userToDevice(0, 1);
        const e = origin[0] ?? 0;
        const f = origin[1] ?? 0;
        const a = (xAxis[0] ?? 0) - e;
        const b = (xAxis[1] ?? 0) - f;
        const c = (yAxis[0] ?? 0) - e;
        const d = (yAxis[1] ?? 0) - f;

        const DOMMatrixCtor = (globalThis as CanvasGlobalThis).DOMMatrix;
        if (typeof DOMMatrixCtor === 'function') {
            return new DOMMatrixCtor([a, b, c, d, e, f]);
        }
        const fallback: DOMMatrix2DLike = {
            a, b, c, d, e, f,
            m11: a, m12: b, m13: 0, m14: 0,
            m21: c, m22: d, m23: 0, m24: 0,
            m31: 0, m32: 0, m33: 1, m34: 0,
            m41: e, m42: f, m43: 0, m44: 1,
            is2D: true,
            isIdentity: (a === 1 && b === 0 && c === 0 && d === 1 && e === 0 && f === 0),
        };
        return fallback as unknown as DOMMatrix;
    },

    resetTransform(this: CanvasRenderingContext2D): void {
        this._ensureSurface();
        this._ctx.identityMatrix();
    },
};

/** Install transform methods on CanvasRenderingContext2D.prototype. */
export function installTransformMethods(proto: object): void {
    Object.assign(proto, transformMethods);
}
