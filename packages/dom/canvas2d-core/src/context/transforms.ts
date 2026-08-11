// Affine-transform methods for CanvasRenderingContext2D.
// Reference: refs/node-canvas — Canvas 2D affine transform semantics.

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
    interface CanvasRenderingContext2D extends TransformMethods {}
}

// Nothing below reaches Cairo unless Cairo can represent it, because a non-finite value or a
// non-invertible transform poisons the context permanently: it raises `invalid matrix (not
// invertible)` and every later call on that Cairo.Context throws, including the ones that would
// have recovered it. Canvas 2D has neither failure mode — a non-finite argument is a silent no-op
// and a zero scale just draws nothing. Excalibur scales entities to zero during normal play, which
// took down the whole 2D renderer on the first frame after a fallback (gjsify#1107).

const transformMethods: TransformMethods & ThisType<CanvasRenderingContext2D> = {
    translate(this: CanvasRenderingContext2D, x: number, y: number): void {
        this._ensureSurface();
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        this._ctx.translate(x, y);
    },

    rotate(this: CanvasRenderingContext2D, angle: number): void {
        this._ensureSurface();
        if (!Number.isFinite(angle)) return;
        this._ctx.rotate(angle);
    },

    scale(this: CanvasRenderingContext2D, x: number, y: number): void {
        this._ensureSurface();
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        if (x === 0 || y === 0) {
            // Legal, and it means "draw nothing" — not "fail".
            this._state.transformIsSingular = true;
            return;
        }
        this._ctx.scale(x, y);
    },

    /**
     * Multiply the current transformation matrix by the given values.
     * Matrix: [a c e]
     *         [b d f]
     *         [0 0 1]
     */
    transform(this: CanvasRenderingContext2D, a: number, b: number, c: number, d: number, e: number, f: number): void {
        this._ensureSurface();
        if (
            !Number.isFinite(a) ||
            !Number.isFinite(b) ||
            !Number.isFinite(c) ||
            !Number.isFinite(d) ||
            !Number.isFinite(e) ||
            !Number.isFinite(f)
        ) {
            return;
        }
        // GJS' Cairo.Context exposes no generic `transform(matrix)` or `setMatrix()`, only
        // translate/rotate/scale/identityMatrix, so the matrix is decomposed into those. Shear is
        // dropped: expressing it needs the combined matrix multiply this binding lacks.
        // A zero determinant is the matrix form of `scale(0, …)` — representable in Canvas 2D, not
        // in Cairo, so it gets the same treatment.
        if (a * d - b * c === 0) {
            this._state.transformIsSingular = true;
            return;
        }
        const tx = e;
        const ty = f;
        const sx = Math.hypot(a, b);
        const sy = Math.hypot(c, d);
        const rotation = Math.atan2(b, a);
        this._ctx.translate(tx, ty);
        if (rotation !== 0) this._ctx.rotate(rotation);
        if (sx !== 1 || sy !== 1) this._ctx.scale(sx, sy);
    },

    /** Resets to identity, then applies the given matrix. */
    setTransform(
        this: CanvasRenderingContext2D,
        a?: number | DOMMatrix2DInit,
        b?: number,
        c?: number,
        d?: number,
        e?: number,
        f?: number,
    ): void {
        this._ensureSurface();
        // Replaces the transform outright, so whatever made the old one singular
        // is gone; `transform()` below re-flags it if the new one is too.
        this._state.transformIsSingular = false;
        if (typeof a === 'object' && a !== null) {
            const m = a;
            this._ctx.identityMatrix();
            this.transform(
                m.a ?? m.m11 ?? 1,
                m.b ?? m.m12 ?? 0,
                m.c ?? m.m21 ?? 0,
                m.d ?? m.m22 ?? 1,
                m.e ?? m.m41 ?? 0,
                m.f ?? m.m42 ?? 0,
            );
        } else if (typeof a === 'number') {
            this._ctx.identityMatrix();
            this.transform(a, b!, c!, d!, e!, f!);
        } else {
            this._ctx.identityMatrix();
        }
    },

    getTransform(this: CanvasRenderingContext2D): DOMMatrix {
        // GJS' Cairo.Context exposes no `getMatrix()`, so [a,b,c,d,e,f] is reconstructed from three
        // userToDevice probes:
        //   userToDevice(0, 0) = (e,     f)      — translation
        //   userToDevice(1, 0) = (a + e, b + f)  — first basis vector
        //   userToDevice(0, 1) = (c + e, d + f)  — second basis vector
        // Cairo holds the last INVERTIBLE matrix, so under a singular canvas transform that
        // reconstruction would report a matrix that still draws — the opposite of what is in effect.
        // Hence the collapse is reported instead; which singular matrix it was cannot be recovered,
        // Cairo never held it.
        if (this._state.transformIsSingular) {
            const t = this._ctx.userToDevice(0, 0);
            return makeMatrix(0, 0, 0, 0, t[0] ?? 0, t[1] ?? 0);
        }
        const origin = this._ctx.userToDevice(0, 0);
        const xAxis = this._ctx.userToDevice(1, 0);
        const yAxis = this._ctx.userToDevice(0, 1);
        const e = origin[0] ?? 0;
        const f = origin[1] ?? 0;
        const a = (xAxis[0] ?? 0) - e;
        const b = (xAxis[1] ?? 0) - f;
        const c = (yAxis[0] ?? 0) - e;
        const d = (yAxis[1] ?? 0) - f;
        return makeMatrix(a, b, c, d, e, f);
    },

    resetTransform(this: CanvasRenderingContext2D): void {
        this._ensureSurface();
        this._state.transformIsSingular = false;
        this._ctx.identityMatrix();
    },
};

/** Build a `DOMMatrix` when the global exists, else a structurally equal plain object. */
function makeMatrix(a: number, b: number, c: number, d: number, e: number, f: number): DOMMatrix {
    const DOMMatrixCtor = (globalThis as CanvasGlobalThis).DOMMatrix;
    if (typeof DOMMatrixCtor === 'function') {
        return new DOMMatrixCtor([a, b, c, d, e, f]);
    }
    const fallback: DOMMatrix2DLike = {
        a,
        b,
        c,
        d,
        e,
        f,
        m11: a,
        m12: b,
        m13: 0,
        m14: 0,
        m21: c,
        m22: d,
        m23: 0,
        m24: 0,
        m31: 0,
        m32: 0,
        m33: 1,
        m34: 0,
        m41: e,
        m42: f,
        m43: 0,
        m44: 1,
        is2D: true,
        isIdentity: a === 1 && b === 0 && c === 0 && d === 1 && e === 0 && f === 0,
    };
    return fallback as unknown as DOMMatrix;
}

/** Install transform methods on CanvasRenderingContext2D.prototype. */
export function installTransformMethods(proto: object): void {
    Object.assign(proto, transformMethods);
}
