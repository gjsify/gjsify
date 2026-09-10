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
// parent at all. The second half lives under § Placement below and is the
// only part of this file a parent's policy never reaches.
//
// The second axis has TWO non-parented arms (ADR 0054) because the installed
// libraries have two ways of refusing a parent, and only one of them says so: a
// parented `Adw.Dialog` is `g_error()` and a parented `Gtk.Window` is exit 0. The
// same declaration answers both, and `classPlacementKind` is what catches a
// descriptor that declares neither before the adder gets the chance.

import GObject from 'gi://GObject?version=2.0';
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
// Placement — whether a node goes into its parent at all
// ---------------------------------------------------------------------------

/** What an absent `placement` means, spelled once. */
const PARENTED: NodePlacement = { kind: 'parented' };

/** A placement that does NOT put the node into its parent's child list. */
export type OutsideParent = Exclude<NodePlacement, { kind: 'parented' }>;

/**
 * The declared placement of a node. The ONE place absence is turned into a value.
 *
 * Everything downstream switches on the union rather than on `descriptor.placement
 * !== undefined`, so the absent case is a member with a name instead of a
 * falsiness test that a third kind would quietly join.
 */
export const placementOf = (descriptor: WidgetDescriptor): NodePlacement => descriptor.placement ?? PARENTED;

/**
 * The placement, when it is NOT `parented` — the narrow question every caller asks.
 *
 * Returning the arm rather than a boolean is what keeps the two non-parented kinds
 * ONE question: a caller switches over what it gets and its `never` arm fails to
 * compile the day a fourth kind arrives.
 */
export function outsideParentOf(descriptor: WidgetDescriptor): OutsideParent | null {
    const placement = placementOf(descriptor);
    switch (placement.kind) {
        case 'parented':
            return null;
        case 'portal':
        case 'toplevel':
            return placement;
        default:
            return unhandledPlacement(placement);
    }
}

/** The portal arm specifically, or null. */
export function portalOf(descriptor: WidgetDescriptor): Extract<NodePlacement, { kind: 'portal' }> | null {
    const outside = outsideParentOf(descriptor);
    return outside?.kind === 'portal' ? outside : null;
}

/** `unhandledPolicy`'s twin for the placement axis, and it exists for the same reason. */
export function unhandledPlacement(placement: never): never {
    throw new Error(`unhandled node placement: ${JSON.stringify(placement)}`);
}

/** Is this node placed against its parent rather than into it? */
export const isPortal = (el: HostElement): boolean => portalOf(el.descriptor) !== null;

/**
 * Does this node take NO position in its parent's child list?
 *
 * The question four sibling walks ask, and it is the placement AXIS rather than
 * the portal arm: a toplevel occupies a parent's child list exactly as little as a
 * portal does. Asking `isPortal` there was correct while `portal` was the only
 * non-parented kind and became a silent hole the moment it was not — counting a
 * toplevel as a sibling shifts every later child by one and hands
 * `insert_child_after` a widget that is not in the container (a critical at exit 0),
 * and rotating one calls the parent's adder on a node that must never enter it.
 */
export const isUnparented = (el: HostElement): boolean => outsideParentOf(el.descriptor) !== null;

function placementMethod(
    el: HostElement,
    placement: OutsideParent,
    method: string,
    role: 'present' | 'close',
): (...a: unknown[]) => unknown {
    const node = el.widget as unknown as Record<string, ((...a: unknown[]) => unknown) | undefined> | null;
    const fn = node?.[method];
    if (typeof fn !== 'function') throw err.placementMethodMissing(el.descriptor.gtype, placement.kind, method, role);
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
    placementMethod(child, portal, portal.present, 'present');
    placementMethod(child, portal, portal.close, 'close');
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
        placementMethod(child, portal, portal.close, 'close').call(node);
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
        placementMethod(child, portal, portal.close, 'close').call(node);
    }
    placementMethod(child, portal, portal.present, 'present').call(node, anchor);
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
    placementMethod(child, portal, portal.close, 'close').call(child.widget);
}

/**
 * Show a toplevel node — and it needs nothing from its parent, which is the point.
 *
 * NO ANCHOR, NO WAIT, NO SUBSCRIPTION. A portal has two positions in the tree and
 * defers until the parent supplies the second one; a toplevel HAS no second
 * position, so the whole `notify::root` machinery next door has nothing to watch
 * for. Measured: `gtk_window_present` takes 0 arguments where
 * `adw_dialog_present` takes 1, and that arity is exactly the difference.
 *
 * Returns whether GTK has taken the node — always true once there is a widget,
 * because a root is taken by nobody: measured, a presented window answers
 * `get_parent() === null` and `get_root() === itself`. That is not the portal's
 * "claimed but not yet taken" state, it is the finished one.
 *
 * AN AUTHORED `visible: false` IS HONOURED rather than overwritten. `present()`
 * sets the window visible (measured), so presenting unconditionally would make
 * `<gtk-window visible={false}>` a property this host silently reverses — the
 * exact shape it exists to refuse. The node is still `attached`: GTK holds it as
 * its own root whether or not it is on screen, and a later `setProp(el,
 * 'visible', true)` shows it through the ordinary property path.
 */
export function presentToplevel(child: HostElement, placement: Extract<NodePlacement, { kind: 'toplevel' }>): boolean {
    const node = child.widget as unknown as Gtk.Widget | null;
    if (!node) return false;
    const present = placementMethod(child, placement, placement.present, 'present');
    // Asked here as well, for the reason the portal arm asks both up front: a
    // descriptor an application registered is checked by nobody, and a missing
    // `close` first discovered during an unmount is a TypeError with no tag on it.
    placementMethod(child, placement, placement.close, 'close');
    if (child.props.visible !== false) present.call(node);
    return true;
}

/**
 * Take a toplevel back down — the FORCED call, and it is terminal.
 *
 * `destroy` and not `close`, measured on GTK 4.22.4: `gtk_window_close()` emits
 * `close-request`, and an application handler returning TRUE leaves the window
 * mapped and visible. That veto is how an application asks the USER to confirm,
 * and an unmount is not a user request — the same reasoning that makes the portal
 * arm name `force_close`.
 *
 * Unconditional for the same reason too: measured, `destroy()` on a window that
 * was never presented is silent, so no "is it up?" probe is needed. What differs
 * from the portal is that there is no way back — measured, `present()` after a
 * destroy (or after a `close()`, whose default handler destroys) answers
 * `Gtk-WARNING **: A window is shown after it has been destroyed`. A re-mount
 * therefore has to be a fresh widget, which is what `rebuild` already produces.
 */
export function retractToplevel(child: HostElement, placement: Extract<NodePlacement, { kind: 'toplevel' }>): void {
    if (!child.widget) return;
    placementMethod(child, placement, placement.close, 'close').call(child.widget);
}

/**
 * Place a node that does NOT go into its parent's child list, and say whether GTK took it.
 *
 * The ONE dispatch over the non-parented arms. Both callers in `host.ts` reach the
 * axis through this and through `retractOutsideParent`, so a fourth placement kind
 * is two `never` arms away from compiling rather than a search through the host.
 */
export function placeOutsideParent(parent: HostElement, child: HostElement, placement: OutsideParent): boolean {
    switch (placement.kind) {
        case 'portal':
            return presentPortal(parent, child, placement);
        case 'toplevel':
            return presentToplevel(child, placement);
        default:
            return unhandledPlacement(placement);
    }
}

/** `placeOutsideParent`'s twin: take the node back down the way its placement put it up. */
export function retractOutsideParent(child: HostElement, placement: OutsideParent): void {
    switch (placement.kind) {
        case 'portal':
            return retractPortal(child, placement);
        case 'toplevel':
            return retractToplevel(child, placement);
        default:
            return unhandledPlacement(placement);
    }
}

// ---------------------------------------------------------------------------
// What the CLASS says about its own placement
// ---------------------------------------------------------------------------

/** The name every self-presenting class in GTK4 and libadwaita uses. */
const PRESENT = 'present';

/**
 * The placement the installed libraries give this class, or null for an ordinary child.
 *
 * STRUCTURAL, never a name. ADR 0027 rule 1 forbids widget knowledge in the host,
 * and a list of gtypes here would be exactly that — so the class is asked two
 * questions it answers itself, each measured across all 164 rows of the shipped
 * table on GTK 4.22.4 / libadwaita 1.9.3:
 *
 *  - `Gtk.Root` is GTK's OWN word for "this widget is a toplevel". 19 classes in
 *    the table implement it, from `GtkWindow` to `GtkPrintUnixDialog`, and none of
 *    them can legally have a parent.
 *  - A `present()` that TAKES AN ARGUMENT is a node presented AGAINST something.
 *    Exactly five classes in the table have one, and they are exactly the five
 *    `Adw.Dialog` descendants — the ones whose `root` vfunc calls `g_error()`.
 *    `Gtk.Popover.present()` is the discriminator that makes the ARITY part of the
 *    question rather than the name: it exists, it takes 0 arguments, and a popover
 *    is parented with `set_parent()` like any other child.
 *
 * The order matters and is not alphabetical: every `Gtk.Root` in the table also
 * has a 0-argument `present`, and `GtkDragIcon` has no `present` at all, so the
 * root test has to come first and cannot be replaced by an arity test.
 *
 * @param gtype the class's GType — `type_is_a` walks interfaces as well as parents
 * @param present the class's own `present`, or the value found on an instance
 */
export function classPlacementKind(gtype: GObject.GType, present: unknown): OutsideParent['kind'] | null {
    if (GObject.type_is_a(gtype, Gtk.Root.$gtype)) return 'toplevel';
    if (typeof present === 'function' && present.length === 1) return 'portal';
    return null;
}

/** `classPlacementKind` for a live widget, which is what the insert path holds. */
export function nodePlacementKind(node: Gtk.Widget): OutsideParent['kind'] | null {
    const gtype = (node as unknown as { constructor?: { $gtype?: GObject.GType } }).constructor?.$gtype;
    if (!gtype) return null;
    return classPlacementKind(gtype, (node as unknown as Record<string, unknown>)[PRESENT]);
}

/**
 * Refuse a child the installed libraries will not adopt, BEFORE the adder runs.
 *
 * This is the catchable half of the abort class (ADR 0054). `descriptorProblems()`
 * says the same thing about the whole TABLE up front, which is what keeps the
 * shipped rows honest — but `registerWidget` takes descriptors from applications
 * and nothing checks those, and for one of the two families the consequence is not
 * a wrong window: `adw_dialog_root()` is `g_error()`, so the process is gone before
 * any handler runs. A refusal is only possible while there is still a process.
 *
 * ONLY WHERE THE DESCRIPTOR IS SILENT, and that is the escape hatch rather than an
 * oversight. `placement` present — including an explicit `{ kind: 'parented' }` —
 * means the author has answered this question, and the host does not overrule an
 * answer with a heuristic. A consumer widget that trips the `present(parent)` half
 * of the oracle while really being a child says so in one line.
 */
export function refuseUnparentable(parent: HostElement, child: HostElement): void {
    if (child.descriptor.placement !== undefined) return;
    const node = child.widget as unknown as Gtk.Widget | null;
    if (!node) return;
    const kind = nodePlacementKind(node);
    if (!kind) return;
    throw err.unparentableChild(
        parent.descriptor.gtype,
        child.descriptor.gtype,
        kind,
        kind === 'toplevel'
            ? `${child.descriptor.gtype} implements Gtk.Root, so it IS a toplevel and cannot have a parent`
            : `${child.descriptor.gtype}.present() takes a parent, so it is presented AGAINST one and never placed into one`,
    );
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
    // AFTER the catch, not inside it. The sync is not part of the placement, and a
    // throw from in there would be rewritten as a refusal that never happened, on a
    // child GTK has already taken — after which `attach` never marks it attached and
    // the node is unlinked from a tree it is physically in.
    syncPerLineCap(place.parent);
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
    // BEFORE the two guards below, and both would be wrong for a node the parent
    // never took. There is nothing of the parent's to call — and `attached` is
    // false for a portal still waiting for a toplevel, which is exactly the state
    // whose subscription has to be disconnected.
    const outside = outsideParentOf(child.descriptor);
    if (outside) return retractOutsideParent(child, outside);
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
 * The walk is O(children) and runs after every insert, so a build of n children is
 * O(n²) in POINTER HOPS. That is the honest cost and it is nanoseconds: MEASURED,
 * 200 inserts into a flow box take 4.97 ms in total, and an insert does not measure
 * at all — it queues a resize. So the trade is not against a measure this saves; it
 * is that a counter kept on the element would be a second source for a number GTK
 * already holds, and this asks the container.
 *
 * An AUTHORED value is left alone, and one that is later REMOVED is not recovered:
 * the removal puts the class default back and nothing here runs until the next
 * insert or remove. Declared rather than silent — a container given a cap and then
 * relieved of it keeps GTK's 7 until its children change.
 *
 * The write is bracketed as the HOST's so a consumer that never wrote this property
 * is not told it changed (measured: four raw `notify::max-children-per-line` over
 * three inserts and a remove, none delivered to a bound handler). `null` as the
 * target rather than the widget only because there is no non-notify consequence to
 * preserve here, which is where this differs from `writeVisible`.
 */
function syncPerLineCap(parent: HostElement): void {
    const policy = parent.descriptor.children;
    if (policy.kind !== 'indexed' || policy.perLineCap === undefined) return;
    if (parent.props[policy.perLineCap] !== undefined) return;
    const host = parent.widget as unknown as Gtk.Widget | null;
    if (!host) return;
    let children = 0;
    for (let c = host.get_first_child(); c !== null; c = c.get_next_sibling()) children += 1;
    // BOTH ends are clamped, and the messages below are the ones THIS route produces
    // — `set_property`, which is rejected at GValue validation before the C setter's
    // own `assertion 'n_children > 0'` can run. MEASURED on GTK 4.22.4: `0` gives
    // `GLib-GObject-CRITICAL: value "0" of type 'gint' is invalid or out of range for
    // property 'max-children-per-line' of type 'guint'`, and the value is kept.
    //
    // The ceiling is the worse one, because it says NOTHING: 65536 stores 0 — the one
    // value the line above refuses — 65537 stores 1 and 70000 stores 4464, all at
    // exit 0. No container has 65536 children; a package whose reason for existing is
    // refusing exit-0 mis-stores should still not be the one writing them.
    beginHostWrite(null);
    try {
        host.set_property(policy.perLineCap, Math.min(65535, Math.max(1, children)));
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
