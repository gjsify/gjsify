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

/**
 * The DOM listener modifiers a framework encodes in the PROP NAME.
 *
 * Vue's own `runtime-dom` strips exactly this set in `parseName`
 * (`/(?:Once|Passive|Capture)$/`) before it reaches `addEventListener`, because
 * they are `addEventListener` options and not part of the event name. A host
 * that does not strip them binds a signal that does not exist: `onClickedOnce`
 * kebabed whole to `"clicked-once"` and `<GtkButton> emits no signal
 * "clicked-once"` — a spelling complaint about something the user spelled right.
 *
 * `once` has a GObject meaning and is implemented (a self-disconnecting handler).
 * `capture` and `passive` do NOT, and are refused BY NAME rather than mistranslated.
 */
const MODIFIER_RE = /(?:Once|Passive|Capture)$/;

export interface EventBinding {
    /** The GObject signal name, modifiers removed. */
    signal: string;
    /** `.once`: disconnect after the first emission that actually reaches the callback. */
    once: boolean;
}

/**
 * Split an event prop into the signal GObject knows and the options it does not.
 *
 * Both escape hatches come FIRST and are verbatim: an `eventAliases` entry and
 * the `on:<raw-signal-name>` spelling are the way to bind a signal that really
 * does end in `-once` or `-capture`, exactly as they are the way to bind any
 * other irregular name.
 */
export function parseEventProp(prop: string, aliases?: Readonly<Record<string, string>>): EventBinding {
    if (aliases?.[prop]) return { signal: aliases[prop], once: false };
    if (prop.startsWith('on:')) return { signal: prop.slice(3), once: false }; // raw signal name, verbatim

    let rest = prop.slice(2);
    let once = false;
    // A LOOP, like Vue's own `parseName`: `@click.once.capture` compiles to
    // `onClickOnceCapture`, so one strip would leave `Once` on the signal name.
    for (let m = MODIFIER_RE.exec(rest); m; m = MODIFIER_RE.exec(rest)) {
        const modifier = m[0];
        if (modifier !== 'Once') throw err.eventModifier(prop, modifier.toLowerCase());
        once = true;
        rest = rest.slice(0, rest.length - modifier.length);
    }

    // `onNotify` ALONE is the plain `notify` signal, and it took the generated
    // surface to surface that: GObject.Object declares `notify`, so the generator
    // emits `onNotify` for every widget, and the prefix branch turned it into
    // `notify::` with an empty property name — a prop the surface offers and GJS
    // then refuses with "emits no signal notify::".
    if (rest === 'Notify') return { signal: 'notify', once };
    if (rest.startsWith('Notify')) return { signal: `notify::${kebab(rest.slice(6))}`, once };
    return { signal: kebab(rest), once };
}

/** `onRowActivated` -> `row-activated`; `onNotifyVisible` -> `notify::visible`. */
export const toSignalName = (prop: string, aliases?: Readonly<Record<string, string>>): string =>
    parseEventProp(prop, aliases).signal;

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
    const { signal, once } = parseEventProp(prop, el.descriptor.eventAliases);
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
        // A `notify::` raised by our own patch is not a user event — and it must
        // not spend a `.once` either, or the one emission the user asked for is
        // consumed by our own property write.
        if (isNotify && inHostWrite()) return undefined;
        if (once) {
            // Disconnect BEFORE calling: a callback that re-enters its own widget
            // would otherwise fire a second time, which is the whole point of
            // `.once`. Guarded on the id we own, because a callback that rebinds
            // the same prop has already replaced this entry.
            const entry = el.handlers.get(signal);
            if (entry?.id === id) {
                target.disconnect(id);
                el.handlers.delete(signal);
            }
        }
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
