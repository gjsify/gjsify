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
 * GObject emits for our own writes, so a component that binds `onNotifyText` and
 * writes `text` in the handler re-enters itself. The counter is module-wide
 * because a nested write on a DIFFERENT object is still our write — and that is
 * measured, not assumed: on gjs 1.88.1 / GTK 4.22.4, writing `active` on one
 * grouped `Gtk.CheckButton` makes the OTHER one emit `notify::active` AND
 * `toggled`, on an object the writer never touched.
 *
 * That measurement is also why this is a counter and not
 * `g_signal_handler_block()` on the widget being written. Blocking is exact and
 * leaves foreign handlers alone, which is attractive; it is also strictly weaker,
 * because it can only reach handlers on the ONE object in hand, and the grouped
 * check button above is a handler of ours on another. Both were measured before
 * this comment was written.
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

    const id = target.connect(signal, (...args: unknown[]) => {
        // An emission raised by our own patch is not a user event — and it must
        // not spend a `.once` either, or the one emission the user asked for is
        // consumed by our own property write.
        //
        // This used to read `isNotify && inHostWrite()`, and the narrowing was the
        // defect: `notify::` is not the only signal a property write raises.
        // MEASURED on gjs 1.88.1 / GTK 4.22.4 — `gtk_editable_set_text` is
        // delete-then-insert, so ONE write over existing text emits
        // `Gtk.Editable::changed` TWICE, carrying `["", "abc"]`. A controlled input
        // reads that intermediate empty string as the user clearing the field, so
        // the workaround was to bind `notify::text` instead of the signal that
        // actually means "the text changed". `Gtk.ToggleButton::toggled` re-entered
        // the same way. Both are covered now, because the guard asks who is
        // WRITING rather than which signal arrived.
        //
        // The window is exactly one constructor call or one property write (the
        // four `beginHostWrite` sites in `host.ts`) — child insertion is outside
        // it — so nothing that a user could have caused is inside. One hazard to
        // keep in view if the table grows: a handler the HOST installs on an
        // object whose signals fire from inside a write would now be suppressed.
        // `Gtk.SignalListItemFactory` is the near miss — its `setup`/`bind` do
        // fire from inside a write — and it is safe today for a reason worth
        // stating rather than rediscovering: it is not a curated element, and
        // `@gjsify/react-native`'s list controller connects to it DIRECTLY, so
        // those handlers never pass through here. Curating it would change that.
        if (inHostWrite()) return undefined;
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
