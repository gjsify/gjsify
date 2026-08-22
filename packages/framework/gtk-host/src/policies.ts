// Child placement — the part that is genuinely GTK, and the reason a shared host
// pays for itself.
//
// GTK4 removed `GtkContainer`. There is no generic `add`, and `Gtk.Buildable`'s
// `add_child` is introspected as a vfunc only (`typeof headerBar.add_child ===
// 'undefined'`, gjs 1.88.1), so it is not a fallback either. Every container
// therefore states its own rules as DATA in its descriptor, and this file is the
// only code that reads them. Four framework adapters share it; none of them may
// contain an insertion rule of its own.

import Gtk from 'gi://Gtk?version=4.0';

import { err, GtkHostError } from './errors.js';
import type { ChildPolicy, HostElement } from './types.js';

type AnyWidget = Gtk.Widget & Record<string, (...args: unknown[]) => unknown>;

/** The object the PARENT addresses: a wrapper row when the policy demands one. */
export function addressOf(el: HostElement): Gtk.Widget {
    const address = (el.wrapper ?? el.widget) as Gtk.Widget | null;
    if (!address) throw err.notAWidget(el.descriptor.gtype);
    return address;
}

/**
 * `Gtk.ListBox` and `Gtk.FlowBox` wrap arbitrary children; the wrap is the host's job.
 *
 * Unless the author already wrote the row themselves — `<GtkListBox><GtkListBoxRow>`
 * is the spelling anyone reaching for `activatable` or `selectable` uses, and
 * wrapping a row inside a second row nests two selectable widgets and detaches
 * activation from the one the author configured.
 */
export function makeWrapper(policy: ChildPolicy, child: Gtk.Widget): Gtk.Widget | null {
    if (policy.kind !== 'indexed' || !policy.wrap) return null;
    if (policy.wrap === 'list-box-row') {
        if (child instanceof Gtk.ListBoxRow) return null;
        const row = new Gtk.ListBoxRow();
        row.set_child(child);
        return row;
    }
    if (child instanceof Gtk.FlowBoxChild) return null;
    const flowChild = new Gtk.FlowBoxChild();
    flowChild.set_child(child);
    return flowChild;
}

export interface Placement {
    parent: HostElement;
    child: HostElement;
    /** Address of the preceding element sibling, or null when the child goes first. */
    prevWidget: Gtk.Widget | null;
    /** Index among ELEMENT siblings — text and anchors do not count. */
    index: number;
    /** Element siblings after the insertion point, in order — the `remove-all` fallback needs them. */
    following: Gtk.Widget[];
}

export function insertChild(place: Placement): void {
    try {
        placeChild(place);
    } catch (e) {
        if (e instanceof GtkHostError) throw e;
        // GTK's own message is accurate and anonymous: "Object is of type Gtk.Box
        // - cannot convert to AdwPreferencesGroup" names neither the parent that
        // refused nor the place in the tree. A descriptor cannot declare which
        // child TYPES a container accepts — only GTK knows — so the host adds the
        // two names it does know.
        throw err.rejectedChild(place.parent.descriptor.gtype, place.child.descriptor.gtype, (e as Error).message);
    }
}

function placeChild(place: Placement): void {
    const { parent, child } = place;
    const policy = parent.descriptor.children;
    const host = parent.widget as unknown as AnyWidget;
    const address = addressOf(child);

    switch (policy.kind) {
        case 'none':
            throw err.unclaimedChild(parent.descriptor.gtype, child.descriptor.gtype);

        case 'single':
            host[policy.set](address);
            return;

        case 'ordered': {
            if (policy.after && place.prevWidget) {
                host[policy.after](address, place.prevWidget);
                return;
            }
            if (policy.after) {
                // insert_child_after(child, null) means "first".
                host[policy.after](address, null);
                return;
            }
            // Declared degradation: no insert API on this container
            // (`Adw.PreferencesGroup` has add/remove and no insert, measured).
            // Detach the tail, append ourselves, re-append the tail in order.
            for (const w of place.following) host[policy.remove](w);
            host[policy.append](address);
            for (const w of place.following) host[policy.append](w);
            return;
        }

        case 'indexed':
            host[policy.insert](address, place.index);
            return;

        case 'slotted': {
            const slot = child.slot ?? policy.defaultSlot;
            const method = policy.slots[slot];
            if (!method) throw err.unknownSlot(parent.descriptor.gtype, slot, Object.keys(policy.slots));
            host[method](address);
            return;
        }

        case 'keyed': {
            const name = (child.layout?.[policy.nameFrom] ?? child.slot) as string | undefined;
            const title = child.layout?.title as string | undefined;
            // Always the full arity when the container wants it: a name with no
            // title used to call a 3-argument method with two, and GJS's
            // "At least 3 arguments required" then read as a rejected child TYPE.
            if (policy.titled) host[policy.add](address, name ?? null, title ?? name ?? '');
            else host[policy.add](address);
            return;
        }

        case 'coords': {
            const l = child.layout ?? {};
            host[policy.attach](
                address,
                (l.column as number) ?? 0,
                (l.row as number) ?? 0,
                (l.columnSpan as number) ?? 1,
                (l.rowSpan as number) ?? 1,
            );
            return;
        }
    }
}

export function removeChild(parent: HostElement, child: HostElement): void {
    const policy = parent.descriptor.children;
    const host = parent.widget as unknown as AnyWidget;
    if (!host) return;
    const address = (child.wrapper ?? child.widget) as Gtk.Widget | null;
    if (!address) return;

    switch (policy.kind) {
        case 'none':
            return;
        case 'single': {
            // Only clear if THIS child is still the one in place. Solid's runtime
            // and several React paths insert the replacement before unmounting the
            // old node, so an unconditional `set_child(null)` empties a container
            // that already holds the new child.
            const getter = policy.set.replace(/^set_/, 'get_');
            const current = typeof host[getter] === 'function' ? host[getter]() : undefined;
            if (current === undefined || current === address) host[policy.set](null);
            return;
        }
        case 'ordered':
        case 'indexed':
        case 'slotted':
        case 'keyed':
        case 'coords':
            host[policy.remove](address);
            return;
    }
}

/** Does this parent reorder in place, or does it pay a full re-append? Declared, not guessed. */
export function reorderMode(policy: ChildPolicy): 'native' | 'remove-all' | 'n/a' {
    switch (policy.kind) {
        case 'ordered':
            return policy.reorder;
        case 'indexed':
        case 'slotted':
        case 'keyed':
            return 'native';
        case 'coords':
        case 'single':
        case 'none':
            return 'n/a';
    }
}
