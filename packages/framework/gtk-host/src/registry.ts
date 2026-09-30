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
 * The rows the GIR offered and THIS typelib does not have, by GType name.
 *
 * A third map rather than a filter with no trace. The generated table is produced from
 * a GIR, and a GIR has no platform axis: GTK 4.24's own `Gtk-4.0.gir` on this host
 * declares `GtkPrintUnixDialog`, and the win32 typelib that table was generated against
 * does not build it, because GTK compiles `gtk/print/` under `#ifdef G_OS_UNIX` and
 * Windows is not Unix (#1446). Nothing in the input can say so, so the shipped table
 * resolves it where a typelib is actually loaded — and a row that resolution removed has
 * to stay NAMEABLE, because the alternative is the failure this map exists to end:
 * `lookupWidget` raising `unknown-tag`, whose whole message is that being a real GType
 * in the installed typelib is not enough on its own — the precise opposite of what a
 * Windows author needs to be told.
 *
 * Registration is one-way, so this map only ever grows for rows the host lacks, and
 * `registerWidget()` never writes here: a consumer's own `GObject.registerClass`
 * subclass is registered BY the class's own code, so it is not a row this table had to
 * drop (ADR 0028 § Consequences).
 */
const absent = new Map<string, string>();

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

/**
 * Record rows the shipped table has but this typelib does not, so a tag that names
 * one is refused as NOT INSTALLED rather than as unknown.
 *
 * Keyed by BOTH spellings, each mapping to the GType name the refusal should print —
 * the reason `registry` and `aliases` are two maps, so this lookup stays a `Map.get`
 * rather than a scan.
 */
export function registerAbsentWidgets(descriptors: readonly WidgetDescriptor[]): void {
    for (const d of descriptors) {
        absent.set(d.gtype, d.gtype);
        absent.set(tagOf(d.gtype), d.gtype);
    }
}

export function lookupWidget(tag: string): WidgetDescriptor {
    const d = registry.get(tag) ?? aliases.get(tag);
    if (d) return d;
    // The last chance to say WHY. `unknown-tag`'s whole message is that being a real
    // GType in the installed typelib is not enough on its own — the precise opposite of
    // what an author on the platform that does not build this class needs to be told.
    const notHere = absent.get(tag);
    if (notHere !== undefined) throw err.notInstalled(tag, notHere);
    throw err.unknownTag(tag);
}

export const hasWidget = (tag: string): boolean => registry.has(tag) || aliases.has(tag);

/** Every GType the shipped table has and this typelib does not, sorted. */
export const absentTags = (): string[] => [...new Set(absent.values())].sort();

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
    absent.clear();
}
