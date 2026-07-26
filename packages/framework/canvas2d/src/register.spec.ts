// GJS-only tests for @gjsify/canvas2d/register side effects.
//
// Verifies that importing `/register` wires the Canvas 2D globals onto
// globalThis and that the DOM pillar's `'2d'` context factory is reachable:
//   - globalThis.ImageData / globalThis.Path2D  (owned by this package)
//   - globalThis.CanvasRenderingContext2D + canvas.getContext('2d')
//     (owned by @gjsify/dom-elements/register/canvas, pulled in by ours)
//   - the installed descriptors are writable + configurable, so running the
//     register a second time (or a later override) cannot throw
//
// Per AGENTS.md testing rule 7 these live in a dedicated file: `/register`
// pulls GTK/Cairo through its import chain, so it is GJS-only and wrapped in
// `on('Gjs', …)`. The class-level tests use named imports and live in
// index.spec.ts.

import { describe, it, expect, on } from '@gjsify/unit';
import '@gjsify/canvas2d/register';
import { HTMLCanvasElement } from '@gjsify/dom-elements';
import { ImageData, Path2D } from '@gjsify/canvas2d-core';

/** Typed view of the globals this register installs. */
type _CanvasGlobals = Record<string, unknown>;

export default async () => {
    await on('Gjs', async () => {
        await describe('@gjsify/canvas2d/register — owned globals', async () => {
            await it('installs ImageData on globalThis', async () => {
                const g = globalThis as _CanvasGlobals;
                expect(typeof g.ImageData).toBe('function');
                expect(g.ImageData).toBe(ImageData);
            });

            await it('installs Path2D on globalThis', async () => {
                const g = globalThis as _CanvasGlobals;
                expect(typeof g.Path2D).toBe('function');
                expect(g.Path2D).toBe(Path2D);
            });

            await it('globalThis.Path2D is constructible and usable', async () => {
                const Ctor = (globalThis as _CanvasGlobals).Path2D as typeof Path2D;
                const path = new Ctor();
                path.rect(0, 0, 4, 4);
                expect(path._ops.length).toBe(1);
            });

            await it('globalThis.ImageData is constructible with the right byte length', async () => {
                const Ctor = (globalThis as _CanvasGlobals).ImageData as typeof ImageData;
                const data = new Ctor(3, 2);
                expect(data.width).toBe(3);
                expect(data.height).toBe(2);
                expect(data.data.length).toBe(3 * 2 * 4);
            });
        });

        await describe("@gjsify/canvas2d/register — delegated '2d' registration", async () => {
            // These come from `@gjsify/dom-elements/register/canvas`, which our
            // register imports instead of duplicating. Asserting them here is
            // what guards the delegation: drop the import and these fail.
            await it('installs CanvasRenderingContext2D on globalThis', async () => {
                expect(typeof (globalThis as _CanvasGlobals).CanvasRenderingContext2D).toBe('function');
            });

            await it("canvas.getContext('2d') returns a working context", async () => {
                const canvas = new HTMLCanvasElement();
                canvas.width = 8;
                canvas.height = 8;
                const ctx = canvas.getContext('2d');
                expect(ctx).not.toBeNull();
                expect(ctx).toBeDefined();
            });

            await it("getContext('2d') is idempotent per canvas (spec)", async () => {
                const canvas = new HTMLCanvasElement();
                canvas.width = 8;
                canvas.height = 8;
                expect(canvas.getContext('2d')).toBe(canvas.getContext('2d'));
            });
        });

        await describe('@gjsify/canvas2d/register — idempotency', async () => {
            // ESM evaluates a module once, so "import twice" cannot be observed
            // from inside the bundle. What CAN be observed — and what makes the
            // register safe to run twice (a second `defineProperty`, a later
            // `installGlobals()`, a browser that already ships the class) — is
            // the descriptor shape the register writes.
            for (const name of ['ImageData', 'Path2D']) {
                await it(`${name} is installed writable + configurable`, async () => {
                    const desc = Object.getOwnPropertyDescriptor(globalThis, name);
                    expect(desc).toBeDefined();
                    expect(desc?.writable).toBe(true);
                    expect(desc?.configurable).toBe(true);
                });

                await it(`re-defining ${name} does not throw`, async () => {
                    const desc = Object.getOwnPropertyDescriptor(globalThis, name)!;
                    let threw = false;
                    try {
                        Object.defineProperty(globalThis, name, desc);
                    } catch {
                        threw = true;
                    }
                    expect(threw).toBe(false);
                });
            }
        });
    });
};
