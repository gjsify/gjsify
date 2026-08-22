// The host operations every framework adapter binds to.
//
// Fourteen ops and four navigators. That number is the union of four renderer
// contracts, not a guess: Vue's `RendererOptions` (10 + 4 optional), Solid's
// `solid-js/universal` (10, all required), React's `HostConfig` mutation mode,
// and the Svelte custom-renderer PR's 19 attribute-shaped methods. Anything an
// adapter needs beyond these is that framework's own tax and lives in its file.

import GObject from 'gi://GObject';
import type Gtk from '@girs/gtk-4.0';

import { err } from './errors.js';
import {
    addressOf,
    insertChild,
    makeWrapper,
    removeChild,
    setterSlotOf,
    setterSlots,
    slotOccupant,
    type Placement,
} from './policies.js';
import { beginHostWrite, clearHandlers, endHostWrite, isEventProp, setHandler, toSignalName } from './signals.js';
import { coerce, defaultValue, paramSpecs, requireSpec, toPropertyName } from './props.js';
import { lookupWidget, nearestRegistered } from './registry.js';
import type { HostAnchor, HostElement, HostNode, HostText, WidgetDescriptor } from './types.js';

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

export function createElement(tag: string, props?: Record<string, unknown>): HostElement {
    const descriptor = lookupWidget(tag);
    const el: HostElement = {
        kind: 'element',
        descriptor,
        widget: null,
        wrapper: null,
        slot: null,
        parent: null,
        prev: null,
        next: null,
        first: null,
        last: null,
        handlers: new Map(),
        listeners: new Map(),
        props: {},
        layout: null,
        textFromChildren: false,
        attached: false,
        destroyed: false,
        foreign: [],
    };
    if (props) {
        for (const [key, value] of Object.entries(props)) setProp(el, key, value);
    }
    return el;
}

export const createText = (data: string): HostText => ({
    kind: 'text',
    data,
    parent: null,
    prev: null,
    next: null,
});

/**
 * A position marker with no widget. Vue's `createComment` lands here, and so
 * does every `v-if`/`<Show>` boundary.
 *
 * Anchors never enter the GTK tree. Insertion resolves forward past them to the
 * next node that owns a widget — which is why an empty branch cannot shift a
 * sibling's index.
 */
export const createAnchor = (data = ''): HostAnchor => ({
    kind: 'anchor',
    data,
    parent: null,
    prev: null,
    next: null,
});

export const isText = (node: HostNode): node is HostText => node.kind === 'text';

/**
 * Build the GObject. Deferred until the widget is actually needed, because
 * construct-only properties must all be known at `g_object_new` time — and
 * Solid's `createElement(tag)` contract hands over no properties at all.
 */
export function materialize(el: HostElement): GObject.Object {
    if (el.widget) return el.widget;
    const Klass = el.descriptor.ctor();
    const specs = paramSpecs(Klass, el.descriptor.gtype);
    const initial: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(el.props)) {
        const spec = requireSpec(specs, el.descriptor.gtype, name);
        initial[name] = coerce(spec, value, el.descriptor.gtype);
    }
    beginHostWrite();
    try {
        el.widget = new Klass(initial);
    } finally {
        endHostWrite();
    }

    // The replay below can be rejected — a bad signal name, a child this container
    // refuses. `el.widget` is already published because `attach` needs it, so a
    // throw has to UNDO the publication: line one of this function returns early
    // on a set widget, which would otherwise freeze a half-built element for the
    // life of the process and make every later repair a silent no-op.
    try {
        replayInto(el);
    } catch (e) {
        // `replayInto` binds the listeners BEFORE placing children, so by now the
        // ledger holds ids on the widget we are about to discard. Handler ids are
        // per-instance: leaving them would keep the callbacks alive on an orphan
        // for the life of the process AND make the documented retry disconnect an
        // id the new instance never issued.
        clearHandlers(el);
        for (const child of childSnapshot(el)) {
            if (child.kind === 'element' && child.attached) {
                removeChild(el, child);
                child.attached = false;
            }
        }
        el.widget = null;
        el.wrapper = null;
        throw e;
    }
    return el.widget;
}

/** Bind the listeners and place the children a bottom-up build already queued. */
function replayInto(el: HostElement): void {
    for (const [prop, callback] of el.listeners) setHandler(el, prop, callback);

    // Children inserted BEFORE this element had a widget are still only in the
    // shadow tree — `attach` cannot place a child into a parent that does not
    // exist yet. Placing them now is what makes bottom-up construction work, and
    // every framework builds bottom-up: Vue and React create and fill a subtree
    // before inserting it into its parent.
    for (let child = el.first; child; child = child.next) {
        if (child.kind === 'element') attach(el, child);
    }
    if (el.textFromChildren) flushText(el);
}

// ---------------------------------------------------------------------------
// Properties, events, slots
// ---------------------------------------------------------------------------

export function setProp(el: HostElement, key: string, next: unknown, _prev?: unknown): void {
    if (isEventProp(key)) return setEventHandler(el, key, next as never);
    if (key === 'slot') return setSlot(el, next as string | null);
    if (key === 'layout') {
        // Position data is read at PLACEMENT time only, so a reactive binding that
        // moves a grid cell or renames a stack page did nothing at all — silently,
        // which is the one thing this host refuses to do. Re-place it, exactly as
        // a slot change does.
        //
        // The guard is `parent && widget`, NOT `attached`: guarding on `attached`
        // made a refused layout write disable its own recovery, so the write that
        // FIXED the value returned normally and changed nothing, for ever.
        const layout = next as Record<string, unknown> | null;
        const parent = el.parent;
        if (!parent || !el.widget) {
            el.layout = layout;
            return;
        }
        const previous = el.layout;
        replaceAt(
            el,
            parent,
            () => {
                el.layout = layout;
            },
            () => {
                el.layout = previous;
            },
        );
        return;
    }

    const name = toPropertyName(key);

    // Validate BEFORE recording. `el.props` is authored intent and it is replayed
    // verbatim by `materialize`, so a rejected value kept there poisons the next
    // rebuild: a typo'd property threw once at the call site, then again from
    // inside `materialize` — during a perfectly valid construct-only write, which
    // left the widget detached and null. Nothing is written down until the
    // installed GTK has agreed to it.
    const specs = paramSpecs(el.descriptor.ctor(), el.descriptor.gtype);
    const spec = requireSpec(specs, el.descriptor.gtype, name);
    // A renderer removing a prop hands `undefined`, which GObject cannot store:
    // `set_property(name, undefined)` throws "Could not guess unspecified GValue
    // type" (measured). The ParamSpec's own default is what "removed" means.
    const value = next === undefined ? defaultValue(spec) : coerce(spec, next, el.descriptor.gtype);

    const previouslyRecorded = name in el.props ? el.props[name] : undefined;
    if (next === undefined) delete el.props[name];
    else el.props[name] = next;

    if (!el.widget) return; // buffered until materialisation
    if ((spec.flags & GObject.ParamFlags.CONSTRUCT_ONLY) !== 0) return rebuild(el, name, previouslyRecorded);

    beginHostWrite();
    try {
        (el.widget as unknown as GObject.Object & { set_property(n: string, v: unknown): void }).set_property(
            name,
            value,
        );
    } finally {
        endHostWrite();
    }
}

export function setEventHandler(el: HostElement, prop: string, next: ((...args: unknown[]) => unknown) | null): void {
    // Connect first, record second — `el.listeners` is replayed verbatim by
    // `materialize`, so a rejected signal name kept here re-threw from inside the
    // next rebuild and left the element detached with `widget === null`.
    //
    // The unmaterialised case is validated too: `GObject.signal_lookup` answers
    // from the CLASS, so a typo does not have to wait for a widget to exist.
    if (el.widget) {
        setHandler(el, prop, next);
    } else if (next) {
        assertSignalExists(el, prop);
    }
    if (next) el.listeners.set(prop, next);
    else el.listeners.delete(prop);
}

/** Does the class emit this signal at all? Answered without an instance. */
function assertSignalExists(el: HostElement, prop: string): void {
    const signal = toSignalName(prop, el.descriptor.eventAliases);
    const base = signal.split('::')[0];
    const gtype = (el.descriptor.ctor() as unknown as { $gtype: GObject.GType }).$gtype;
    if (GObject.signal_lookup(base, gtype) === 0) {
        throw err.unknownSignal(el.descriptor.gtype, prop, base);
    }
}

export function setSlot(el: HostElement, slot: string | null): void {
    if (el.slot === slot) return;
    const parent = el.parent;
    if (!parent || !el.widget) {
        el.slot = slot;
        return;
    }
    // A slot change is a move: detach from the old attachment point, re-attach.
    const previous = el.slot;
    replaceAt(
        el,
        parent,
        () => {
            el.slot = slot;
        },
        () => {
            el.slot = previous;
        },
    );
}

/**
 * Re-place a child after changing what decides its position.
 *
 * `commit` applies the change, `rollback` undoes it. Two things a naive version
 * gets wrong, both measured: a refused re-place must not keep the rejected value,
 * and it must not leave the node detached in a way that makes the NEXT write —
 * the one that fixes the value — skip itself for ever.
 */
function replaceAt(el: HostElement, parent: HostElement, commit: () => void, rollback: () => void): void {
    removeChild(parent, el);
    el.attached = false;
    commit();
    try {
        attach(parent, el);
    } catch (e) {
        rollback();
        try {
            attach(parent, el);
        } catch {
            // The old placement worked a moment ago; if it no longer does, the
            // ORIGINAL rejection is what the caller needs to see.
        }
        throw e;
    }
}

/**
 * Replace the widget in place, preserving position, properties and listeners.
 *
 * A construct-only property cannot be patched — GObject accepts the write and
 * keeps the old value. Rebuilding is the only honest answer, and it is the same
 * move react-three-fiber makes for its `args` prop.
 */
function rebuild(el: HostElement, key?: string, previous?: unknown): void {
    const parent = el.parent;
    if (el.widget) {
        clearHandlers(el);
        // Detach the children from the OLD widget first. GTK refuses to reparent
        // a widget that still has a parent — `gtk_widget_set_parent` warns
        // "Cannot set parent on widget …, which already has parent …" and
        // returns — so without this the subtree silently empties, at exit 0.
        for (const child of childSnapshot(el)) {
            if (child.kind === 'element') {
                removeChild(el, child);
                child.attached = false;
            }
        }
        if (parent) removeChild(parent, el);
    }
    el.widget = null;
    el.wrapper = null;
    el.attached = false;
    // `materialize` replays the whole child list itself; a second pass here
    // attached everything twice and made the remove-all policy re-append a tail
    // that was already in place.
    //
    // If it throws, the element is already out of its parent and has no widget —
    // and a corrective `setProp` would then hit the `!el.widget` buffer path and
    // never come back. Put the old value back and re-place it, so the failure
    // costs the caller an exception and nothing else.
    try {
        materialize(el);
    } catch (e) {
        if (key !== undefined) {
            if (previous === undefined) delete el.props[key];
            else el.props[key] = previous;
        }
        try {
            materialize(el);
            if (parent) attach(parent, el);
        } catch {
            // The old value built a widget a moment ago; if it no longer does, the
            // ORIGINAL rejection is what the caller needs to see.
        }
        throw e;
    }
    if (parent) attach(parent, el);
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

export function setText(node: HostText | HostAnchor, data: string): void {
    node.data = data;
    if (node.kind === 'text' && node.parent) flushText(node.parent);
}

/** Vue's bulk path and React's `shouldSetTextContent`: drop children, set the sink. */
export function setElementText(el: HostElement, text: string): void {
    // The sink check FIRST: `destroy` is eager and irreversible, so a widget with
    // no text sink used to lose its whole subtree on the way to being told no.
    writeTextSink(el, text);
    // Disarm before the removals: destroying the old text children triggers
    // `flushText`, which would see an empty concatenation with the flag still set
    // and clear the text we just wrote.
    el.textFromChildren = false;
    for (const child of childSnapshot(el)) destroy(child);
    // Deliberately NOT re-armed: the flag means "text children own the sink", and
    // there are none left. Arming it made the next rebuild's `flushText` compute
    // an empty concatenation, skip its own guard and wipe the text — silently.
    // `writeTextSink` recorded the value in `el.props`, which a rebuild replays.
}

function flushText(el: HostElement): void {
    let text = '';
    let sawText = false;
    for (const child of childNodes(el)) {
        if (child.kind === 'text') {
            text += child.data;
            sawText = true;
        }
    }
    // Removing the LAST text child has to clear the sink. Without the flag, a
    // widget whose text was deleted keeps rendering the old string — and only
    // text children may clear it, never an authored `label` prop.
    // Emptiness, not text-ness, is the discriminator. Vue's `processFragment`
    // marks every `v-for` and multi-root template with `hostCreateText('')` — not
    // a comment, so an adapter has no hook to route it — and dom-expressions'
    // `cleanChildren` does `createTextNode("")`. Rejecting those made a `v-for`
    // impossible to mount into ANY sink-less container. Real text still throws.
    if (text === '' && !el.textFromChildren) return;
    // Clearing the sink must not take an element child with it. GTK's text sink
    // IS the one-child slot: measured on gtk 4.22, `set_child(custom)` gives
    // `custom.parent === GtkButton` and the very next `set_property('label','')`
    // gives `custom.parent === NULL`. Solid and React reconcile
    // INSERT-then-REMOVE (`solid-js/universal`'s `replaceNode`), so swapping a
    // text child for an element child on a `GtkButton` — `single` AND a text
    // sink, both — placed the element and then cleared it away: a blank button
    // at exit 0, zero diagnostics, and `attached === true` for a widget GTK had
    // unparented. `clearIfCurrent` is this guard's element-side twin; only the
    // text side was missing.
    const sink = el.descriptor.textSink;
    if (text === '' && sink && holdsElementInSetterSlot(el)) {
        el.textFromChildren = false;
        // The recorded value came from text children that are gone, and
        // `materialize` replays `props` verbatim — keeping it would restate the
        // deleted text into the slot the element child now owns.
        delete el.props[sink];
        return;
    }
    // Set AFTER the write: `writeTextSink` throws for a sink-less widget, and a
    // flag set before it survives the failed insert — a later rebuild would then
    // flush text into a widget that never accepted any.
    writeTextSink(el, text);
    el.textFromChildren = sawText;
}

/**
 * Our element children whose placement goes through the parent's ONE-CHILD slot.
 *
 * The text sink writes that same slot, so both text paths need this walk: one to
 * refuse a clear that would evict such a child, one to record that a write just
 * did.
 */
function* setterSlotChildren(el: HostElement): Generator<HostElement> {
    for (const child of siblingsFrom(el.first, el)) {
        if (child.kind === 'element' && child.attached && setterSlotOf(el, child)) yield child;
    }
}

const holdsElementInSetterSlot = (el: HostElement): boolean => !setterSlotChildren(el).next().done;

function writeTextSink(el: HostElement, text: string): void {
    const sink = el.descriptor.textSink;
    if (!sink) throw err.textNotAccepted(el.descriptor.gtype, text);
    materialize(el);
    const specs = paramSpecs(el.descriptor.ctor(), el.descriptor.gtype);
    const spec = requireSpec(specs, el.descriptor.gtype, sink);
    beginHostWrite();
    try {
        (el.widget as unknown as { set_property(n: string, v: unknown): void }).set_property(
            sink,
            coerce(spec, text, el.descriptor.gtype),
        );
    } finally {
        endHostWrite();
    }
    // Recorded only once GTK has taken it — `el.props` is replayed verbatim by
    // `materialize`, so a rejected value kept here re-throws from a later rebuild.
    el.props[sink] = text;

    // A non-empty write into a one-child slot is the SAME collision the other
    // way round: measured, `set_child(custom)` then `set_property('label','text')`
    // also leaves `custom.parent === NULL`. GTK has just unparented that child,
    // so the shadow tree stops claiming otherwise — `attached` means "GTK has
    // taken this node", and a later `remove` would ask GTK to unparent a
    // non-child (a critical, at exit 0).
    for (const child of setterSlotChildren(el)) child.attached = false;
}

// ---------------------------------------------------------------------------
// Tree
// ---------------------------------------------------------------------------

function* childNodes(el: HostElement): Generator<HostNode> {
    for (let n = el.first; n; n = n.next) yield n;
}

/**
 * A SNAPSHOT of the children.
 *
 * Every caller of this walks the list while unlinking from it. Iterating the
 * live links there skips every second node, because `n.next` is already null by
 * the time the loop reads it.
 */
function childSnapshot(el: HostElement): HostNode[] {
    const out: HostNode[] = [];
    for (const n of siblingsFrom(el.first, el)) out.push(n);
    return out;
}

/**
 * A child list longer than this is a cycle, not a user interface.
 *
 * The number is deliberately absurd: it must never be reached by a real tree,
 * and it must be reached QUICKLY by a malformed one.
 */
const CHAIN_LIMIT = 100_000;

/**
 * Walk a sibling chain, bounded.
 *
 * A malformed link is not a theoretical worry. `insert(node, parent, node)` is a
 * defined NO-OP in the DOM — "if referenceChild is node, then set referenceChild
 * to node's next sibling" — so Solid's adjacent-swap fast path emits exactly
 * that shape, unguarded. This host used to write `node.next = node` for it, and
 * the walks below then grew an unbounded array until the process was killed:
 * reversing a TWO-item list hung the app. A hang is the one failure mode worse
 * than GTK's silent exit 0, because it takes the CI job with it. Every walk over
 * `next` goes through here so the bound cannot be forgotten at a new call site.
 */
function* siblingsFrom(start: HostNode | null, parent: HostElement): Generator<HostNode> {
    let steps = 0;
    for (let n = start; n; n = n.next) {
        if (++steps > CHAIN_LIMIT) throw err.siblingCycle(parent.descriptor.gtype);
        yield n;
    }
}

function link(parent: HostElement, node: HostNode, anchor: HostNode | null): void {
    node.parent = parent;
    if (anchor) {
        node.prev = anchor.prev;
        node.next = anchor;
        if (anchor.prev) anchor.prev.next = node;
        else parent.first = node;
        anchor.prev = node;
    } else {
        node.prev = parent.last;
        node.next = null;
        if (parent.last) parent.last.next = node;
        else parent.first = node;
        parent.last = node;
    }
}

function unlink(node: HostNode): void {
    const parent = node.parent;
    if (!parent) return;
    if (node.prev) node.prev.next = node.next;
    else parent.first = node.next;
    if (node.next) node.next.prev = node.prev;
    else parent.last = node.prev;
    node.prev = null;
    node.next = null;
    node.parent = null;
}

/** Compute the placement facts from the SHADOW tree, then let the policy act. */
function attach(parent: HostElement, child: HostElement): void {
    // A parent without a widget cannot adopt anything yet; `materialize` replays
    // the whole child list once it has one.
    if (!parent.widget) return;
    materialize(child);
    ensureWrapper(parent, child);

    refuseOccupiedSlot(parent, child);

    // Start AFTER what the application already put in the container. Without this
    // the first insertion into an adopted root resolves to `insert_child_after(w,
    // null)` — GTK's "make first" — and the rendered tree lands above the app's own
    // chrome. `mountRoot` used to compensate for itself; every adapter needs it.
    // Index arithmetic rather than `.at(-1)`: this package targets es2020 and
    // `Array.prototype.at` is es2022. `gjsify tsc --noEmit` let it through on a
    // stale tsbuildinfo; the full build did not.
    // Filter the snapshot to what is STILL a child. `foreign` is taken once in
    // `adopt`, and an application may add or remove its own widgets afterwards —
    // `insert_child_after` then asserts on a sibling that has left the container
    // (a critical at exit 0) while the shadow tree records the insertion as
    // attached, i.e. claims GTK took a widget it refused.
    const priorChildren =
        parent.foreign.length > 0
            ? parent.foreign.filter((w) => (w as unknown as { get_parent(): unknown }).get_parent() === parent.widget)
            : parent.foreign;

    let prevWidget: Gtk.Widget | null = priorChildren.length > 0 ? priorChildren[priorChildren.length - 1] : null;
    let index = priorChildren.length;
    for (const n of siblingsFrom(parent.first, parent)) {
        if (n === child) break;
        if (n.kind !== 'element' || !n.attached) continue;
        prevWidget = addressOf(n);
        index += 1;
    }
    const following: HostElement[] = [];
    for (const n of siblingsFrom(child.next, parent)) {
        if (n.kind === 'element' && n.attached) following.push(n);
    }
    const placement: Placement = { parent, child, prevWidget, index, following };
    insertChild(placement);
    child.attached = true;
}

/**
 * Never place into a one-child slot the APPLICATION is using.
 *
 * Offsetting past what a container already held only works where placement
 * appends. A one-child setter REPLACES, and GTK does it silently: measured,
 * `win = new Gtk.ScrolledWindow(); win.set_child(chrome); mount(() => label,
 * win)` left `chrome.get_parent() === null` with no throw, no GTK warning and an
 * empty diagnostics gate — the application's widget simply gone. Refusing by
 * name is the only answer that neither drops a widget nor guesses which of the
 * two the application wanted.
 *
 * The occupant is compared against `foreign`, i.e. against what `adopt` saw. A
 * slot holding one of OUR OWN element children is the ordinary
 * insert-then-unmount order Solid and React use, and must stay allowed; a slot
 * the application has since cleared itself is free again.
 */
function refuseOccupiedSlot(parent: HostElement, child: HostElement): void {
    if (parent.foreign.length === 0) return;
    const setter = setterSlotOf(parent, child);
    if (!setter) return;
    const occupant = slotOccupant(parent.widget as unknown as Gtk.Widget, setter);
    if (!occupant || !parent.foreign.includes(occupant)) return;
    throw err.occupiedSlot(parent.descriptor.gtype, child.descriptor.gtype, setter);
}

/** `indexed` parents address a wrapper row; create it once, before first placement. */
function ensureWrapper(parent: HostElement, child: HostElement): void {
    if (child.wrapper) return;
    const wrapper = makeWrapper(parent.descriptor.children, child.widget as unknown as Gtk.Widget);
    if (wrapper) child.wrapper = wrapper;
}

export function insert(node: HostNode, parent: HostElement, anchor: HostNode | null = null): void {
    // Where it was, so a refused move can be undone. "Leave nothing behind" has
    // to mean the OLD parent too: detaching first and failing second lost the
    // node from a tree that was perfectly valid.
    const wasIn = node.parent;
    const wasBefore = node.next;

    // DOM parity, and not a nicety. `insertBefore(n, n)` is DEFINED as a no-op
    // ("if referenceChild is node, then set referenceChild to node's next
    // sibling"), which is why Solid's adjacent-swap fast path emits
    // `insertNode(parent, b, b)` without a guard. Taken literally it made `link`
    // write `node.next = node`; reversing a two-item list then hung the process.
    // Three items take a different branch, which is why the suite was green.
    const before = anchor === node ? wasBefore : anchor;

    if (node.parent) remove(node);
    link(parent, node, before);
    try {
        if (node.kind === 'element') attach(parent, node);
        else if (node.kind === 'text') flushText(parent);
    } catch (e) {
        // Linking before attaching is the right order — the policy needs the
        // sibling links to resolve an anchor — so the throw path undoes it.
        unlink(node);
        if (wasIn) restore(node, wasIn, wasBefore);
        throw e;
    }
}

/**
 * Put a node back where a failed move took it from.
 *
 * Best effort by construction: the old placement worked a moment ago, so this
 * normally succeeds. If it does not, the ORIGINAL rejection is what the caller
 * needs to see — a restore failure reported instead would name the wrong cause.
 */
function restore(node: HostNode, parent: HostElement, before: HostNode | null): void {
    try {
        link(parent, node, before);
        if (node.kind === 'element') attach(parent, node);
        else if (node.kind === 'text') flushText(parent);
    } catch {
        unlink(node);
    }
}

/** Detach only — reversible. Frameworks move nodes; `remove` must not destroy one. */
export function remove(node: HostNode): void {
    const parent = node.parent;
    if (parent && node.kind === 'element') {
        removeChild(parent, node);
        node.attached = false;
        // The wrapper row belongs to the parent that demanded it, not to the
        // child. Keeping it would drag a GtkListBoxRow into the next parent —
        // and the real widget would still be inside it, hence still parented.
        if (node.wrapper) {
            (node.wrapper as unknown as { set_child(w: unknown): void }).set_child(null);
            node.wrapper = null;
        }
    }
    unlink(node);
    if (parent && node.kind === 'text') flushText(parent);
}

export function clearContainer(parent: HostElement): void {
    while (parent.first) remove(parent.first);
}

/**
 * Disconnect a node's handlers WITHOUT touching the tree.
 *
 * The narrow half of `destroy`, and it exists because a framework can tell us "this
 * node is gone" while still holding its sibling links: Solid disposes a per-node
 * scope BEFORE its reconciler runs, and `reconcileArrays` opens with
 * `getNextSibling(last)`. Unlinking there made every trailing insertion append at
 * the end of the parent instead of before the marker.
 *
 * The leak this closes is about handlers, not links — GJS blocks JS callbacks
 * during GC, so an undisconnected handler outlives its widget. The framework's own
 * `removeNode` still does the unlinking, in its own order.
 */
export function disconnectHandlers(el: HostElement): void {
    clearHandlers(el);
    el.listeners.clear();
}

/**
 * Tear a subtree down: disconnect every handler, unparent, drop the reference.
 *
 * It is eager and it is the only place a handler dies. GJS blocks JS callbacks
 * during GC ("The offending callback was `dispose()`"), so whatever is not
 * disconnected here stays connected for the life of the process.
 *
 * A toplevel window is the one node unparenting cannot reach — it has no parent
 * and its `GtkApplication` still holds it — so it is closed explicitly.
 */
export function destroy(node: HostNode): void {
    if (node.kind === 'element') {
        for (const child of childSnapshot(node)) destroy(child);
        clearHandlers(node);
        node.listeners.clear();
    }
    remove(node);
    if (node.kind === 'element') {
        const widget = node.widget as unknown as { destroy?: () => void; get_parent?: () => unknown } | null;
        if (
            widget &&
            typeof widget.destroy === 'function' &&
            typeof widget.get_parent === 'function' &&
            widget.get_parent() === null
        ) {
            widget.destroy();
        }
        node.widget = null;
        node.wrapper = null;
        // A destroyed node keeps no authored state: `props` and `layout` exist so
        // a REBUILD can restate the same intent, and there is nothing left to
        // rebuild. Leaving them made a destroyed element look re-materialisable.
        node.props = {};
        node.layout = null;
        node.textFromChildren = false;
        node.destroyed = true;
    }
}

/**
 * Put a host tree inside an existing GTK container the application owns.
 *
 * The container is resolved through the SAME table as every other parent —
 * `nearestRegistered` walks the real type hierarchy, so an application's own
 * `GObject.registerClass` subclass inherits its ancestor's policy. Guessing a
 * method name here would be the generic `add` that GTK4 deliberately removed.
 */
export function mountRoot(el: HostElement, container: Gtk.Widget): void {
    materialize(el);
    const parent = adopt(container);
    // `adopt` recorded what the container already held and `attach` offsets past
    // it, so this is now the ordinary path.
    insert(el, parent);
}

/**
 * Wrap a widget the application owns as a host element.
 *
 * The seam every framework adapter needs: a renderer mounts into a container it
 * did not create. The descriptor comes from the SAME table as every other parent,
 * through `nearestRegistered`, so an application's own `GObject.registerClass`
 * subclass inherits its ancestor's placement rules instead of failing.
 */
export function adopt(container: Gtk.Widget): HostElement {
    const gtype = (container as unknown as { constructor: { $gtype: GObject.GType } }).constructor.$gtype;
    const descriptor = nearestRegistered(gtype);
    if (!descriptor) throw err.unknownTag(gtypeNameOf(container));
    return {
        kind: 'element',
        descriptor,
        widget: container as unknown as GObject.Object,
        wrapper: null,
        slot: null,
        parent: null,
        prev: null,
        next: null,
        first: null,
        last: null,
        handlers: new Map(),
        listeners: new Map(),
        props: {},
        layout: null,
        textFromChildren: false,
        attached: true,
        destroyed: false,
        // What the application put there. Placement offsets past it, or — for a
        // slot that replaces rather than appends — refuses to overwrite it.
        foreign: adoptedChildren(container, descriptor),
    };
}

/**
 * What the application already had in this container — asked the way the
 * container answers honestly.
 *
 * A one-child slot has to be asked through its GETTER, never through the child
 * list: measured on gtk 4.22 / libadwaita 1.8, a FRESH `Gtk.ScrolledWindow` has
 * two `GtkScrollbar` direct children, `Adw.ToolbarView` two `GtkRevealer`s,
 * `Adw.Window` an `AdwDialogHost` + an `AdwGizmo` and `Adw.StatusPage` a
 * `GtkScrolledWindow`, while all four getters answer `null`. A child-list
 * snapshot therefore reports application chrome that does not exist — and for a
 * slot that REPLACES there is no offset to compute from it anyway.
 */
function adoptedChildren(container: Gtk.Widget, descriptor: WidgetDescriptor): Gtk.Widget[] {
    const slots = setterSlots(descriptor.children);
    if (slots.length === 0) return directChildren(container);
    const out: Gtk.Widget[] = [];
    for (const setter of slots) {
        const occupant = slotOccupant(container, setter);
        if (occupant) out.push(occupant);
    }
    return out;
}

/** Direct GTK children of a widget — what the container already holds. */
function directChildren(widget: Gtk.Widget): Gtk.Widget[] {
    const out: Gtk.Widget[] = [];
    const w = widget as unknown as { get_first_child?: () => Gtk.Widget | null };
    if (typeof w.get_first_child !== 'function') return out;
    for (
        let c = w.get_first_child();
        c;
        c = (c as unknown as { get_next_sibling(): Gtk.Widget | null }).get_next_sibling()
    ) {
        out.push(c);
    }
    return out;
}

const gtypeNameOf = (obj: unknown): string =>
    GObject.type_name((obj as { constructor: { $gtype: GObject.GType } }).constructor.$gtype);

// Navigators — from the shadow tree, never from GTK.
export const parentNode = (node: HostNode): HostElement | null => node.parent;
export const firstChild = (el: HostElement): HostNode | null => el.first;
export const nextSibling = (node: HostNode): HostNode | null => node.next;
export const prevSibling = (node: HostNode): HostNode | null => node.prev;

export type { WidgetDescriptor };
