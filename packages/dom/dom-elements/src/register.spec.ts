// GJS-only tests for dom-elements/register side effects.
// Verifies that importing /register correctly wires browser globals onto globalThis:
//   - FontFace, FontFaceSet, document.fonts (Excalibur FontSource.load() path)
//   - FontFace.load() registers TTF in PangoCairo default FontMap (real font rendering)
//   - globalThis.addEventListener/removeEventListener/dispatchEvent via __gjsify_globalEventTarget
//     (Regression: Excalibur's Keyboard.init() calls window.addEventListener)
//
// These tests require /register to have run (GJS only — GTK/Gio present).
// Cross-platform stub tests live in stubs.spec.ts.

import { describe, it, expect, on } from '@gjsify/unit';
import '@gjsify/dom-elements/register';
import { KeyboardEvent as OurKeyboardEvent } from '@gjsify/dom-events';

export default async () => {
    await on('Gjs', async () => {
        await describe('globalThis FontFace / document.fonts', async () => {
            // Excalibur's FontSource.load() uses these via globalThis (no import).
            await it('FontFace is available as a constructor on globalThis', async () => {
                expect(typeof (globalThis as Record<string, unknown>).FontFace).toBe('function');
            });

            await it('document.fonts is a FontFaceSet with add() and ready', async () => {
                // oxlint-disable-next-line typescript/no-explicit-any -- dynamic globalThis property; FontFaceSet is a runtime-injected DOM type not present in GJS types
                const fonts = ((globalThis as Record<string, unknown>).document as any)?.fonts;
                expect(fonts).toBeDefined();
                expect(typeof fonts.add).toBe('function');
                const ready = await fonts.ready;
                expect(ready).toBe(fonts);
            });

            await it('FontFace.load() via globalThis resolves and sets status=loaded', async () => {
                const FF = (globalThis as Record<string, unknown>).FontFace as new (...args: unknown[]) => { status: string; load: () => Promise<void> };
                const face = new FF('Round9x13', 'url(/res/fonts/Round9x13.ttf)');
                expect(face.status).toBe('unloaded');
                await face.load();
                expect(face.status).toBe('loaded');
            });

            await it('document.fonts.add() after load does not throw', async () => {
                const FF = (globalThis as Record<string, unknown>).FontFace as new (...args: unknown[]) => { status: string; load: () => Promise<void> };
                const face = new FF('Round9x13', 'url(/res/fonts/Round9x13.ttf)');
                await face.load();
                let threw = false;
                try {
                    // oxlint-disable-next-line typescript/no-explicit-any -- dynamic globalThis property; document.fonts is a runtime-injected DOM type
                    ((globalThis as Record<string, unknown>).document as any).fonts.add(face);
                } catch {
                    threw = true;
                }
                expect(threw).toBe(false);
            });
        });

        await describe('FontFace real load via PangoCairo', async () => {
            // Verifies that a file:// URL triggers add_font_file on the PangoCairo
            // default FontMap, making the font available to Canvas2D fillText.
            // Uses DejaVuSans which is present on Fedora and most Linux distros.
            const TTF = '/usr/share/fonts/dejavu-sans-fonts/DejaVuSans.ttf';

            await it('load() with file:// URL registers font and sets status=loaded', async () => {
                const FF = (globalThis as Record<string, unknown>).FontFace as new (...args: unknown[]) => { status: string; load: () => Promise<void> };
                const face = new FF('DejaVuTestFont', `url(file://${TTF})`);
                expect(face.status).toBe('unloaded');
                await face.load();
                expect(face.status).toBe('loaded');
            });

            // Note: ink rendering test (fillText with registered font) lives in
            // packages/dom/canvas2d-core or @gjsify/canvas2d tests — canvas2d
            // depends on dom-elements so importing it here would be circular.
        });

        await describe('globalThis keyboard EventTarget wiring', async () => {
            // Regression: Excalibur's Keyboard.init() calls window.addEventListener('keydown', ...)
            // which must route through __gjsify_globalEventTarget (set in dom-elements/register.ts).
            await it('addEventListener stores listener on __gjsify_globalEventTarget', async () => {
                const received: string[] = [];
                type EventTargetLike = { addEventListener: (type: string, listener: unknown) => void; removeEventListener: (type: string, listener: unknown) => void; dispatchEvent: (evt: unknown) => void };
                (globalThis as unknown as EventTargetLike).addEventListener('keydown', (e: OurKeyboardEvent) => {
                    received.push(e.key);
                });
                const evt = new OurKeyboardEvent('keydown', {
                    key: 'ArrowRight',
                    code: 'ArrowRight',
                    bubbles: true,
                    cancelable: true,
                });
                ((globalThis as Record<string, unknown>).__gjsify_globalEventTarget as EventTargetLike).dispatchEvent(evt);
                expect(received).toContain('ArrowRight');
            });

            await it('removeEventListener deregisters listener', async () => {
                const received: string[] = [];
                type EventTargetLike = { addEventListener: (type: string, listener: unknown) => void; removeEventListener: (type: string, listener: unknown) => void; dispatchEvent: (evt: unknown) => void };
                const handler = (e: OurKeyboardEvent) => received.push(e.key);
                (globalThis as unknown as EventTargetLike).addEventListener('keydown', handler);
                (globalThis as unknown as EventTargetLike).removeEventListener('keydown', handler);
                const evt = new OurKeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
                ((globalThis as Record<string, unknown>).__gjsify_globalEventTarget as EventTargetLike).dispatchEvent(evt);
                expect(received.length).toBe(0);
            });

            await it('__gjsify_globalEventTarget is exposed on globalThis', async () => {
                type EventTargetLike = { addEventListener: (type: string, listener: unknown) => void; removeEventListener: (type: string, listener: unknown) => void; dispatchEvent: (evt: unknown) => void };
                const target = (globalThis as Record<string, unknown>).__gjsify_globalEventTarget as EventTargetLike | undefined;
                expect(target).toBeDefined();
                expect(typeof target?.addEventListener).toBe('function');
            });

            await it('multiple listeners for the same event type all fire', async () => {
                type EventTargetLike = { addEventListener: (type: string, listener: unknown) => void; removeEventListener: (type: string, listener: unknown) => void; dispatchEvent: (evt: unknown) => void };
                const log: number[] = [];
                const a = () => log.push(1);
                const b = () => log.push(2);
                const gThis = globalThis as unknown as EventTargetLike;
                gThis.addEventListener('keyup', a);
                gThis.addEventListener('keyup', b);
                const evt = new OurKeyboardEvent('keyup', { key: 'x', bubbles: true, cancelable: true });
                ((globalThis as Record<string, unknown>).__gjsify_globalEventTarget as EventTargetLike).dispatchEvent(evt);
                expect(log).toContain(1);
                expect(log).toContain(2);
                gThis.removeEventListener('keyup', a);
                gThis.removeEventListener('keyup', b);
            });
        });

        await describe('window scroll globals', async () => {
            // Excalibur's getPosition() computes `rect.x + window.scrollX`.
            // Without these stubs scrollX is undefined → NaN coords → blank
            // canvas on any drag/pan. Regression test for map-editor.
            await it('scrollX and scrollY default to 0', async () => {
                expect((globalThis as Record<string, unknown>).scrollX).toBe(0);
                expect((globalThis as Record<string, unknown>).scrollY).toBe(0);
            });

            await it('legacy pageXOffset and pageYOffset default to 0', async () => {
                expect((globalThis as Record<string, unknown>).pageXOffset).toBe(0);
                expect((globalThis as Record<string, unknown>).pageYOffset).toBe(0);
            });

            await it('rect.x + window.scrollX is a number (no NaN)', async () => {
                type DocumentLike = { createElement: (tag: string) => { getBoundingClientRect: () => { x: number } } };
                const doc = (globalThis as Record<string, unknown>).document as DocumentLike;
                const rect = doc.createElement('div').getBoundingClientRect();
                const pageX = rect.x + ((globalThis as Record<string, unknown>).scrollX as number);
                expect(Number.isFinite(pageX)).toBe(true);
            });
        });
    });
};
