// Regression tests for globalThis keyboard event wiring.
// Verifies that our EventTarget-backed globalThis.addEventListener correctly
// stores and dispatches keyboard listeners — the fix that makes Excalibur's
// Keyboard.init() work on GJS (refs/excalibur/src/engine/input/keyboard.ts:321-329).

import { describe, it, expect, on } from '@gjsify/unit';
import '@gjsify/dom-elements/register';
import { KeyboardEvent as OurKeyboardEvent } from '@gjsify/dom-events';

export default async () => {
    await on('Gjs', async () => {
        await describe('globalThis keyboard events', async () => {
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
                const evt = new OurKeyboardEvent('keydown', {
                    key: 'a', bubbles: true, cancelable: true,
                });
                (globalThis as any).__gjsify_globalEventTarget.dispatchEvent(evt);
                expect(received.length).toBe(0);
            });

            await it('__gjsify_globalEventTarget is exposed on globalThis', async () => {
                expect((globalThis as any).__gjsify_globalEventTarget).toBeDefined();
                expect(typeof (globalThis as any).__gjsify_globalEventTarget.addEventListener).toBe('function');
            });

            await it('multiple listeners for same event type all fire', async () => {
                const log: number[] = [];
                const a = () => log.push(1);
                const b = () => log.push(2);
                (globalThis as any).addEventListener('keyup', a);
                (globalThis as any).addEventListener('keyup', b);
                const evt = new OurKeyboardEvent('keyup', { key: 'x', bubbles: true, cancelable: true });
                (globalThis as any).__gjsify_globalEventTarget.dispatchEvent(evt);
                expect(log).toContain(1);
                expect(log).toContain(2);
                // cleanup
                (globalThis as any).removeEventListener('keyup', a);
                (globalThis as any).removeEventListener('keyup', b);
            });
        });
    });
};
