// Tests for @gjsify/iframe/register side effects.
//
// Verifies that importing `/register` wires the WebKit-backed iframe element
// into the DOM:
//   - Document.registerElementFactory('iframe') → document.createElement('iframe')
//   - globalThis.HTMLIFrameElement
//   - the global is installed writable + configurable, so a later
//     IFrameBridge.installGlobals() can replace it without throwing
//   - IFrameBridge.installGlobals() installs the SAME pair imperatively
//
// Per AGENTS.md testing rule 7 these live in a dedicated file: `/register` pulls
// WebKit through its import chain, so it runs only where that chain resolves —
// and the gate names every runtime that does: GJS natively, plus the three
// Node-API hosts through node-gi's `requireGi()` once `--app node` has rewritten
// the `gi://` specifiers (ONE bundle serves node, bun and deno). It was
// `on('Gjs', …)` while the node slot was `"none"`, which read as `/register`
// being the one part the node leg could not cover. The GATE was what excluded
// it, not the code — measured, all of these pass on every one of the four.
// A stand-down is only honest until somebody checks. Class-level tests use
// named imports and live in index.spec.ts.

import { describe, it, expect, on } from '@gjsify/unit';
import '@gjsify/iframe/register';
import { Document } from '@gjsify/dom-elements';
// Resolved through the PACKAGE specifier, not `./html-iframe-element.js`: the
// `/register` import above resolves to the built `lib/esm/register.js`, so a
// relative source import here would put a second, non-identical
// `HTMLIFrameElement` class in the bundle and the identity assertions below
// would compare two distinct constructors.
import { HTMLIFrameElement, IFrameBridge } from '@gjsify/iframe';

export default async () => {
    await on(['Gjs', 'Node.js', 'Bun', 'Deno'], async () => {
        await describe('@gjsify/iframe/register — element factory', async () => {
            await it("document.createElement('iframe') returns an HTMLIFrameElement", async () => {
                const doc = new Document();
                const iframe = doc.createElement('iframe');
                expect(iframe instanceof HTMLIFrameElement).toBe(true);
                expect(iframe.tagName).toBe('IFRAME');
            });

            await it('creates a fresh element per call', async () => {
                const doc = new Document();
                expect(doc.createElement('iframe')).not.toBe(doc.createElement('iframe'));
            });

            await it('re-registering the factory does not throw (idempotent)', async () => {
                let threw = false;
                try {
                    Document.registerElementFactory('iframe', () => new HTMLIFrameElement());
                } catch {
                    threw = true;
                }
                expect(threw).toBe(false);
                expect(new Document().createElement('iframe') instanceof HTMLIFrameElement).toBe(true);
            });
        });

        await describe('@gjsify/iframe/register — globalThis.HTMLIFrameElement', async () => {
            await it('installs HTMLIFrameElement on globalThis', async () => {
                const g = globalThis as Record<string, unknown>;
                expect(typeof g.HTMLIFrameElement).toBe('function');
                expect(g.HTMLIFrameElement).toBe(HTMLIFrameElement);
            });

            await it('is installed writable + configurable', async () => {
                // This is what makes the register safe to run twice and lets a
                // later `IFrameBridge.installGlobals()` (an unconditional
                // defineProperty) replace the slot instead of throwing.
                const desc = Object.getOwnPropertyDescriptor(globalThis, 'HTMLIFrameElement');
                expect(desc).toBeDefined();
                expect(desc?.writable).toBe(true);
                expect(desc?.configurable).toBe(true);
            });

            await it('re-defining the global does not throw', async () => {
                const desc = Object.getOwnPropertyDescriptor(globalThis, 'HTMLIFrameElement')!;
                let threw = false;
                try {
                    Object.defineProperty(globalThis, 'HTMLIFrameElement', desc);
                } catch {
                    threw = true;
                }
                expect(threw).toBe(false);
            });
        });

        await describe('IFrameBridge.installGlobals() — imperative counterpart', async () => {
            // `/register` is the tree-shakeable path; `installGlobals()` is the
            // explicit one. They must install the SAME pair — before ADR 0012 the
            // element factory came along for free with the barrel's import side
            // effect, so app code doing `installGlobals()` then
            // `document.createElement('iframe')` has to keep working.
            await it("also registers the 'iframe' element factory", async () => {
                // installGlobals() reads no instance state, so the prototype method
                // is callable directly — no WebKit.WebView realization needed.
                const install = (IFrameBridge.prototype as unknown as { installGlobals: () => void }).installGlobals;
                const savedGlobal = Object.getOwnPropertyDescriptor(globalThis, 'HTMLIFrameElement')!;

                // Point the factory somewhere else first, so a pass can only come
                // from installGlobals() re-registering it.
                class Sentinel extends HTMLIFrameElement {}
                Document.registerElementFactory('iframe', () => new Sentinel());
                expect(new Document().createElement('iframe') instanceof Sentinel).toBe(true);

                try {
                    install.call(IFrameBridge.prototype);
                    const el = new Document().createElement('iframe');
                    expect(el instanceof Sentinel).toBe(false);
                    expect(el instanceof HTMLIFrameElement).toBe(true);
                    expect(el.tagName).toBe('IFRAME');
                    expect((globalThis as Record<string, unknown>).HTMLIFrameElement).toBe(HTMLIFrameElement);
                } finally {
                    Object.defineProperty(globalThis, 'HTMLIFrameElement', savedGlobal);
                }
            });
        });
    });
};
