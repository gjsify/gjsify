// Canvas 2D transform tests — verifies Cairo.Context affine matrix
// decomposition (translate + rotate + scale) and getTransform round-trip
// via userToDevice. Cairo.Context in GJS does not expose a generic
// transform(matrix) call, so canvas2d-core decomposes the supplied 2D
// affine matrix [a,b,c,d,e,f] into primitive translate/rotate/scale calls.
//
// These tests lock in the fix made for the excalibur-jelly-jumper showcase,
// which exercises multiply/transform/setTransform inside its Canvas 2D
// fallback rendering path.

import { describe, it, expect } from '@gjsify/unit';
import { CanvasRenderingContext2D } from './canvas-rendering-context-2d.js';

function makeCtx(width = 100, height = 100): CanvasRenderingContext2D {
    const canvas = { width, height };
    return new CanvasRenderingContext2D(canvas);
}

/** Assert two numbers are equal to within an epsilon. */
function nearlyEqual(actual: number, expected: number, eps = 1e-9): boolean {
    return Math.abs(actual - expected) < eps;
}

export default async () => {
    await describe('CanvasRenderingContext2D — transforms', async () => {
        await describe('getTransform initial state', async () => {
            await it('returns identity for a fresh context', async () => {
                const ctx = makeCtx();
                const m = ctx.getTransform();
                expect(nearlyEqual(m.a, 1)).toBe(true);
                expect(nearlyEqual(m.b, 0)).toBe(true);
                expect(nearlyEqual(m.c, 0)).toBe(true);
                expect(nearlyEqual(m.d, 1)).toBe(true);
                expect(nearlyEqual(m.e, 0)).toBe(true);
                expect(nearlyEqual(m.f, 0)).toBe(true);
            });
        });

        await describe('translate', async () => {
            await it('updates e and f in getTransform', async () => {
                const ctx = makeCtx();
                ctx.translate(10, 20);
                const m = ctx.getTransform();
                expect(nearlyEqual(m.a, 1)).toBe(true);
                expect(nearlyEqual(m.d, 1)).toBe(true);
                expect(nearlyEqual(m.e, 10)).toBe(true);
                expect(nearlyEqual(m.f, 20)).toBe(true);
            });

            await it('composes translations cumulatively', async () => {
                const ctx = makeCtx();
                ctx.translate(10, 20);
                ctx.translate(5, 7);
                const m = ctx.getTransform();
                expect(nearlyEqual(m.e, 15)).toBe(true);
                expect(nearlyEqual(m.f, 27)).toBe(true);
            });
        });

        await describe('scale', async () => {
            await it('updates a and d in getTransform', async () => {
                const ctx = makeCtx();
                ctx.scale(2, 3);
                const m = ctx.getTransform();
                expect(nearlyEqual(m.a, 2)).toBe(true);
                expect(nearlyEqual(m.d, 3)).toBe(true);
            });

            await it('composes with a prior translate (translate then scale)', async () => {
                const ctx = makeCtx();
                ctx.translate(10, 20);
                ctx.scale(2, 2);
                const m = ctx.getTransform();
                expect(nearlyEqual(m.a, 2)).toBe(true);
                expect(nearlyEqual(m.d, 2)).toBe(true);
                expect(nearlyEqual(m.e, 10)).toBe(true);
                expect(nearlyEqual(m.f, 20)).toBe(true);
            });
        });

        await describe('transform (multiply-by-affine)', async () => {
            await it('pure translate via transform(1,0,0,1,tx,ty)', async () => {
                const ctx = makeCtx();
                ctx.transform(1, 0, 0, 1, 15, 25);
                const m = ctx.getTransform();
                expect(nearlyEqual(m.a, 1)).toBe(true);
                expect(nearlyEqual(m.d, 1)).toBe(true);
                expect(nearlyEqual(m.e, 15)).toBe(true);
                expect(nearlyEqual(m.f, 25)).toBe(true);
            });

            await it('pure scale via transform(sx,0,0,sy,0,0)', async () => {
                const ctx = makeCtx();
                ctx.transform(3, 0, 0, 4, 0, 0);
                const m = ctx.getTransform();
                expect(nearlyEqual(m.a, 3)).toBe(true);
                expect(nearlyEqual(m.d, 4)).toBe(true);
            });

            await it('ignores NaN / Infinity values without crashing', async () => {
                const ctx = makeCtx();
                // Excalibur can emit non-finite matrices during scene
                // transitions — our Cairo binding must not crash on them.
                ctx.transform(NaN, 0, 0, 1, 0, 0);
                ctx.transform(1, 0, 0, 1, Infinity, 0);
                // Transform was no-op'd, so state is still identity
                const m = ctx.getTransform();
                expect(nearlyEqual(m.a, 1)).toBe(true);
            });
        });

        await describe('setTransform', async () => {
            await it('resets the matrix then applies the new transform (numeric)', async () => {
                const ctx = makeCtx();
                ctx.translate(100, 100);
                ctx.setTransform(2, 0, 0, 2, 5, 10);
                const m = ctx.getTransform();
                expect(nearlyEqual(m.a, 2)).toBe(true);
                expect(nearlyEqual(m.d, 2)).toBe(true);
                expect(nearlyEqual(m.e, 5)).toBe(true);
                expect(nearlyEqual(m.f, 10)).toBe(true);
            });

            await it('accepts a DOMMatrix-like object (a,b,c,d,e,f)', async () => {
                const ctx = makeCtx();
                ctx.setTransform({ a: 2, b: 0, c: 0, d: 2, e: 5, f: 10 });
                const m = ctx.getTransform();
                expect(nearlyEqual(m.a, 2)).toBe(true);
                expect(nearlyEqual(m.d, 2)).toBe(true);
                expect(nearlyEqual(m.e, 5)).toBe(true);
                expect(nearlyEqual(m.f, 10)).toBe(true);
            });

            await it('no-arg resets to identity', async () => {
                const ctx = makeCtx();
                ctx.translate(10, 10);
                ctx.scale(5, 5);
                ctx.setTransform();
                const m = ctx.getTransform();
                expect(nearlyEqual(m.a, 1)).toBe(true);
                expect(nearlyEqual(m.d, 1)).toBe(true);
                expect(nearlyEqual(m.e, 0)).toBe(true);
                expect(nearlyEqual(m.f, 0)).toBe(true);
            });
        });

        await describe('save / restore', async () => {
            await it('restore reverts the matrix set inside a save block', async () => {
                const ctx = makeCtx();
                ctx.translate(10, 20);
                ctx.save();
                ctx.scale(5, 5);
                ctx.translate(100, 200);
                ctx.restore();
                const m = ctx.getTransform();
                expect(nearlyEqual(m.a, 1)).toBe(true);
                expect(nearlyEqual(m.d, 1)).toBe(true);
                expect(nearlyEqual(m.e, 10)).toBe(true);
                expect(nearlyEqual(m.f, 20)).toBe(true);
            });
        });

        await describe('Excalibur-style multiply pattern', async () => {
            await it('ctx.setTransform(ctx.getTransform().multiply(other)) round-trips', async () => {
                // getTransform returns a real DOMMatrix instance only when
                // globalThis.DOMMatrix is installed (via @gjsify/dom-elements).
                // Inject a minimal DOMMatrix for this test so the multiply
                // code path runs end-to-end.
                if (typeof (globalThis as Record<string, unknown>).DOMMatrix === 'undefined') {
                    class TestDOMMatrix {
                        a = 1;
                        b = 0;
                        c = 0;
                        d = 1;
                        e = 0;
                        f = 0;
                        constructor(init?: number[]) {
                            if (Array.isArray(init) && init.length === 6) {
                                this.a = init[0];
                                this.b = init[1];
                                this.c = init[2];
                                this.d = init[3];
                                this.e = init[4];
                                this.f = init[5];
                            }
                        }
                        multiply(o: { a: number; b: number; c: number; d: number; e: number; f: number }) {
                            const a = this.a * o.a + this.c * o.b;
                            const b = this.b * o.a + this.d * o.b;
                            const c = this.a * o.c + this.c * o.d;
                            const d = this.b * o.c + this.d * o.d;
                            const e = this.a * o.e + this.c * o.f + this.e;
                            const f = this.b * o.e + this.d * o.f + this.f;
                            return new TestDOMMatrix([a, b, c, d, e, f]);
                        }
                    }
                    (globalThis as Record<string, unknown>).DOMMatrix = TestDOMMatrix;
                }

                const ctx = makeCtx();
                ctx.translate(50, 50);
                // Simulate Excalibur's GraphicsContext2DCanvas.multiply():
                //     ctx.setTransform(ctx.getTransform().multiply(otherMatrix))
                const current = ctx.getTransform() as DOMMatrix & { multiply?: (o: DOMMatrix) => DOMMatrix };
                expect(typeof current.multiply).toBe('function');
                const other = { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 } as unknown as DOMMatrix;
                const composed = current.multiply(other);
                ctx.setTransform(composed);
                const final = ctx.getTransform();
                // translate(50,50) then scale(2,2) → matrix [2,0,0,2,50,50]
                expect(nearlyEqual(final.a, 2)).toBe(true);
                expect(nearlyEqual(final.d, 2)).toBe(true);
                expect(nearlyEqual(final.e, 50)).toBe(true);
                expect(nearlyEqual(final.f, 50)).toBe(true);
            });
        });

        // Cairo cannot hold a non-invertible matrix: `cairo_scale(0, 0)` puts the
        // context into a permanent "invalid matrix (not invertible)" error state
        // and EVERY later call on it throws, including the ones that would reset
        // it. Canvas 2D has no such failure — a collapsed transform just draws
        // nothing. Excalibur scales entities to zero in normal play, which is how
        // this took down the whole 2D renderer on the first frame after a
        // renderer fallback (gjsify#1107).
        await describe('degenerate and non-finite transforms', async () => {
            await it('survives a zero scale and keeps drawing afterwards', async () => {
                const ctx = makeCtx();
                ctx.scale(0, 0);
                // The poisoned-context symptom was a throw HERE, not above.
                ctx.translate(10, 10);
                ctx.fillRect(0, 0, 10, 10);
                ctx.resetTransform();
                ctx.translate(5, 5);
                const m = ctx.getTransform();
                expect(nearlyEqual(m.a, 1)).toBe(true);
                expect(nearlyEqual(m.e, 5)).toBe(true);
            });

            await it('reports the collapse rather than the last usable matrix', async () => {
                const ctx = makeCtx();
                ctx.scale(2, 2);
                ctx.scale(0, 1);
                const m = ctx.getTransform();
                expect(m.a).toBe(0);
                expect(m.d).toBe(0);
            });

            await it('treats a zero-determinant matrix the same way', async () => {
                const ctx = makeCtx();
                ctx.transform(1, 2, 2, 4, 0, 0);
                ctx.fillRect(0, 0, 10, 10);
                ctx.resetTransform();
                expect(nearlyEqual(ctx.getTransform().a, 1)).toBe(true);
            });

            await it('setTransform to an invertible matrix recovers', async () => {
                const ctx = makeCtx();
                ctx.scale(0, 0);
                ctx.setTransform(1, 0, 0, 1, 7, 9);
                const m = ctx.getTransform();
                expect(nearlyEqual(m.a, 1)).toBe(true);
                expect(nearlyEqual(m.e, 7)).toBe(true);
            });

            await it('ignores non-finite arguments instead of poisoning Cairo', async () => {
                const ctx = makeCtx();
                ctx.translate(10, 10);
                ctx.translate(Number.NaN, 0);
                ctx.scale(Number.POSITIVE_INFINITY, 1);
                ctx.rotate(Number.NaN);
                const m = ctx.getTransform();
                expect(nearlyEqual(m.a, 1)).toBe(true);
                expect(nearlyEqual(m.e, 10)).toBe(true);
            });
        });
    });
};
