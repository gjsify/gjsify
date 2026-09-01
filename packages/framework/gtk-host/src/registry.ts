// The widget table.
//
// One table, read by every adapter: no adapter may carry a widget name literal
// or an insertion rule. Hand-maintaining a per-framework table is what stalled
// react-gtk, react-native-gtk4 and svelte-gjs, so there is exactly one here.
//
// The check that MAKES that mechanical is `scripts/check-adapter-import-direction.mjs`,
// wired as a required check. It landed with the first adapter and not before: a scan
// with nothing to scan would have reported green while proving nothing, which is the
// failure class this repo pays most for.

import GObject from 'gi://GObject?version=2.0';

import { err } from './errors.js';
import { tagOf } from './tags.js';
import type { WidgetDescriptor } from './types.js';

const registry = new Map<string, WidgetDescriptor>();

/**
 * The kebab spelling of each GType name, kept in a SECOND map.
 *
 * Two spellings exist because two dialects insist on different ones (ADR 0028 § 7)
 * and both reach the host as a plain tag string: a Vue template resolves `<GtkBox>`
 * to the GType name, a `.tsx` file can only write `<gtk-box>` because TypeScript
 * reads a capitalised JSX name as a value reference. So both must look up.
 *
 * Separate rather than merged, because the GType-keyed map is what
 * `nearestRegistered()` walks and what `registeredTags()` reports — folding
 * aliases in would make the conformance suite check every widget twice and report
 * Two spellings per row, so the map is twice the table.
 */
const aliases = new Map<string, WidgetDescriptor>();

export function registerWidget(descriptor: WidgetDescriptor): void {
    registry.set(descriptor.gtype, descriptor);
    const tag = tagOf(descriptor.gtype);
    if (tag !== descriptor.gtype) aliases.set(tag, descriptor);
}

export function registerWidgets(descriptors: readonly WidgetDescriptor[]): void {
    for (const d of descriptors) registerWidget(d);
}

export function lookupWidget(tag: string): WidgetDescriptor {
    const d = registry.get(tag) ?? aliases.get(tag);
    if (!d) throw err.unknownTag(tag);
    return d;
}

export const hasWidget = (tag: string): boolean => registry.has(tag) || aliases.has(tag);

/** Every registered GType name — the conformance suite walks this, so coverage is data. */
export const registeredTags = (): string[] => [...registry.keys()].sort();

/**
 * The nearest registered ancestor of a GType, most specific first.
 *
 * Registration is exact, but a consumer may subclass (`GObject.registerClass`)
 * and still want its parent's placement rules. Dispatch walks the real type
 * hierarchy rather than a name prefix, which is why `Gtk.HeaderBar` and
 * `Adw.HeaderBar` can never be confused for one another.
 */
export function nearestRegistered(gtype: GObject.GType): WidgetDescriptor | undefined {
    // A WALK UP THE TYPE CHAIN, not a scan of the table, and the table's size is
    // what forced it: the previous scan called `descriptor.ctor()` on every entry to
    // learn its GType, which with a generated table means resolving every GI class
    // on the first subclass ever mounted — the exact cost `ctor` is lazy to avoid.
    // Walking `type_parent` and looking each name up is O(depth) with no class
    // resolution at all, and it finds the same descriptor: the first hit going up IS
    // the nearest registered ancestor.
    //
    // What it does not find, deliberately: a descriptor keyed on an INTERFACE.
    // `type_parent` walks the class chain, and every descriptor in the table names a
    // concrete class, so there is nothing to lose here — but a future interface
    // descriptor would need `type_interfaces()` as well.
    for (let current: GObject.GType | null = gtype; current; current = GObject.type_parent(current)) {
        const name = GObject.type_name(current);
        if (!name) break;
        const descriptor = registry.get(name);
        if (descriptor) return descriptor;
    }
    return undefined;
}

/**
 * Drop every registration.
 *
 * A seam for a consumer that wants a table of its own — nothing in this package
 * calls it, and the specs deliberately share the module-global table because
 * that is what an application sees.
 */
export function clearRegistry(): void {
    registry.clear();
    aliases.clear();
}
