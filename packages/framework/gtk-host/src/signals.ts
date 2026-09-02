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
 * The objects whose properties this host is writing right now, innermost last.
 *
 * A stack rather than a counter, because the echo guard needs two facts and not
 * one: WHETHER a host write is open (`inHostWrite`) and WHICH object it is
 * writing (`isHostWriteTarget`). A nested write on a different object is still
 * our write, so the stack is what makes the depth right; `null` is the entry for a
 * window with no object under it — construction, or a write whose non-notify
 * consequences must still reach the consumer (`writeVisible` in `policies.ts`).
 *
 * Why both facts, measured on gjs 1.88.1 / GTK 4.22.4 — an emission during a
 * host write falls into one of two kinds, and only one of them is an echo:
 *
 *  - ON THE OBJECT BEING WRITTEN it is an echo, whatever it is called.
 *    `gtk_editable_set_text` is delete-then-insert, so ONE write over existing
 *    text emits `Gtk.Editable::changed` TWICE carrying `["", "abc"]`, and a
 *    controlled input reads that intermediate empty string as the user clearing
 *    the field. `Gtk.ToggleButton::toggled` echoes an `active` write the same way.
 *  - ON ANY OTHER OBJECT it is a CONSEQUENCE, and the component that receives it
 *    did not write anything. Writing `sensitive` on a `Gtk.Box` emits
 *    `state-flags-changed` on every descendant; writing `visible` maps or unmaps
 *    them; two `Gtk.SpinButton`s over one `Gtk.Adjustment` mean a `value` write on
 *    the first emits `value-changed` on the second; and writing `active` on one
 *    grouped `Gtk.CheckButton` makes the OTHER emit `notify::active` AND
 *    `toggled`. Dropping those is not silencing an echo, it is withholding the
 *    only notice a component will ever get that its widget changed.
 *
 * `notify` is the exception that stays module-wide, and it is the one GObject
 * itself defines: it reports a property, so a property write is the whole of what
 * it can be reporting. That is also what keeps `onNotify` and `onNotifyActive`
 * agreeing about the same write.
 *
 * This is why the guard is not `g_signal_handler_block()` on the widget being
 * written either. Blocking is exact and leaves foreign handlers alone, which is
 * attractive; it cannot express the `notify` half at all, because that half is
 * about an object the writer never touched.
 */
const writeTargets: (object | null)[] = [];
export const beginHostWrite = (target: object | null = null) => {
    writeTargets.push(target);
};
export const endHostWrite = () => {
    writeTargets.pop();
};
export const inHostWrite = () => writeTargets.length > 0;
/** Is this object one whose property the host is writing at this instant? */
export const isHostWriteTarget = (o: object): boolean => writeTargets.includes(o);

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

    // `notify` and `notify::<prop>` both, because they are one signal with one
    // meaning: a property changed. Splitting them made `onNotify` and
    // `onNotifyLabel` disagree about the SAME write, which is how the plain one
    // used to re-enter.
    const isNotify = signal === 'notify' || signal.startsWith('notify::');

    const id = target.connect(signal, (...args: unknown[]) => {
        // The echo of our own patch is not a user event — and it must not spend a
        // `.once` either, or the one emission the user asked for is consumed by
        // our own property write.
        //
        // Two conditions and not one, and the second is the narrow half on
        // purpose. `inHostWrite() && isNotify` alone was too narrow: `notify::` is
        // not the only signal a write raises, so `Gtk.Editable::changed` and
        // `Gtk.ToggleButton::toggled` re-entered the component that had just
        // written `text` or `active`. `inHostWrite()` alone is too WIDE: it drops
        // every consequence a write has on some OTHER object, and a component
        // holding that object never wrote anything to reconcile the news with.
        // Measured, all four dropped and all four restored by
        // `isHostWriteTarget` — `state-flags-changed` on a descendant of a
        // `sensitive` write, `map`/`unmap` on a descendant of a `visible` write,
        // `value-changed` on a second `Gtk.SpinButton` over one `Gtk.Adjustment`,
        // and `toggled` on the other of two grouped `Gtk.CheckButton`s. The
        // module-wide leg keeps only `notify`, which reports nothing but a
        // property.
        //
        // The window is exactly one constructor call, one property write (the four
        // sites in `host.ts`), or the `visible` bracket `hideBeforeRemove` puts
        // around a remove (`writeVisible` in `policies.ts`) — child insertion and
        // the remove itself are outside it — so nothing a user could have caused is
        // inside. What IS inside is everything GTK does as a knock-on, which is why
        // the target matters.
        //
        // One hazard to keep in view if the table grows: a handler the HOST
        // installs on an object whose OWN signals fire from inside a write would
        // be suppressed by the target leg. `Gtk.SignalListItemFactory` is the near
        // miss — its `setup`/`bind` do fire from inside a write, measured — and it
        // is safe today for a reason worth stating rather than rediscovering: it
        // is not a curated element, and `@gjsify/react-native`'s list controller
        // connects to it DIRECTLY, so those handlers never pass through here.
        // Curating it would change that. Curating the CARRIERS it hands back does
        // not: `Gtk.ListItem`, `Gtk.ListHeader`, `Gtk.ColumnViewCell` and
        // `Adw.Toggle` declare no signals of their own at all (measured,
        // `g_signal_list_ids` is empty for each), so `notify` is their whole
        // surface and the target leg never sees them.
        if (inHostWrite() && (isNotify || isHostWriteTarget(target))) return undefined;
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
