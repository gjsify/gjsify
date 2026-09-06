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
//
// TWO AXES, not one, since the portal seam (ADR 0045). `ChildPolicy` says how a
// PARENT adopts a child; `NodePlacement` says whether the node goes into its
// parent at all. The second half lives under § Portal placement below and is the
// only part of this file a parent's policy never reaches.

import Gtk from 'gi://Gtk?version=4.0';

import { err, GtkHostError } from './errors.js';
import { beginHostWrite, endHostWrite } from './signals.js';
import type { ChildPolicy, HostElement, NodePlacement, WidgetDescriptor } from './types.js';

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

// ---------------------------------------------------------------------------
// Portal placement — a node whose host node is not its parent node
// ---------------------------------------------------------------------------

/** What an absent `placement` means, spelled once. */
const PARENTED: NodePlacement = { kind: 'parented' };

/**
 * The declared placement of a node. The ONE place absence is turned into a value.
 *
 * Everything downstream switches on the union rather than on `descriptor.placement
 * !== undefined`, so the absent case is a member with a name instead of a
 * falsiness test that a third kind would quietly join.
 */
export const placementOf = (descriptor: WidgetDescriptor): NodePlacement => descriptor.placement ?? PARENTED;

/** The portal arm, or null. The narrow question four call sites ask. */
export function portalOf(descriptor: WidgetDescriptor): Extract<NodePlacement, { kind: 'portal' }> | null {
    const placement = placementOf(descriptor);
    switch (placement.kind) {
        case 'parented':
            return null;
        case 'portal':
            return placement;
        default:
            return unhandledPlacement(placement);
    }
}

/** `unhandledPolicy`'s twin for the placement axis, and it exists for the same reason. */
export function unhandledPlacement(placement: never): never {
    throw new Error(`unhandled node placement: ${JSON.stringify(placement)}`);
}

/** Is this node placed against its parent rather than into it? */
export const isPortal = (el: HostElement): boolean => portalOf(el.descriptor) !== null;

function portalMethod(el: HostElement, method: string, role: 'present' | 'close'): (...a: unknown[]) => unknown {
    const node = el.widget as unknown as Record<string, ((...a: unknown[]) => unknown) | undefined> | null;
    const fn = node?.[method];
    if (typeof fn !== 'function') throw err.portalMethodMissing(el.descriptor.gtype, method, role);
    return fn;
}

/**
 * The toplevel a widget is in, or null — the whole precondition a portal has.
 *
 * `Gtk.Window` and not "a non-null root", because it is libadwaita's OWN
 * boundary: `adw_dialog_root()` returns early unless `GTK_IS_WINDOW (root)`, and
 * `adw_dialog_present()` falls back to a standalone window for anything else.
 * Asking the same question the library asks is what keeps this generic code from
 * having a second opinion about a specific widget.
 */
const toplevelOf = (widget: Gtk.Widget): Gtk.Window | null => {
    const root = widget.get_root() as unknown;
    return root instanceof Gtk.Window ? root : null;
};

/**
 * Show a portal node against its parent — or subscribe and wait, if it is too early.
 *
 * Returns whether GTK has actually taken the node, which is what `attached` means.
 *
 * WHY THE WAIT IS THE FEATURE. Every framework builds bottom-up: React creates the
 * whole subtree, appends its children, and inserts the ROOT into the container
 * last, so at the moment a `<Modal>` is inserted its parent is usually not in a
 * window yet. MEASURED on libadwaita 1.9.3 / GTK 4.22.4, presenting against an
 * unrooted box: `adw_dialog_present` finds no `AdwDialogHost` among the parent's
 * ancestors and takes its documented other branch, `present_as_window` — the
 * dialog opens as a SEPARATE `GtkWindow`, `win.visibleDialog` stays false, exit 0,
 * no diagnostic. A modal that floats out of its own application is exactly the
 * green-and-wrong this host exists to refuse, and nothing in the shadow tree can
 * see it.
 *
 * `notify::root` is the instrument. MEASURED: it fires on a GRANDCHILD box when
 * the toplevel takes the subtree (root -> AdwWindow), and again on unroot (root ->
 * null). The subscription STAYS for the life of the attachment rather than being
 * one-shot, because re-rooting is real: measured, unrooting the parent leaves an
 * already-presented dialog in the OLD window's host — `w1.visibleDialog` still
 * true after `w1.set_content(null)` — so a subtree moved to a second window would
 * silently keep showing its modal in the first.
 *
 * SYMMETRIC, and the second direction is not free. GTK does not take the dialog
 * down when the anchor loses its window, so losing a toplevel RETRACTS the node
 * rather than merely failing to present it (see `placeAgainst`). Without that, a
 * subtree that is detached and never re-rooted keeps its sheet on screen in the
 * window it left, and only a re-root — which such a subtree never gets — repairs it.
 */
export function presentPortal(
    parent: HostElement,
    child: HostElement,
    portal: Extract<NodePlacement, { kind: 'portal' }>,
): boolean {
    const anchor = parent.widget as unknown as Gtk.Widget | null;
    if (!anchor) return false;
    // BOTH METHODS, BEFORE THE SUBSCRIPTION, and the order is the point rather
    // than tidiness: the placement can be deferred, so a missing method would
    // otherwise first be discovered inside a `notify::root` handler — where a
    // throw is a GJS exception logged from a signal callback with nothing to
    // attribute it to, long after the insert that caused it returned. Asked here,
    // it is a named refusal at the insert. `descriptorProblems()` catches a
    // built-in descriptor up front; an application-registered one is checked by
    // nobody, which is the same gap `slotNeedsRemove` fills for a slot.
    portalMethod(child, portal.present, 'present');
    portalMethod(child, portal.close, 'close');
    watchPortalRoot(anchor, child, portal);
    return placeAgainst(anchor, child, portal);
}

function placeAgainst(
    anchor: Gtk.Widget,
    child: HostElement,
    portal: Extract<NodePlacement, { kind: 'portal' }>,
): boolean {
    const node = child.widget as unknown as Gtk.Widget | null;
    if (!node) return false;
    const target = toplevelOf(anchor);
    if (!target) {
        // THE ANCHOR HAS NO WINDOW, so neither may the portal — and this is a
        // RETRACT rather than a bare `return false` because the same line is
        // reached from an UNROOT, not only from a deferred insert.
        //
        // A portal is presented exactly when its anchor is in a toplevel. The wait
        // above enforces one direction of that; without this the other direction
        // was silently missing. MEASURED on libadwaita 1.9.3: after
        // `w1.set_content(null)` the dialog is STILL in `w1`'s host —
        // `w1.visibleDialog` is the dialog — so the sheet kept showing in a window
        // its own subtree had left, and stayed up for as long as no second window
        // happened to claim that subtree. Only a re-root repaired it, and a subtree
        // that is merely detached never re-roots.
        //
        // It also keeps `attached` honest: this function returns false here, so the
        // host recorded "GTK has NOT taken this node" while GTK still had it on
        // screen — the exact conflation `attached` exists to prevent (ADR 0045 § 4).
        //
        // Unconditional, for the reason `retractPortal` is: `force_close` on a node
        // that was never presented is silent (measured), so no "is it up?" probe is
        // needed, and on a deferred insert this is a no-op.
        portalMethod(child, portal.close, 'close').call(node);
        return false;
    }
    if (node.get_parent()) {
        // Already up. Where it is up decides whether this is a no-op or a move:
        // MEASURED, `present()` on a dialog already presented for ANOTHER host is
        // `Adwaita-CRITICAL **: Cannot present … as it's already presented for …`
        // plus `Gtk-WARNING **: Can't set new parent …` — and the move does not
        // happen, so the shadow tree would claim a placement GTK refused. Closing
        // first is the sequence that works (measured: force_close, then present,
        // lands it in the new window with no diagnostic).
        if (toplevelOf(node) === target) return true;
        portalMethod(child, portal.close, 'close').call(node);
    }
    portalMethod(child, portal.present, 'present').call(node, anchor);
    return true;
}

function watchPortalRoot(
    anchor: Gtk.Widget,
    child: HostElement,
    portal: Extract<NodePlacement, { kind: 'portal' }>,
): void {
    if (child.portalWatch?.widget === anchor) return;
    if (child.portalWatch) retractPortalWatch(child);
    const id = anchor.connect('notify::root', () => {
        // `attached` is written HERE and not by the caller, because this is the
        // moment GTK takes the node — the insert that started it all returned long
        // ago. It is the same fact the synchronous path records, arriving late.
        child.attached = placeAgainst(anchor, child, portal);
    });
    child.portalWatch = { widget: anchor, id };
}

function retractPortalWatch(child: HostElement): void {
    const watch = child.portalWatch;
    if (!watch) return;
    child.portalWatch = null;
    watch.widget.disconnect(watch.id);
}

/**
 * Take a portal node back down, with no probe and no `attached` guard.
 *
 * UNCONDITIONALLY, twice over, and both halves are measured. The method the
 * descriptor names is the FORCED close (`force_close`, not `close`): an unmount is
 * not a user request, and `close()` on a dialog whose `can-close` is FALSE returns
 * FALSE, emits `close-attempt` and leaves it on screen. And `force_close()` on a
 * node that was never presented is silent, where `close()` is
 * `Adwaita-CRITICAL **: Trying to close … that's not presented` at exit 0 — so the
 * host needs no "is it up?" question, which is the one it could not answer without
 * knowing what a dialog is.
 */
export function retractPortal(child: HostElement, portal: Extract<NodePlacement, { kind: 'portal' }>): void {
    retractPortalWatch(child);
    if (!child.widget) return;
    portalMethod(child, portal.close, 'close').call(child.widget);
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
        syncPerLineCap(place.parent);
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
        case 'keyed': {
            // Why a widget can need to be hidden before it is removed, and why the
            // visibility goes back on: the `hideBeforeRemove` docblock in `types.ts`.
            // A child that is ALREADY hidden needs nothing — libadwaita ran its own
            // cleanup when it was hidden, which is the very path this borrows.
            const restoreVisible = policy.hideBeforeRemove === true && address.get_visible();
            if (restoreVisible) writeVisible(address, false);
            host[policy.remove](address);
            if (restoreVisible) writeVisible(address, true);
            return;
        }
        case 'ordered':
        case 'indexed':
        case 'coords':
            host[policy.remove](address);
            return;
        default:
            return unhandledPolicy(policy);
    }
}

/**
 * Write `visible` as the HOST, so `hideBeforeRemove` costs a consumer no signal.
 *
 * A plain remove emits no property change at all. MEASURED on libadwaita 1.9.3 /
 * GTK 4.22.4, removing the VISIBLE page of an `Adw.ViewStack`: unbracketed, the
 * hide/restore pair adds two `notify::visible` on the child AND one
 * `notify::visible-child-name` on the STACK, because hiding the visible child runs
 * libadwaita's `update_child_visible` and that picks another page. Over a keyed
 * reorder — `remove-all`, so every page goes — a three-page reversal went from one
 * stack notify to three (`c`, `null`, `c`) plus two per child. `<Tabs>` in
 * `@gjsify/react-native` reads that stack notify as THE USER CLICKED and dispatches
 * a navigation for it, so the traffic is not merely noise.
 *
 * The echo guard in `signals.ts` is exactly the instrument for that, and this is
 * its only caller outside `host.ts`.
 *
 * `null` rather than `address` as the write target, and that is the whole reason
 * this is a function: the target leg drops NON-notify signals too, and `unmap` is
 * one a consumer must keep. MEASURED, same case — `unmap` fires ONCE either way (on
 * the hide when bracketed, on `gtk_widget_unparent` when not), so `null` drops the
 * property echo and leaves the unmap count at the unpatched 1.
 */
function writeVisible(address: Gtk.Widget, visible: boolean): void {
    beginHostWrite(null);
    try {
        address.set_visible(visible);
    } finally {
        endHostWrite();
    }
}

function clearIfCurrent(host: AnyWidget, setter: string, address: Gtk.Widget): void {
    const current = slotOccupant(host as unknown as Gtk.Widget, setter);
    if (current === undefined || current === address) host[setter](null);
}

export function removeChild(parent: HostElement, child: HostElement): void {
    // BEFORE the two guards below, and both would be wrong for a portal. The
    // parent never took the node, so there is nothing of the parent's to call —
    // and `attached` is false for a portal still waiting for a toplevel, which is
    // exactly the state whose subscription has to be disconnected.
    const portal = portalOf(child.descriptor);
    if (portal) return retractPortal(child, portal);
    const host = parent.widget as unknown as AnyWidget;
    if (!host) return;
    // Never ask GTK to remove what it never adopted. A node can be linked in the
    // shadow tree and absent from the GTK one — a bottom-up build, or a placement
    // that was refused — and removing it then emits `tried to remove non-child`
    // (a critical, at exit 0) or, where the GI signature is narrow, aborts the
    // whole teardown so handlers stay connected for the life of the process.
    if (!child.attached) return;
    detachChild(parent, child, host);
    syncPerLineCap(parent);
}

/**
 * Keep an `indexed` parent's per-line cap equal to its child count.
 *
 * WHY a cap has to be maintained at all rather than pinned high once is on
 * `ChildPolicy`'s `perLineCap`: GTK measures the cap and not the children, and
 * the cost is quadratic in it.
 *
 * The walk is O(children) and runs after every insert, which makes a build of n
 * children O(n²) in POINTER HOPS — against the one measure per insert it takes
 * off, at 1.5 ms and upwards each, that is not a trade worth avoiding. A counter
 * kept on the element would be the faster shape and a second source for a fact
 * GTK already holds; this asks the container.
 *
 * The write is bracketed as the HOST's for the reason `writeVisible` is: a
 * consumer that never wrote this property should not be told it changed.
 */
function syncPerLineCap(parent: HostElement): void {
    const policy = parent.descriptor.children;
    if (policy.kind !== 'indexed' || policy.perLineCap === undefined) return;
    if (parent.props[policy.perLineCap] !== undefined) return;
    const host = parent.widget as unknown as Gtk.Widget | null;
    if (!host) return;
    let children = 0;
    for (let c = host.get_first_child(); c !== null; c = c.get_next_sibling()) children += 1;
    // `0` is refused, not read as "no limit": `gtk_flow_box_set_max_children_per_line:
    // assertion 'n_children > 0' failed`, and the property keeps its old value
    // (measured, GTK 4.22.4). So an empty container asks for one.
    beginHostWrite(null);
    try {
        host.set_property(policy.perLineCap, Math.max(1, children));
    } finally {
        endHostWrite();
    }
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
