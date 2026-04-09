// Tests for DOM/browser stubs added for Excalibur.js and other game engines:
//   - DOMMatrix (2D math, Canvas 2D compatibility)
//   - CSSStyleDeclaration.setProperty / getPropertyValue
//   - FontFace / FontFaceSet (font loading no-op)
//   - MediaQueryList / matchMedia (responsive checks)
//   - location (file:// stub)
//
// Cross-platform: runs on both Node.js and GJS without /register side effects.
// GJS-specific globalThis tests (FontFace on globalThis, keyboard EventTarget) live in register.spec.ts.
//
// Locks in the fixes made to ship the excalibur-jelly-jumper showcase on GJS.

import { describe, it, expect } from '@gjsify/unit';

import {
    DOMMatrix,
    CSSStyleDeclaration,
    FontFace,
    FontFaceSet,
    MediaQueryList,
    matchMedia,
    location,
} from '@gjsify/dom-elements';

export default async () => {

    await describe('DOMMatrix', async () => {

        await describe('constructor', async () => {
            await it('creates an identity matrix by default', async () => {
                const m = new DOMMatrix();
                expect(m.a).toBe(1);
                expect(m.b).toBe(0);
                expect(m.c).toBe(0);
                expect(m.d).toBe(1);
                expect(m.e).toBe(0);
                expect(m.f).toBe(0);
                expect(m.is2D).toBe(true);
                expect(m.isIdentity).toBe(true);
            });

            await it('accepts a 6-element 2D affine array', async () => {
                const m = new DOMMatrix([1, 2, 3, 4, 5, 6]);
                expect(m.a).toBe(1);
                expect(m.b).toBe(2);
                expect(m.c).toBe(3);
                expect(m.d).toBe(4);
                expect(m.e).toBe(5);
                expect(m.f).toBe(6);
                expect(m.is2D).toBe(true);
            });

            await it('mirrors 2D components into m11-m42 3D fields', async () => {
                const m = new DOMMatrix([1, 2, 3, 4, 5, 6]);
                expect(m.m11).toBe(1); // a
                expect(m.m12).toBe(2); // b
                expect(m.m21).toBe(3); // c
                expect(m.m22).toBe(4); // d
                expect(m.m41).toBe(5); // e
                expect(m.m42).toBe(6); // f
            });

            await it('accepts a 16-element 3D array and sets is2D=false', async () => {
                const m = new DOMMatrix([
                    1, 2, 3, 4,
                    5, 6, 7, 8,
                    9, 10, 11, 12,
                    13, 14, 15, 16,
                ]);
                expect(m.m11).toBe(1);
                expect(m.m44).toBe(16);
                expect(m.is2D).toBe(false);
            });

            await it('isIdentity is false for non-identity matrices', async () => {
                const m = new DOMMatrix([2, 0, 0, 2, 0, 0]);
                expect(m.isIdentity).toBe(false);
            });
        });

        await describe('multiply', async () => {
            await it('multiplying by identity yields the original matrix', async () => {
                const a = new DOMMatrix([2, 0, 0, 3, 10, 20]);
                const i = new DOMMatrix();
                const r = a.multiply(i);
                expect(r.a).toBe(2);
                expect(r.d).toBe(3);
                expect(r.e).toBe(10);
                expect(r.f).toBe(20);
            });

            await it('composes two scale matrices correctly', async () => {
                const a = new DOMMatrix([2, 0, 0, 3, 0, 0]);
                const b = new DOMMatrix([4, 0, 0, 5, 0, 0]);
                const r = a.multiply(b);
                // Scale(2,3) * Scale(4,5) = Scale(8, 15)
                expect(r.a).toBe(8);
                expect(r.d).toBe(15);
                expect(r.e).toBe(0);
                expect(r.f).toBe(0);
            });

            await it('composes a translate after a scale', async () => {
                // scale(2,2) then translate(10,20): the translate is multiplied
                // by the current scale, so the result translates by (20,40).
                const scale = new DOMMatrix([2, 0, 0, 2, 0, 0]);
                const translate = new DOMMatrix([1, 0, 0, 1, 10, 20]);
                const r = scale.multiply(translate);
                expect(r.a).toBe(2);
                expect(r.d).toBe(2);
                expect(r.e).toBe(20);
                expect(r.f).toBe(40);
            });

            await it('returns a new matrix without mutating the receiver', async () => {
                const a = new DOMMatrix([2, 0, 0, 2, 0, 0]);
                const b = new DOMMatrix([3, 0, 0, 3, 0, 0]);
                a.multiply(b);
                expect(a.a).toBe(2); // unchanged
            });
        });

        await describe('inverse', async () => {
            await it('identity inverse is identity', async () => {
                const m = new DOMMatrix().inverse();
                expect(m.a).toBe(1);
                expect(m.d).toBe(1);
                expect(m.e).toBe(0);
                expect(m.f).toBe(0);
            });

            await it('scale(2,2) inverse is scale(0.5, 0.5)', async () => {
                const m = new DOMMatrix([2, 0, 0, 2, 0, 0]).inverse();
                expect(m.a).toBe(0.5);
                expect(m.d).toBe(0.5);
            });

            await it('translate(10,20) inverse is translate(-10,-20)', async () => {
                const m = new DOMMatrix([1, 0, 0, 1, 10, 20]).inverse();
                expect(m.e).toBe(-10);
                expect(m.f).toBe(-20);
            });

            await it('inverse of non-invertible matrix returns identity (graceful)', async () => {
                // det = 0 (both rows proportional)
                const m = new DOMMatrix([1, 2, 2, 4, 0, 0]).inverse();
                expect(m.a).toBe(1);
                expect(m.d).toBe(1);
            });
        });

        await describe('translate / scale helpers', async () => {
            await it('translate returns a new matrix with the composed translation', async () => {
                const m = new DOMMatrix().translate(5, 7);
                expect(m.e).toBe(5);
                expect(m.f).toBe(7);
            });

            await it('scale returns a new matrix with the composed scale', async () => {
                const m = new DOMMatrix().scale(3, 4);
                expect(m.a).toBe(3);
                expect(m.d).toBe(4);
            });

            await it('scale with a single argument uses uniform scale', async () => {
                const m = new DOMMatrix().scale(2);
                expect(m.a).toBe(2);
                expect(m.d).toBe(2);
            });
        });
    });

    await describe('CSSStyleDeclaration', async () => {
        await it('stores properties via setProperty and reads them via getPropertyValue', async () => {
            const style = new CSSStyleDeclaration();
            style.setProperty('--ex-pixel-ratio', '2');
            expect(style.getPropertyValue('--ex-pixel-ratio')).toBe('2');
        });

        await it('removeProperty returns and clears the value', async () => {
            const style = new CSSStyleDeclaration();
            style.setProperty('color', 'red');
            const removed = style.removeProperty('color');
            expect(removed).toBe('red');
            expect(style.getPropertyValue('color')).toBe('');
        });

        await it('getPropertyValue returns empty string for unknown properties', async () => {
            const style = new CSSStyleDeclaration();
            expect(style.getPropertyValue('nonexistent')).toBe('');
        });

        await it('getPropertyPriority is always empty (stub)', async () => {
            const style = new CSSStyleDeclaration();
            style.setProperty('color', 'red');
            expect(style.getPropertyPriority('color')).toBe('');
        });

        await it('cssText setter parses declarations into camelCase properties', async () => {
            const style = new CSSStyleDeclaration();
            style.cssText = 'background-color: rgba(0,0,0,0); color: red';
            expect((style as any).backgroundColor).toBe('rgba(0,0,0,0)');
            expect((style as any).color).toBe('red');
        });

        await it('cssText getter returns the last assigned value', async () => {
            const style = new CSSStyleDeclaration();
            style.cssText = 'color: blue';
            expect(style.cssText).toBe('color: blue');
        });

        await it('cssText setter handles single-property strings (Excalibur rgbaSupport check)', async () => {
            // Excalibur does: el.style.cssText = 'background-color:rgba(135,100,100,.5)'
            // then reads el.style.backgroundColor to detect rgba support.
            const style = new CSSStyleDeclaration();
            style.cssText = 'background-color:rgba(135,100,100,.5)';
            const bg = (style as any).backgroundColor as string;
            expect(typeof bg).toBe('string');
            expect(bg.length).toBeGreaterThan(0);
        });
    });

    await describe('FontFace / FontFaceSet stubs', async () => {
        await it('FontFace constructor accepts family and source', async () => {
            const face = new FontFace('MyFont', 'url(font.ttf)');
            expect(face.family).toBe('MyFont');
            expect(face.source).toBe('url(font.ttf)');
            expect(face.status).toBe('unloaded');
        });

        await it('FontFace.load resolves with the face and marks it loaded', async () => {
            const face = new FontFace('MyFont', 'url(font.ttf)');
            const loaded = await face.load();
            expect(loaded).toBe(face);
            expect(face.status).toBe('loaded');
        });

        await it('FontFaceSet add/has/size are no-ops (stub)', async () => {
            const set = new FontFaceSet();
            const face = new FontFace('A', 'url(a.ttf)');
            set.add(face);
            // no-op stub: has() always returns false, size always 0
            expect(set.has(face)).toBe(false);
            expect(set.size).toBe(0);
        });

        await it('FontFaceSet.ready resolves with the set', async () => {
            const set = new FontFaceSet();
            const ready = await set.ready;
            expect(ready).toBe(set);
        });

        await it('FontFaceSet does NOT inherit from EventTarget', async () => {
            // This is critical: dom-elements/register runs BEFORE dom-events/
            // register, so EventTarget would be undefined at class load time.
            // The stub provides its own no-op addEventListener instead.
            const set = new FontFaceSet();
            expect(typeof set.addEventListener).toBe('function');
            expect(typeof set.removeEventListener).toBe('function');
        });
    });

    await describe('MediaQueryList / matchMedia', async () => {
        await it('matchMedia returns a MediaQueryList with matches=false', async () => {
            const mq = matchMedia('(min-width: 800px)');
            expect(mq instanceof MediaQueryList).toBe(true);
            expect(mq.media).toBe('(min-width: 800px)');
            expect(mq.matches).toBe(false);
        });
    });

    await describe('location stub', async () => {
        await it('exposes file:// origin and protocol', async () => {
            expect(location.origin).toBe('file://');
            expect(location.protocol).toBe('file:');
        });

        await it('toString returns href', async () => {
            expect(location.toString()).toBe(location.href);
        });
    });

};
