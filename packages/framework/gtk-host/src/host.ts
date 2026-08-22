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
import { addressOf, insertChild, makeWrapper, removeChild, type Placement } from './policies.js';
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
    // Set AFTER the write: `writeTextSink` throws for a sink-less widget, and a
    // flag set before it survives the failed insert — a later rebuild would then
    // flush text into a widget that never accepted any.
    writeTextSink(el, text);
    el.textFromChildren = sawText;
}

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
    for (let n = el.first; n; n = n.next) out.push(n);
    return out;
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

    let prevWidget: Gtk.Widget | null = null;
    let index = 0;
    for (let n = parent.first; n && n !== child; n = n.next) {
        if (n.kind !== 'element' || !n.attached) continue;
        prevWidget = addressOf(n);
        index += 1;
    }
    const following: HostElement[] = [];
    for (let n = child.next; n; n = n.next) {
        if (n.kind === 'element' && n.attached) following.push(n);
    }
    const placement: Placement = { parent, child, prevWidget, index, following };
    insertChild(placement);
    child.attached = true;
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

    if (node.parent) remove(node);
    link(parent, node, anchor);
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
    const gtype = (container as unknown as { constructor: { $gtype: GObject.GType } }).constructor.$gtype;
    const descriptor = nearestRegistered(gtype);
    if (!descriptor) throw err.unknownTag(gtypeNameOf(container));

    const parent: HostElement = {
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
    };
    // The container may already hold children the application put there. The
    // synthetic parent's shadow tree is empty, so ordinary placement computes
    // "first" and `insert_child_after(w, null)` puts the host tree BEFORE them.
    // Read the real children and append after the last one.
    const existing = directChildren(container);
    link(parent, el, null);
    try {
        ensureWrapper(parent, el);
        insertChild({
            parent,
            child: el,
            prevWidget: existing.length > 0 ? existing[existing.length - 1] : null,
            index: existing.length,
            following: [],
        });
        el.attached = true;
    } catch (e) {
        unlink(el);
        throw e;
    }
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
