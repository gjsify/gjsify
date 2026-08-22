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
import { beginHostWrite, clearHandlers, endHostWrite, isEventProp, setHandler } from './signals.js';
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
    return el.widget;
}

// ---------------------------------------------------------------------------
// Properties, events, slots
// ---------------------------------------------------------------------------

export function setProp(el: HostElement, key: string, next: unknown, _prev?: unknown): void {
    if (isEventProp(key)) return setEventHandler(el, key, next as never);
    if (key === 'slot') return setSlot(el, next as string | null);
    if (key === 'layout') {
        el.layout = next as Record<string, unknown> | null;
        // Position data is read at PLACEMENT time only, so a reactive binding
        // that moves a grid cell or renames a stack page did nothing at all —
        // silently, which is the one thing this host refuses to do. Re-place it,
        // exactly as a slot change does.
        if (el.attached && el.parent) {
            const parent = el.parent;
            removeChild(parent, el);
            el.attached = false;
            attach(parent, el);
        }
        return;
    }

    const name = toPropertyName(key);
    if (next === undefined) delete el.props[name];
    else el.props[name] = next;

    if (!el.widget) return; // buffered until materialisation

    const Klass = el.descriptor.ctor();
    const specs = paramSpecs(Klass, el.descriptor.gtype);
    const spec = requireSpec(specs, el.descriptor.gtype, name);
    if ((spec.flags & GObject.ParamFlags.CONSTRUCT_ONLY) !== 0) return rebuild(el);

    // A renderer removing a prop hands `undefined`, which GObject cannot store:
    // `set_property(name, undefined)` throws "Could not guess unspecified GValue
    // type" (measured). The ParamSpec's own default is what "removed" means.
    const value = next === undefined ? defaultValue(spec) : coerce(spec, next, el.descriptor.gtype);

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
    if (next) el.listeners.set(prop, next);
    else el.listeners.delete(prop);
    if (el.widget) setHandler(el, prop, next);
}

export function setSlot(el: HostElement, slot: string | null): void {
    if (el.slot === slot) return;
    const parent = el.parent;
    if (!parent || !el.widget) {
        el.slot = slot;
        return;
    }
    // A slot change is a move: detach from the old attachment point, re-attach.
    removeChild(parent, el);
    el.slot = slot;
    attach(parent, el);
}

/**
 * Replace the widget in place, preserving position, properties and listeners.
 *
 * A construct-only property cannot be patched — GObject accepts the write and
 * keeps the old value. Rebuilding is the only honest answer, and it is the same
 * move react-three-fiber makes for its `args` prop.
 */
function rebuild(el: HostElement): void {
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
    materialize(el);
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
    for (const child of childSnapshot(el)) destroy(child);
    el.textFromChildren = true;
    writeTextSink(el, text);
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
    if (!sawText && !el.textFromChildren) return;
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
    el.props[sink] = text;
    beginHostWrite();
    try {
        (el.widget as unknown as { set_property(n: string, v: unknown): void }).set_property(
            sink,
            coerce(spec, text, el.descriptor.gtype),
        );
    } finally {
        endHostWrite();
    }
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
    const following: Gtk.Widget[] = [];
    for (let n = child.next; n; n = n.next) {
        if (n.kind === 'element' && n.attached) following.push(addressOf(n));
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
    if (node.parent) remove(node);
    link(parent, node, anchor);
    try {
        if (node.kind === 'element') attach(parent, node);
        else if (node.kind === 'text') flushText(parent);
    } catch (e) {
        // A refused placement must leave NOTHING behind. Linking first and
        // attaching second is the right order (the policy needs the sibling
        // links to compute an anchor), but a throw in between would otherwise
        // leave the node in the shadow tree and out of the GTK one — the two
        // disagreeing is precisely the state every assertion here exists to
        // prevent.
        unlink(node);
        throw e;
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
