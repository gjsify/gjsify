// Window-scope event bus installer — shared by `register/document.ts`.
// A plain helper module (no side effects); the register calls it with
// `globalThis`, tests call it with a mock host.

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
 * Install the gjsify window-scope event bus (`__gjsify_globalEventTarget`) on
 * `host` and route `addEventListener` / `removeEventListener` /
 * `dispatchEvent` through it.
 *
 * UNCONDITIONAL BY DESIGN (idempotent via the singleton check): loading this
 * register declares a GTK-hosted DOM environment, so the window-scope bus MUST
 * be the same object the GTK→DOM event-bridge dispatches on
 * (`@gjsify/event-bridge` `attachEventControllers()` → `getGlobalEventTarget()`),
 * or window-level input is lost. Bun and Deno ship a NATIVE
 * `globalThis.addEventListener` (GJS and Node do not) — the previous
 * "only install when missing" guard therefore SPLIT the bus on those runtimes:
 * app listeners (e.g. Excalibur `Keyboard.init`'s 'keydown'/'keyup'/'blur')
 * registered on the native runtime EventTarget while the event-bridge
 * dispatched into the never-installed gjsify bus — keyboard input silently
 * dead on bun/deno while the identical bundle worked on gjs/node (measured on
 * showcases/dom/excalibur-jelly-jumper: focus + controller attachment healthy,
 * `__gjsify_globalEventTarget` undefined, Excalibur received no keys).
 *
 * A pre-existing native surface is not discarded: registrations are ALSO
 * forwarded to it, so genuinely native runtime events (Deno's 'unload' /
 * 'beforeunload', bun's 'error') still reach listeners registered through the
 * window surface. Dispatches go to the gjsify bus only — each event type fires
 * from exactly one side (the runtime never fires DOM input events globally),
 * so nothing double-fires.
 */
export function installWindowEventBus(host: WindowEventBusHost): OurEventTarget {
    // Idempotent: a second register pass must not create a second bus (the
    // event-bridge may already hold listeners on the first one).
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
