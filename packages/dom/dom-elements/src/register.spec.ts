// GJS-only tests for dom-elements/register side effects.
// Verifies that importing /register correctly wires browser globals onto globalThis:
//   - FontFace, FontFaceSet, document.fonts (Excalibur FontSource.load() path)
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
                expect(typeof (globalThis as any).FontFace).toBe('function');
            });

            await it('document.fonts is a FontFaceSet with add() and ready', async () => {
                const fonts = (globalThis as any).document?.fonts;
                expect(fonts).toBeDefined();
                expect(typeof fonts.add).toBe('function');
                const ready = await fonts.ready;
                expect(ready).toBe(fonts);
            });

            await it('FontFace.load() via globalThis resolves and sets status=loaded', async () => {
                const FF = (globalThis as any).FontFace;
                const face = new FF('Round9x13', 'url(/res/fonts/Round9x13.ttf)');
                expect(face.status).toBe('unloaded');
                await face.load();
                expect(face.status).toBe('loaded');
            });

            await it('document.fonts.add() after load does not throw', async () => {
                const FF = (globalThis as any).FontFace;
                const face = new FF('Round9x13', 'url(/res/fonts/Round9x13.ttf)');
                await face.load();
                let threw = false;
                try { (globalThis as any).document.fonts.add(face); } catch { threw = true; }
                expect(threw).toBe(false);
            });
        });

        await describe('globalThis keyboard EventTarget wiring', async () => {
            // Regression: Excalibur's Keyboard.init() calls window.addEventListener('keydown', ...)
            // which must route through __gjsify_globalEventTarget (set in dom-elements/register.ts).
            await it('addEventListener stores listener on __gjsify_globalEventTarget', async () => {
                const received: string[] = [];
                (globalThis as any).addEventListener('keydown', (e: KeyboardEvent) => {
                    received.push(e.key);
                });
                const evt = new OurKeyboardEvent('keydown', {
                    key: 'ArrowRight', code: 'ArrowRight', bubbles: true, cancelable: true,
                });
                (globalThis as any).__gjsify_globalEventTarget.dispatchEvent(evt);
                expect(received).toContain('ArrowRight');
            });

            await it('removeEventListener deregisters listener', async () => {
                const received: string[] = [];
                const handler = (e: KeyboardEvent) => received.push(e.key);
                (globalThis as any).addEventListener('keydown', handler);
                (globalThis as any).removeEventListener('keydown', handler);
                const evt = new OurKeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
                (globalThis as any).__gjsify_globalEventTarget.dispatchEvent(evt);
                expect(received.length).toBe(0);
            });

            await it('__gjsify_globalEventTarget is exposed on globalThis', async () => {
                expect((globalThis as any).__gjsify_globalEventTarget).toBeDefined();
                expect(typeof (globalThis as any).__gjsify_globalEventTarget.addEventListener).toBe('function');
            });

            await it('multiple listeners for the same event type all fire', async () => {
                const log: number[] = [];
                const a = () => log.push(1);
                const b = () => log.push(2);
                (globalThis as any).addEventListener('keyup', a);
                (globalThis as any).addEventListener('keyup', b);
                const evt = new OurKeyboardEvent('keyup', { key: 'x', bubbles: true, cancelable: true });
                (globalThis as any).__gjsify_globalEventTarget.dispatchEvent(evt);
                expect(log).toContain(1);
                expect(log).toContain(2);
                (globalThis as any).removeEventListener('keyup', a);
                (globalThis as any).removeEventListener('keyup', b);
            });
        });

    });
};
