// installWindowEventBus against mock hosts — pure JS, so it runs on Node and GJS alike.

import { describe, it, expect } from '@gjsify/unit';

import { KeyboardEvent as OurKeyboardEvent } from './index.js';
import { installWindowEventBus, type WindowEventBusHost } from './window-event-bus.js';

export const WindowEventBusTest = async () => {
    await describe('installWindowEventBus on a host with a NATIVE addEventListener (bun/deno shape)', async () => {
        // Regression: bun and deno ship a native `globalThis.addEventListener`.
        // The old guard ("only install when missing") skipped the gjsify bus
        // there entirely — window listeners (Excalibur Keyboard.init) landed on
        // the native runtime EventTarget while the GTK event-bridge dispatched
        // into the missing `__gjsify_globalEventTarget` → keyboard input dead
        // on bun/deno while gjs/node worked.
        const makeNativeHost = () => {
            const nativeCalls: { add: unknown[][]; remove: unknown[][] } = { add: [], remove: [] };
            const host: WindowEventBusHost = {
                addEventListener: (...args: unknown[]) => {
                    nativeCalls.add.push(args);
                },
                removeEventListener: (...args: unknown[]) => {
                    nativeCalls.remove.push(args);
                },
            };
            return { host, nativeCalls };
        };

        await it('installs the bus even when a native addEventListener pre-exists', async () => {
            const { host } = makeNativeHost();
            const bus = installWindowEventBus(host);
            expect(host.__gjsify_globalEventTarget).toBe(bus);
            expect(typeof host.addEventListener).toBe('function');
        });

        await it('bus dispatch (the event-bridge path) reaches listeners added via host.addEventListener', async () => {
            const { host } = makeNativeHost();
            const bus = installWindowEventBus(host);
            const received: string[] = [];
            host.addEventListener?.('keydown', (e: OurKeyboardEvent) => received.push(e.key));
            bus.dispatchEvent(
                new OurKeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true }) as never,
            );
            expect(received).toContain('ArrowRight');
        });

        await it('registrations are also forwarded to the pre-existing native surface', async () => {
            const { host, nativeCalls } = makeNativeHost();
            installWindowEventBus(host);
            const listener = () => {};
            host.addEventListener?.('error', listener);
            expect(nativeCalls.add.length).toBe(1);
            host.removeEventListener?.('error', listener);
            expect(nativeCalls.remove.length).toBe(1);
        });

        await it('removeEventListener detaches from the bus', async () => {
            const { host } = makeNativeHost();
            const bus = installWindowEventBus(host);
            const received: string[] = [];
            const listener = (e: OurKeyboardEvent) => received.push(e.key);
            host.addEventListener?.('keydown', listener);
            host.removeEventListener?.('keydown', listener);
            bus.dispatchEvent(new OurKeyboardEvent('keydown', { key: 'a', bubbles: true }) as never);
            expect(received.length).toBe(0);
        });

        await it('is idempotent — a second install returns the SAME bus', async () => {
            const { host } = makeNativeHost();
            const first = installWindowEventBus(host);
            const second = installWindowEventBus(host);
            expect(second).toBe(first);
        });
    });
};
