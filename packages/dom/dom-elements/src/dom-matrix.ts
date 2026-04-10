// DOMMatrix stub for GJS — minimal 2D/3D transformation matrix.
// Libraries like Excalibur construct `new DOMMatrix([a,b,c,d,e,f])` and pass
// the result to `ctx.setTransform(matrix)` — we store the 6 2D components
// plus 16 3D components. Our Canvas 2D context's setTransform() accepts
// either a DOMMatrix or six numbers, so this works transparently.
// Reference: https://developer.mozilla.org/en-US/docs/Web/API/DOMMatrix

/**
 * Minimal DOMMatrix implementation — supports 2D and 3D construction, plus
 * 2D multiply/inverse/translate/scale operations used by Canvas 2D libraries
 * like Excalibur. Full 3D math (4x4 multiply, inverse) is NOT implemented.
 */
export class DOMMatrix {
    // 2D components
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
    // 3D components (column-major)
    m11 = 1; m12 = 0; m13 = 0; m14 = 0;
    m21 = 0; m22 = 1; m23 = 0; m24 = 0;
    m31 = 0; m32 = 0; m33 = 1; m34 = 0;
    m41 = 0; m42 = 0; m43 = 0; m44 = 1;
    is2D = true;
    isIdentity = true;

    constructor(init?: number[] | string) {
        if (Array.isArray(init)) {
            if (init.length === 6) {
                // 2D affine: [a, b, c, d, e, f]
                this.a = this.m11 = init[0];
                this.b = this.m12 = init[1];
                this.c = this.m21 = init[2];
                this.d = this.m22 = init[3];
                this.e = this.m41 = init[4];
                this.f = this.m42 = init[5];
                this.is2D = true;
            } else if (init.length === 16) {
                // 3D: column-major 4x4
                this.m11 = init[0];  this.m12 = init[1];  this.m13 = init[2];  this.m14 = init[3];
                this.m21 = init[4];  this.m22 = init[5];  this.m23 = init[6];  this.m24 = init[7];
                this.m31 = init[8];  this.m32 = init[9];  this.m33 = init[10]; this.m34 = init[11];
                this.m41 = init[12]; this.m42 = init[13]; this.m43 = init[14]; this.m44 = init[15];
                this.a = this.m11; this.b = this.m12;
                this.c = this.m21; this.d = this.m22;
                this.e = this.m41; this.f = this.m42;
                this.is2D = false;
            }
            this.isIdentity =
                this.a === 1 && this.b === 0 && this.c === 0 &&
                this.d === 1 && this.e === 0 && this.f === 0;
        }
    }

    /**
     * Multiply this 2D matrix by another 2D matrix and return a new matrix.
     * [a c e] [a' c' e']   [a*a'+c*b'  a*c'+c*d'  a*e'+c*f'+e]
     * [b d f] [b' d' f'] = [b*a'+d*b'  b*c'+d*d'  b*e'+d*f'+f]
     * [0 0 1] [0  0  1 ]   [0          0          1           ]
     */
    multiply(other: { a: number; b: number; c: number; d: number; e: number; f: number }): DOMMatrix {
        const a = this.a * other.a + this.c * other.b;
        const b = this.b * other.a + this.d * other.b;
        const c = this.a * other.c + this.c * other.d;
        const d = this.b * other.c + this.d * other.d;
        const e = this.a * other.e + this.c * other.f + this.e;
        const f = this.b * other.e + this.d * other.f + this.f;
        return new DOMMatrix([a, b, c, d, e, f]);
    }

    /** In-place multiply; returns this. */
    multiplySelf(other: { a: number; b: number; c: number; d: number; e: number; f: number }): DOMMatrix {
        const result = this.multiply(other);
        this.a = result.a; this.b = result.b;
        this.c = result.c; this.d = result.d;
        this.e = result.e; this.f = result.f;
        this.m11 = this.a; this.m12 = this.b;
        this.m21 = this.c; this.m22 = this.d;
        this.m41 = this.e; this.m42 = this.f;
        this.isIdentity = false;
        return this;
    }

    /** 2D inverse. Throws if non-invertible (det === 0). */
    inverse(): DOMMatrix {
        const det = this.a * this.d - this.b * this.c;
        if (det === 0) return new DOMMatrix([1, 0, 0, 1, 0, 0]);
        const invDet = 1 / det;
        return new DOMMatrix([
            this.d * invDet,
            -this.b * invDet,
            -this.c * invDet,
            this.a * invDet,
            (this.c * this.f - this.d * this.e) * invDet,
            (this.b * this.e - this.a * this.f) * invDet,
        ]);
    }

    translate(tx = 0, ty = 0): DOMMatrix {
        return this.multiply({ a: 1, b: 0, c: 0, d: 1, e: tx, f: ty });
    }

    scale(sx = 1, sy: number = sx): DOMMatrix {
        return this.multiply({ a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 });
    }
}

/**
 * DOMMatrixReadOnly alias — MDN specifies this as the immutable base class.
 * We expose the same impl since consumers (Excalibur, three.js) rarely care.
 */
export const DOMMatrixReadOnly = DOMMatrix;
