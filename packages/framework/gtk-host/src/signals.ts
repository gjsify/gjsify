// Signal binding, and the ledger that makes it reversible.
//
// The DOM removes a listener by identity (`removeEventListener(name, fn)`);
// GObject removes it by handler id (`disconnect(id)`). A renderer only ever
// hands us the new function, so the host has to remember the id. One native
// handler per signal name, disconnect-before-reconnect — anything else leaks a
// handler on every re-render, and the leak is invisible until the widget fires.

import type GObject from '@girs/gobject-2.0';

import { err } from './errors.js';
import type { HostElement } from './types.js';

/** `onRowActivated` -> `row-activated`; `onNotifyVisible` -> `notify::visible`. */
export function toSignalName(prop: string, aliases?: Readonly<Record<string, string>>): string {
    if (aliases?.[prop]) return aliases[prop];
    if (prop.startsWith('on:')) return prop.slice(3); // escape hatch: raw signal name, verbatim
    const rest = prop.slice(2);
    if (rest.startsWith('Notify')) {
        return `notify::${kebab(rest.slice(6))}`;
    }
    return kebab(rest);
}

const kebab = (s: string) =>
    s
        .replace(/^./, (c) => c.toLowerCase())
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .toLowerCase();

/** An event prop is `on:` + a raw signal name, or `on` + an uppercase letter. */
export function isEventProp(prop: string): boolean {
    return (
        prop.startsWith('on:') ||
        (prop.length > 2 &&
            prop.startsWith('on') &&
            prop[2] === prop[2].toUpperCase() &&
            prop[2] !== prop[2].toLowerCase())
    );
}

/**
 * Depth of property writes this host is currently performing.
 *
 * GObject emits `notify::` for our own writes, so a component that binds
 * `onNotifyText` and writes `text` in the handler re-enters itself. The counter
 * is module-wide because a nested write on a DIFFERENT object is still our write.
 */
let writeDepth = 0;
export const beginHostWrite = () => {
    writeDepth += 1;
};
export const endHostWrite = () => {
    writeDepth -= 1;
};
export const inHostWrite = () => writeDepth > 0;

export function setHandler(el: HostElement, prop: string, next: ((...args: unknown[]) => unknown) | null): void {
    const signal = toSignalName(prop, el.descriptor.eventAliases);
    const existing = el.handlers.get(signal);
    const target = el.widget as unknown as GObject.Object & {
        connect(s: string, cb: (...a: unknown[]) => unknown): number;
        disconnect(id: number): void;
    };

    // Two props can resolve to one signal. Replacing the other's handler here
    // would be exactly the silent drop this host exists to refuse: the first
    // callback stops firing and nothing says so.
    if (existing && existing.prop !== prop && next) {
        throw err.signalTaken(el.descriptor.gtype, prop, existing.prop, signal);
    }

    if (existing) {
        target.disconnect(existing.id);
        el.handlers.delete(signal);
    }
    if (!next) return;

    const isNotify = signal.startsWith('notify::');
    const id = target.connect(signal, (...args: unknown[]) => {
        // A `notify::` raised by our own patch is not a user event.
        if (isNotify && inHostWrite()) return undefined;
        return next(...args.slice(1));
    });
    el.handlers.set(signal, { id, prop });
}

/** Disconnect every handler on a node. The only place a handler dies. */
export function clearHandlers(el: HostElement): void {
    if (!el.widget) {
        el.handlers.clear();
        return;
    }
    const target = el.widget as unknown as { disconnect(id: number): void };
    for (const { id } of el.handlers.values()) target.disconnect(id);
    el.handlers.clear();
}
