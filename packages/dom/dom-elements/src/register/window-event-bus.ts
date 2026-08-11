// Window-scope event bus installer for `register/document.ts`, kept side-effect free so the
// register can pass `globalThis` and tests a mock host.

import { EventTarget as OurEventTarget } from '@gjsify/dom-events';

/** Structural view of the window-scope event-target surface on a global-like host. */
export interface WindowEventBusHost {
    __gjsify_globalEventTarget?: OurEventTarget;
    addEventListener?: (type: string, listener: unknown, options?: unknown) => void;
    removeEventListener?: (type: string, listener: unknown, options?: unknown) => void;
    dispatchEvent?: (event: unknown) => boolean;
}

type AnyListener = Parameters<OurEventTarget['addEventListener']>[1];
type AnyAddOpts = Parameters<OurEventTarget['addEventListener']>[2];
type AnyRemoveOpts = Parameters<OurEventTarget['removeEventListener']>[2];

/**
 * Install the gjsify window-scope event bus (`__gjsify_globalEventTarget`) on `host` and route
 * `addEventListener` / `removeEventListener` / `dispatchEvent` through it.
 *
 * Installs unconditionally, because the bus must be the same object the GTK→DOM bridge dispatches
 * on (`@gjsify/event-bridge` `attachEventControllers()` → `getGlobalEventTarget()`) or window-level
 * input is lost. Bun and Deno ship a native `globalThis.addEventListener` where GJS and Node do
 * not, so an install-only-when-missing guard split the bus there: Excalibur's `Keyboard.init`
 * listeners sat on the native EventTarget while the bridge dispatched into a never-installed gjsify
 * bus, leaving keyboard input dead on bun/deno with the identical bundle working on gjs/node.
 *
 * A pre-existing native surface is not discarded — registrations are forwarded to it too, so
 * genuinely native events (Deno's 'unload', bun's 'error') still arrive. Dispatch goes to the
 * gjsify bus only; the runtime never fires DOM input events globally, so nothing double-fires.
 */
export function installWindowEventBus(host: WindowEventBusHost): OurEventTarget {
    // A second register pass must not create a second bus — the event-bridge may already hold
    // listeners on the first one.
    if (host.__gjsify_globalEventTarget) return host.__gjsify_globalEventTarget;

    const bus = new OurEventTarget();
    // Capture a pre-existing native surface BEFORE overwriting it.
    const nativeAdd = typeof host.addEventListener === 'function' ? host.addEventListener.bind(host) : null;
    const nativeRemove = typeof host.removeEventListener === 'function' ? host.removeEventListener.bind(host) : null;

    host.__gjsify_globalEventTarget = bus;

    // defineProperty (not assignment): a native global may be exposed through
    // an accessor; a plain strict-mode assignment to a setter-less accessor
    // would throw where defineProperty redefines it.
    const define = (name: 'addEventListener' | 'removeEventListener' | 'dispatchEvent', value: unknown) =>
        Object.defineProperty(host, name, { value, writable: true, configurable: true });

    define('addEventListener', (type: string, listener: unknown, options?: unknown) => {
        bus.addEventListener(type, listener as AnyListener, options as AnyAddOpts);
        nativeAdd?.(type, listener, options);
    });
    define('removeEventListener', (type: string, listener: unknown, options?: unknown) => {
        bus.removeEventListener(type, listener as AnyListener, options as AnyRemoveOpts);
        nativeRemove?.(type, listener, options);
    });
    define('dispatchEvent', (event: unknown) =>
        bus.dispatchEvent(event as Parameters<OurEventTarget['dispatchEvent']>[0]),
    );

    return bus;
}
