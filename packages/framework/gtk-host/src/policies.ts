// Child placement — the part that is genuinely GTK, and the reason a shared host
// pays for itself.
//
// GTK4 removed `GtkContainer`. There is no generic `add`, and `Gtk.Buildable`'s
// `add_child` is introspected as a vfunc only (`typeof headerBar.add_child ===
// 'undefined'`, gjs 1.88.1) — but `vfunc_add_child` is callable and dispatches
// correctly, so it IS available as a fallback. It is not a SAFE one: a childless
// widget accepts a child in silence. Every container
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
 *
 * A `slotted` policy reaches this too, per SLOT: an adder that hands the child to an
 * inner `Gtk.ListBox` needs exactly the same wrap, and `Adw.ExpanderRow`'s `add_row` is
 * one. The measurement behind that is on `ChildPolicy`'s `wrapSlots`; the short version
 * is that `gtk_list_box_remove` does not unwrap, so without this the child leaks behind
 * one `Gtk-WARNING` at unmount.
 */
export function makeWrapper(policy: ChildPolicy, child: Gtk.Widget, slot: string | null): Gtk.Widget | null {
    const wrap =
        policy.kind === 'indexed'
            ? policy.wrap
            : policy.kind === 'slotted'
              ? (policy.wrapSlots?.[slot ?? policy.defaultSlot] ?? null)
              : null;
    if (!wrap) return null;
    if (wrap === 'list-box-row') {
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
 * A container the host owns that no window shows — the DOM's detached `<div>`.
 *
 * `<KeepAlive>` and `<Suspense>` ask a renderer for off-screen storage:
 * `KeepAliveImpl.setup` opens with `createElement("div")` and `SuspenseImpl` does
 * the same for its `hiddenContainer`. The Vue adapter answered that with its own
 * `gi://Gtk` import and a literal `new Gtk.Box()` — the ONE runtime toolkit import
 * and the ONE concrete widget class in any adapter, i.e. exactly the widget
 * knowledge ADR 0027 § 7 forbids one. It lives here because this is already the
 * file that builds widgets the author did not write (see `makeWrapper`), and it is
 * the only one with a runtime `gi://Gtk` import.
 *
 * A `Gtk.Box` and not an `Adw.Bin`: the deactivated subtree may hold SEVERAL
 * children, and a one-child container would silently keep the last.
 */
export const makeDetachedContainer = (): Gtk.Widget => new Gtk.Box();

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
/**
 * Compile-time exhaustiveness, which this package does NOT get for free.
 *
 * `tsconfig.json` sets `strict: false`, so a switch that stops covering its union
 * simply falls through and returns `undefined` — no error. Adding the `uncurated`
 * policy kind passed `tsc` cleanly while five switches silently ignored it, which
 * is exactly the class of green-and-wrong this package exists to prevent
 * elsewhere. Assignability to `never` is not a strictness option, so a `default`
 * arm calling this DOES fail the build (measured) and is the only mechanism that
 * makes the next union member impossible to forget.
 */
export function unhandledPolicy(policy: never): never {
    throw new Error(`unhandled child policy: ${JSON.stringify(policy)}`);
}

export function setterSlotOf(parent: HostElement, child: HostElement): string | null {
    const policy = parent.descriptor.children;
    if (policy.kind === 'single') return policy.set;
    if (policy.kind !== 'slotted') return null;
    const method = policy.slots[child.slot ?? policy.defaultSlot];
    return method?.startsWith('set_') === true ? method : null;
}

/**
 * The slots this policy fills with an ADDER, by slot name.
 *
 * `set_`-prefixed or not is the whole distinction, and TWO decisions turn on it,
 * which is why the predicate is here once rather than spelled out at each. A
 * setter-backed slot is emptied by writing `null` back through itself, so
 * `policyProblems()` lets such a policy name no `remove`; and it holds one child,
 * so `rotateTail` returns before touching it — a policy with no adder slot at all
 * has no order to pay for, which is what `reorderMode()` reports.
 */
export function adderSlots(policy: ChildPolicy): string[] {
    if (policy.kind !== 'slotted') return [];
    return Object.entries(policy.slots)
        .filter(([, method]) => !method.startsWith('set_'))
        .map(([slot]) => slot);
}

/** Every one-child slot this policy has, by setter name — `single` has exactly one. */
export function setterSlots(policy: ChildPolicy): string[] {
    if (policy.kind === 'single') return [policy.set];
    if (policy.kind !== 'slotted') return [];
    return Object.values(policy.slots).filter((method) => method.startsWith('set_'));
}

/**
 * Who GTK says is in a one-child slot. `undefined` means there is no getter to ask.
 *
 * The slot's own getter is the ONLY honest reader of this, and a child-list walk
 * is not a substitute: measured on gtk 4.22.4 / libadwaita 1.9.3, a FRESH widget
 * already has direct children the application never put there —
 * `Gtk.ScrolledWindow` two `GtkScrollbar`s, `Adw.ToolbarView` two
 * `GtkRevealer`s, `Adw.Window` an `AdwDialogHost` + an `AdwGizmo`,
 * `Adw.StatusPage` a `GtkScrolledWindow` — while every one of those widgets
 * answers `null` from its getter. The getter also survives GTK wrapping the
 * child: `Gtk.ScrolledWindow.set_child(label)` reports a `GtkViewport`, not the
 * label, so callers may compare occupants for IDENTITY but never assume the
 * occupant is the widget they handed over.
 */
export function slotOccupant(widget: Gtk.Widget, setter: string): Gtk.Widget | null | undefined {
    const host = widget as unknown as AnyWidget;
    const getter = setter.replace(/^set_/, 'get_');
    if (typeof host[getter] !== 'function') return undefined;
    return (host[getter]() as Gtk.Widget | null) ?? null;
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

        case 'uncurated':
            throw err.uncuratedPlacement(parent.descriptor.gtype, child.descriptor.gtype);

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
        default:
            return unhandledPolicy(policy);
    }
}

/** The container's append-at-the-end operation, per policy. */
function appendChild(parent: HostElement, child: HostElement, host: AnyWidget): void {
    const policy = parent.descriptor.children;
    const address = addressOf(child);
    switch (policy.kind) {
        case 'uncurated':
            throw err.uncuratedPlacement(parent.descriptor.gtype, child.descriptor.gtype);
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
        // Every remaining kind cannot append at all — `none` by declaration,
        // `single` and `indexed` because they address a slot or an index rather
        // than an end. `uncurated` is handled above, by name, so this arm never
        // silently swallows it.
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
        // A child can never have been placed into either, so there is nothing to
        // take out — and reaching here at all means an insert was refused, which
        // already threw by name.
        case 'uncurated':
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
            // Adder-backed, so only a remove method can take the child out.
            // `policyProblems()` rejects a descriptor that reaches here without
            // one; an application-registered descriptor is checked by nobody, so
            // the refusal is named rather than left as a TypeError on undefined.
            const slot = child.slot ?? policy.defaultSlot;
            if (!policy.remove) throw err.slotNeedsRemove(parent.descriptor.gtype, slot, policy.slots[slot] ?? '?');
            host[policy.remove](address);
            return;
        }
        case 'ordered':
        case 'indexed':
        case 'keyed':
        case 'coords':
            host[policy.remove](address);
            return;
        default:
            return unhandledPolicy(policy);
    }
}

function clearIfCurrent(host: AnyWidget, setter: string, address: Gtk.Widget): void {
    const current = slotOccupant(host as unknown as Gtk.Widget, setter);
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
        case 'uncurated':
            return 'n/a';
        case 'ordered':
            return policy.reorder;
        case 'indexed':
            return 'native';
        case 'slotted':
            // Measured: `Adw.HeaderBar.reorder_child_after` is `undefined`, so a
            // move within an ADDER slot costs a tail rotation. An ALL-SETTER
            // policy pays nothing at all — every slot holds exactly one child,
            // `rotateTail` returns before it touches anything, and re-inserting
            // `Adw.NavigationSplitView`'s two children in the other order leaves
            // GTK's own `get_sidebar()`/`get_content()` unchanged (measured).
            // Same answer as `coords`, for the same reason: the slot is data on
            // the child, so document order carries nothing to pay for.
            return adderSlots(policy).length > 0 ? 'remove-all' : 'n/a';
        case 'keyed':
            // Measured: `Gtk.Stack.reorder_child_after` is `undefined` too, so a
            // keyed reversal was a complete no-op in GTK while the host's own
            // navigators reported the new order.
            return 'remove-all';
        case 'coords':
        case 'single':
        case 'none':
            return 'n/a';
        default:
            return unhandledPolicy(policy);
    }
}
