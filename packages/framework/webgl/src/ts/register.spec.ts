// GJS-only tests for @gjsify/webgl/register side effects.
//
// Verifies that importing `/register` wires the WebGL context constructors onto
// globalThis:
//   - globalThis.WebGLRenderingContext / globalThis.WebGL2RenderingContext
//     (owned by this package — ADR 0012 rule 2)
//   - the installed descriptors are writable + configurable, so running the
//     register a second time (or a later `WebGLBridge.installGlobals()`, which
//     writes both unconditionally per ADR 0012 rule 5) cannot throw
//
// Per AGENTS.md testing rule 7 these live in a dedicated file: `/register` pulls
// the Gwebgl/GTK chain through its imports, so it is GJS-only and wrapped in
// `on('Gjs', …)`. Rule 2 (GJS-only package) allows the direct `@gjsify/webgl`
// imports. The context behaviour itself is covered by webgl1/webgl2.spec.ts.

import { describe, it, expect, on } from '@gjsify/unit';
import '@gjsify/webgl/register';
import { WebGLContextBase, WebGLRenderingContext, WebGL2RenderingContext } from '@gjsify/webgl';

/** Typed view of the globals this register installs. */
type _WebGLGlobals = Record<string, unknown>;

export default async () => {
    await on('Gjs', async () => {
        await describe('@gjsify/webgl/register — owned globals', async () => {
            await it('installs WebGLRenderingContext on globalThis', async () => {
                const g = globalThis as _WebGLGlobals;
                expect(typeof g.WebGLRenderingContext).toBe('function');
                expect(g.WebGLRenderingContext).toBe(WebGLRenderingContext);
            });

            await it('installs WebGL2RenderingContext on globalThis', async () => {
                const g = globalThis as _WebGLGlobals;
                expect(typeof g.WebGL2RenderingContext).toBe('function');
                expect(g.WebGL2RenderingContext).toBe(WebGL2RenderingContext);
            });

            await it('installs two distinct constructors over the shared context base', async () => {
                // Guards against a copy-paste register that installs the same
                // class twice. Both are siblings extending WebGLContextBase
                // (WebGL2 is NOT a subclass of WebGL1 here — it re-implements
                // the WebGL1 entry points without its format/type validation).
                const g = globalThis as _WebGLGlobals;
                const Ctor1 = g.WebGLRenderingContext as typeof WebGLRenderingContext;
                const Ctor2 = g.WebGL2RenderingContext as typeof WebGL2RenderingContext;
                expect(Ctor1).not.toBe(Ctor2);
                expect(Object.getPrototypeOf(Ctor1.prototype)).toBe(WebGLContextBase.prototype);
                expect(Object.getPrototypeOf(Ctor2.prototype)).toBe(WebGLContextBase.prototype);
            });
        });

        await describe('@gjsify/webgl/register — idempotency', async () => {
            // ESM evaluates a module once, so "import twice" cannot be observed
            // from inside the bundle. What CAN be observed — and what makes the
            // register safe to run twice (a second `defineProperty`, a later
            // `WebGLBridge.installGlobals()`, a browser that already ships the
            // class) — is the descriptor shape the register writes.
            for (const name of ['WebGLRenderingContext', 'WebGL2RenderingContext']) {
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
