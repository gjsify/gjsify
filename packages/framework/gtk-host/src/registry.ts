// The widget table.
//
// One table, read by every adapter: no adapter may carry a widget name literal
// or an insertion rule. Hand-maintaining a per-framework table is what stalled
// react-gtk, react-native-gtk4 and svelte-gjs, so there is exactly one here.
//
// The import-direction check that MAKES that mechanical lands with the first
// adapter (`status/open-todos.md`) — a scan with nothing to scan would report
// green while proving nothing, which is the failure class this repo pays most
// for. Until then the rule is enforced by review.

import GObject from 'gi://GObject';

import { err } from './errors.js';
import type { WidgetDescriptor } from './types.js';

const registry = new Map<string, WidgetDescriptor>();

export function registerWidget(descriptor: WidgetDescriptor): void {
    registry.set(descriptor.gtype, descriptor);
}

export function registerWidgets(descriptors: readonly WidgetDescriptor[]): void {
    for (const d of descriptors) registerWidget(d);
}

export function lookupWidget(tag: string): WidgetDescriptor {
    const d = registry.get(tag);
    if (!d) throw err.unknownTag(tag);
    return d;
}

export const hasWidget = (tag: string): boolean => registry.has(tag);

/** Every registered tag — the conformance suite walks this, so coverage is data. */
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
    let best: WidgetDescriptor | undefined;
    let bestDepth = -1;
    for (const descriptor of registry.values()) {
        let candidate: GObject.GType;
        try {
            candidate = descriptor.ctor().$gtype;
        } catch {
            continue; // a descriptor for a type the installed GTK does not carry
        }
        if (!GObject.type_is_a(gtype, candidate)) continue;
        const depth = depthOf(candidate);
        if (depth > bestDepth) {
            best = descriptor;
            bestDepth = depth;
        }
    }
    return best;
}

function depthOf(gtype: GObject.GType): number {
    let depth = 0;
    let current: GObject.GType | null = gtype;
    while (current) {
        const parent = GObject.type_parent(current);
        if (!parent) break;
        depth += 1;
        current = parent;
    }
    return depth;
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
}
