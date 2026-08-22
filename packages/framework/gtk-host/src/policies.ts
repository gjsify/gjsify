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

/**
 * The ONE-CHILD setter this child's placement goes through, or null.
 *
 * `single` always is one (`set_child`, `set_content`); a `slotted` slot is one
 * when its method is a setter (`set_content`, `set_title_widget`) rather than an
 * adder. Such a slot REPLACES — and it does so silently, which is why four call
 * sites need the same question answered. Two of them are about an ELEMENT
 * arriving; the other two are about TEXT, because GTK's text sink is the SAME
 * slot: measured on gtk 4.22, `button.set_child(w)` followed by
 * `set_property('label', …)` leaves `w.get_parent() === null`, and `set_child`
 * after a `label` write leaves `label === null`. One widget, one slot, two APIs.
 */
export function setterSlotOf(parent: HostElement, child: HostElement): string | null {
    const policy = parent.descriptor.children;
    if (policy.kind === 'single') return policy.set;
    if (policy.kind !== 'slotted') return null;
    const method = policy.slots[child.slot ?? policy.defaultSlot];
    return method?.startsWith('set_') === true ? method : null;
}

export interface Placement {
    parent: HostElement;
    child: HostElement;
    /** Address of the preceding element sibling, or null when the child goes first. */
    prevWidget: Gtk.Widget | null;
    /** Index among ELEMENT siblings — text and anchors do not count. */
    index: number;
    /**
     * Element siblings after the insertion point, in order.
     *
     * ELEMENTS, not widgets: a container that cannot insert is re-placed by
     * rotating its tail, and re-placing a child needs the child's own slot or
     * page name, which a bare `Gtk.Widget` cannot answer.
     */
    following: HostElement[];
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

        case 'indexed':
            host[policy.insert](address, place.index);
            return;

        case 'coords':
            // Position is data on the child, so document order carries nothing
            // and there is no tail to rotate.
            appendChild(parent, child, host);
            return;

        case 'ordered':
            if (policy.after) {
                // The O(1) path. `insert_child_after(child, null)` means "first".
                host[policy.after](address, place.prevWidget ?? null);
                return;
            }
        // falls through — no insert API on this container
        case 'slotted':
        case 'keyed':
            // Containers that can only APPEND. Add ourselves first, then rotate
            // the tail back into place.
            //
            // Append-first is not a detail: detaching the tail before an append
            // that can throw destroys already-rendered siblings, and `insert`'s
            // catch can only repair the shadow tree.
            //
            // `slotted` and `keyed` reach here for the same reason `ordered`
            // without `after` does — measured, `Gtk.Stack.reorder_child_after`
            // and `Adw.HeaderBar.reorder_child_after` are both `undefined`, so a
            // keyed reversal was a complete no-op in GTK while the host's own
            // navigators reported the new order.
            appendChild(parent, child, host);
            rotateTail(parent, child, place.following, host);
            return;
    }
}

/** The container's append-at-the-end operation, per policy. */
function appendChild(parent: HostElement, child: HostElement, host: AnyWidget): void {
    const policy = parent.descriptor.children;
    const address = addressOf(child);
    switch (policy.kind) {
        case 'ordered':
            host[policy.append](address);
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
            // title called a 3-argument method with two, and GJS's "At least 3
            // arguments required" then read as a rejected child TYPE.
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
        default:
            throw err.unclaimedChild(parent.descriptor.gtype, child.descriptor.gtype);
    }
}

/**
 * Detach the siblings after us and append them again, so document order wins.
 *
 * Only the siblings whose placement is actually ORDERED. A setter-backed slot
 * (`set_content`, `set_title_widget`) holds one child, so "appending" it is an
 * assignment — rotating such a sibling overwrites the child that was just placed
 * and loses it. Different slots are independent of each other too, so a rotation
 * only ever concerns the one it is in.
 */
function rotateTail(parent: HostElement, child: HostElement, following: readonly HostElement[], host: AnyWidget): void {
    const policy = parent.descriptor.children;
    let tail = following;
    if (policy.kind === 'slotted') {
        if (setterSlotOf(parent, child)) return; // one child, no order
        const slotOf = (el: HostElement) => el.slot ?? policy.defaultSlot;
        const mine = slotOf(child);
        tail = following.filter((el) => slotOf(el) === mine);
    }
    for (const el of tail) detachChild(parent, el, host);
    for (const el of tail) appendChild(parent, el, host);
}

/** The container's remove operation, guarded where the slot holds only one child. */
function detachChild(parent: HostElement, child: HostElement, host: AnyWidget): void {
    const policy = parent.descriptor.children;
    const address = (child.wrapper ?? child.widget) as Gtk.Widget | null;
    if (!address) return;

    switch (policy.kind) {
        case 'none':
            return;
        case 'single':
            clearIfCurrent(host, policy.set, address);
            return;
        case 'slotted': {
            // A setter-backed slot (`set_content`, `set_title_widget`) holds ONE
            // child and has the same hazard as `single`: the insert-then-unmount
            // order Solid and React use would clear a slot that already holds the
            // replacement.
            const setter = setterSlotOf(parent, child);
            if (setter) {
                clearIfCurrent(host, setter, address);
                return;
            }
            host[policy.remove](address);
            return;
        }
        case 'ordered':
        case 'indexed':
        case 'keyed':
        case 'coords':
            host[policy.remove](address);
            return;
    }
}

function clearIfCurrent(host: AnyWidget, setter: string, address: Gtk.Widget): void {
    const getter = setter.replace(/^set_/, 'get_');
    const current = typeof host[getter] === 'function' ? host[getter]() : undefined;
    if (current === undefined || current === address) host[setter](null);
}

export function removeChild(parent: HostElement, child: HostElement): void {
    const host = parent.widget as unknown as AnyWidget;
    if (!host) return;
    // Never ask GTK to remove what it never adopted. A node can be linked in the
    // shadow tree and absent from the GTK one — a bottom-up build, or a placement
    // that was refused — and removing it then emits `tried to remove non-child`
    // (a critical, at exit 0) or, where the GI signature is narrow, aborts the
    // whole teardown so handlers stay connected for the life of the process.
    if (!child.attached) return;
    detachChild(parent, child, host);
}

/** Does this parent reorder in place, or does it pay a full re-append? Declared, not guessed. */
export function reorderMode(policy: ChildPolicy): 'native' | 'remove-all' | 'n/a' {
    switch (policy.kind) {
        case 'ordered':
            return policy.reorder;
        case 'indexed':
            return 'native';
        case 'slotted':
        case 'keyed':
            // Measured: `Gtk.Stack.reorder_child_after` and
            // `Adw.HeaderBar.reorder_child_after` are both `undefined`. These
            // containers only append, so a move costs a tail rotation.
            return 'remove-all';
        case 'coords':
        case 'single':
        case 'none':
            return 'n/a';
    }
}
