// @gjsify/devtools — GTK widget-tree introspection (toplevels, tree dump,
// stable index paths, property read, focused-widget path). Original implementation.

import Gtk from 'gi://Gtk?version=4.0';
import type { NodeGeometry, NodeInfo } from '@gjsify/devtools-protocol';

/** A parsed widget path: a toplevel index + a chain of child indices. */
export interface ParsedWidgetPath {
    toplevel: number;
    children: number[];
}

/**
 * Parse a stable widget path like `toplevel:0/child:2/child:0` into its
 * indices. Pure (no GTK) so it is unit-testable on node + gjs. Returns null
 * for a malformed path.
 */
export function parseWidgetPath(path: string): ParsedWidgetPath | null {
    const parts = path.split('/').filter((p) => p.length > 0);
    if (parts.length === 0) return null;
    const head = parts[0].match(/^toplevel:(\d+)$/);
    if (!head) return null;
    const children: number[] = [];
    for (const part of parts.slice(1)) {
        const m = part.match(/^child:(\d+)$/);
        if (!m) return null;
        children.push(Number(m[1]));
    }
    return { toplevel: Number(head[1]), children };
}

/** Build a widget path from a toplevel index + child-index chain. */
export function buildWidgetPath(toplevel: number, children: readonly number[]): string {
    return [`toplevel:${toplevel}`, ...children.map((i) => `child:${i}`)].join('/');
}

/**
 * The concrete runtime GType name of a widget instance (best-effort).
 *
 * Portable across runtimes:
 * - **GJS** downcasts a returned GObject to its concrete wrapper class, so the
 *   runtime type is `widget.constructor.$gtype.name`.
 * - **node-gi** (`--app node`) returns a GENERIC wrapper for a returned handle
 *   (it does not downcast), so `constructor.$gtype.name` would be the static
 *   declared type. Its L1 wrapper instead exposes the true runtime GType name on
 *   `$typeName` — prefer it when present. (GJS has no `$typeName` on instances.)
 */
export function widgetType(widget: Gtk.Widget): string {
    return gtypeName(widget) ?? 'GtkWidget';
}

/**
 * The runtime GType name of any GObject, or null when it cannot be read.
 *
 * The body {@link widgetType} used to hold inline, lifted because the same question gets asked of
 * things that are not widgets — a `Gtk.EventController`, say. `instanceof` is NOT the alternative:
 * under node-gi a returned handle is a GENERIC wrapper, so `instanceof Gtk.EventControllerKey`
 * answers false for an object that IS one, which is the very reason this reads `$typeName` first.
 */
function gtypeName(object: unknown): string | null {
    const o = object as { $typeName?: unknown; constructor?: { $gtype?: { name?: string } } } | null;
    if (typeof o?.$typeName === 'string' && o.$typeName.length > 0) return o.$typeName;
    return o?.constructor?.$gtype?.name ?? null;
}

/**
 * Activate a widget — how external tooling click-drives a running GUI: resolve a
 * widget by path, then activate it. Two paths, tried in order:
 *
 *  1. **`gtk_widget_activate()`** — the widget's own default-activation signal
 *     (a `Gtk.Button` emits `clicked`, a `Gtk.Entry` emits `activate`, a
 *     `Gtk.ToggleButton` toggles). Returns true when it fires.
 *  2. **Row fallback** — a `GtkListBoxRow` / `AdwActionRow` is NOT activatable
 *     via `gtk_widget_activate()` (returns false): a row's interaction routes
 *     through the owning `GtkListBox`, not the row's own signal. So driving a
 *     sidebar nav row or a preference row over path #1 alone silently no-ops.
 *     When the widget's parent is a `GtkListBox`, reproduce what a real click on
 *     a row does — it both SELECTS the row (`select_row` → the `row-selected`
 *     signal selection-driven nav shells listen to) AND ACTIVATES it
 *     (`row-activated`, for activatable rows). Doing both drives either wiring
 *     (a GtkListBox only ever parents rows, so the parent-type check is enough
 *     to know the widget is the row to pass). `select_row` is a no-op under
 *     selection-mode `none`, so it is always safe to call.
 *
 * Returns true if either path activated the widget, false if neither applies
 * (e.g. a plain container). Duck-typed on the accessors it reads for the same
 * cross-runtime reason as {@link widgetType} (GJS vs node-gi both expose them,
 * so the spec can feed plain mock shapes).
 */
export function activateWidget(widget: Gtk.Widget): boolean {
    const w = widget as unknown as { activate?: () => boolean; get_parent?: () => unknown };
    // 1. The widget's own default activation (Button/Entry/Toggle/…).
    if (typeof w.activate === 'function' && w.activate() === true) return true;
    // 2. Row fallback: reproduce a click on a GtkListBox row — select + activate.
    const parent = typeof w.get_parent === 'function' ? w.get_parent() : null;
    if (parent && widgetType(parent as Gtk.Widget) === 'GtkListBox') {
        const box = parent as {
            select_row?: (row: unknown) => void;
            emit?: (signal: string, ...args: unknown[]) => void;
        };
        let activated = false;
        if (typeof box.select_row === 'function') {
            box.select_row(widget); // → row-selected (selection-driven nav)
            activated = true;
        }
        if (typeof box.emit === 'function') {
            box.emit('row-activated', widget); // → row-activated (activatable rows)
            activated = true;
        }
        return activated;
    }
    return false;
}

/**
 * Deliver a key to a widget's own key controllers — how external tooling proves a KEYBOARD works.
 *
 * The control plane could already press buttons and fire actions, so a GUI could be driven and
 * screenshotted headlessly — but not TYPED INTO. Anything handled by a `Gtk.EventControllerKey`
 * (an editor's arrow keys, Delete in a canvas, Escape in a picker) was therefore unverifiable: the
 * code looked right, the screenshot looked right, and whether a key ever reached the handler was
 * nobody's measurement. A `Gtk.DrawingArea` that is not `focusable` swallows every key silently,
 * which is exactly the shape of bug that survives review.
 *
 * It emits `key-pressed` on the controllers ATTACHED TO THE WIDGET rather than fabricating a
 * `Gdk.Event`: GTK4 made events opaque with no public constructor, so no binding can construct
 * one. Say what that means honestly — this proves the HANDLER runs and what it does, not that GDK
 * would route a real key press here. The two differ exactly when the widget cannot take focus, so
 * a caller checking a keyboard should read `focusable` as well.
 *
 * Returns true if some controller claimed the key (its handler returned true).
 */
export function sendKeyToWidget(widget: Gtk.Widget, keyval: number, modifiers: number): boolean {
    const controllers = widget.observe_controllers();
    let handled = false;
    for (let i = 0; i < controllers.get_n_items(); i++) {
        const controller = controllers.get_item(i);
        if (gtypeName(controller) !== 'GtkEventControllerKey') continue;
        // Signal return values are not surfaced by GJS' `emit`, so "handled" here means the key was
        // delivered to at least one key controller, not that a handler consumed it. A caller that
        // needs the outcome observes the EFFECT — which is the point of sending the key at all.
        (controller as unknown as Gtk.EventControllerKey).emit('key-pressed', keyval, 0, modifiers);
        handled = true;
    }
    return handled;
}

function nthChild(widget: Gtk.Widget, index: number): Gtk.Widget | null {
    let child = widget.get_first_child();
    let i = 0;
    while (child && i < index) {
        child = child.get_next_sibling();
        i++;
    }
    return i === index ? child : null;
}

/** Enumerate live toplevel windows as `{ path, type, title, mapped, focused }`. */
export function listToplevels(): Array<{
    path: string;
    type: string;
    title: string | null;
    mapped: boolean;
    focused: boolean;
}> {
    const model = Gtk.Window.get_toplevels();
    const count = model.get_n_items();
    const out: Array<{ path: string; type: string; title: string | null; mapped: boolean; focused: boolean }> = [];
    for (let i = 0; i < count; i++) {
        const win = model.get_item(i) as unknown as Gtk.Window | null;
        if (!win) continue;
        out.push({
            path: `toplevel:${i}`,
            type: widgetType(win),
            title: win.get_title?.() ?? null,
            mapped: win.get_mapped(),
            focused: win.is_active ?? false,
        });
    }
    return out;
}

/** Resolve a widget path to its live widget, or null if it no longer exists. */
export function resolveWidgetPath(path: string): Gtk.Widget | null {
    const parsed = parseWidgetPath(path);
    if (!parsed) return null;
    const model = Gtk.Window.get_toplevels();
    let node = model.get_item(parsed.toplevel) as unknown as Gtk.Widget | null;
    if (!node) return null;
    for (const idx of parsed.children) {
        node = nthChild(node, idx);
        if (!node) return null;
    }
    return node;
}

/**
 * A widget selector: `Type`, `:css-class`, or `Type:css-class`.
 *
 * Widget PATHS are positional (`toplevel:0/child:0/child:3/…`), which is what makes them stable to
 * pass around and useless to write down: inserting one widget above the target renames every path
 * below it. So a script that wants to press "the suggested-action button on the error page" had to
 * dump the whole tree and walk the JSON itself — which is exactly the walk this module already
 * does, reimplemented once per caller in whatever language the caller happens to be.
 */
export interface WidgetSelector {
    /** GType name, e.g. `GtkButton`. Empty matches any type. */
    type: string;
    /** CSS class the widget must carry, e.g. `suggested-action`. Empty matches any. */
    cssClass: string;
}

/** Parse `Type`, `Type:css-class` or `:css-class`. Returns null when both halves are empty. */
export function parseWidgetSelector(selector: string): WidgetSelector | null {
    const idx = selector.indexOf(':');
    const type = (idx < 0 ? selector : selector.slice(0, idx)).trim();
    const cssClass = (idx < 0 ? '' : selector.slice(idx + 1)).trim();
    if (!type && !cssClass) return null;
    return { type, cssClass };
}

/**
 * Find the first widget matching `selector`, depth-first, and return its path — `null` if none.
 *
 * Depth-first means the first hit is the topmost one in reading order, which is what a person
 * describing "the button" means.
 *
 * Invisible and unmapped widgets are SKIPPED, subtree and all. A GTK tree is full of widgets that
 * exist but are not on screen — the other pages of a stack, a hidden row, the collapsed half of a
 * split view — and activating one of those proves nothing about what a user can reach. Skipping the
 * subtree as well as the node matters: the children of an unmapped stack page are unmapped too, but
 * a caller checking only the leaf would happily match one.
 */
export function findWidgetPath(root: Gtk.Widget, selector: WidgetSelector, basePath: string): string | null {
    if (!root.get_visible() || !root.get_mapped()) return null;
    const typeOk = !selector.type || widgetType(root) === selector.type;
    const classOk = !selector.cssClass || root.get_css_classes().includes(selector.cssClass);
    if (typeOk && classOk) return basePath;
    let child = root.get_first_child();
    let i = 0;
    while (child) {
        const hit = findWidgetPath(child, selector, `${basePath}/child:${i}`);
        if (hit) return hit;
        child = child.get_next_sibling();
        i++;
    }
    return null;
}

/**
 * How deep `DumpTree` walks when the caller names no depth.
 *
 * 8 was the first guess and it was measured short: an ordinary Adwaita window
 * puts an `AdwToolbarView` at level 7 and its `AdwHeaderBar` below that, so the
 * default answered zero header bars for a window that drew one (#1553). 40 is
 * chosen to clear a real application tree with room, not to be unbounded — the
 * dump crosses D-Bus, and `truncated` is what makes the remaining bound honest
 * rather than invisible.
 */
export const DEFAULT_DUMP_DEPTH = 40;

/**
 * What a mapped widget was given, beside what it asked for.
 *
 * MAPPED ONLY, and that is the whole guard: an unmapped widget has no allocation, so it
 * reports zero and a measurement describes what it would want somewhere it is not. Two
 * zeros beside a request would read as "clipped to nothing" for every page of a stack
 * that is not the visible one.
 *
 * ## FOUR BOXES BEHIND FOUR ACCESSORS, and getting this wrong is the whole difficulty
 *
 * Measured on GTK 4.22.4 with one `Gtk.Label` over a content box of 306x18, under each of
 * the four things that can sit around it: CSS `padding: 3px 5px`, CSS `border: 2px solid`,
 * CSS `margin: 4px 7px`, and the `margin-start`/`-end`/`-top`/`-bottom` WIDGET PROPERTIES
 * at that same 7px/4px.
 *
 * | | none | padding | border | CSS margin | widget margin | all four |
 * |---|---|---|---|---|---|---|
 * | `get_width()`/`get_height()` | 306x18 | 306x18 | 306x18 | 306x18 | 306x18 | 306x18 |
 * | `compute_bounds(self)` | 306x18 | 316x24 | 310x22 | 306x18 | 306x18 | 320x28 |
 * | `get_allocation()` | 306x18 | 316x24 | 310x22 | 320x26 | 306x18 | 334x36 |
 * | + the four `get_margin_*()` | 306x18 | 316x24 | 310x22 | 320x26 | 320x26 | 348x44 |
 * | `measure()` natural | 306x18 | 316x24 | 310x22 | 320x26 | 320x26 | 348x44 |
 *
 * So `get_width()` answers the CONTENT box, `compute_bounds()` the BORDER box,
 * `get_allocation()` the CSS MARGIN box, and `measure()` speaks the box outside all of
 * them: CSS margin AND the widget's own margin properties. Only the fourth row tracks the
 * fifth in every column, so that sum is the one allocation worth holding a request
 * against; any other pairing subtracts two different questions from each other.
 *
 * The error is not a rounding one. The padded label measured for height at its
 * `get_width()` of 306 answers 42 where the same question in the right box (316) answers
 * 24, because 306 read as a margin-box width leaves 296 for the text and wraps it.
 *
 * Two earlier versions each compared against the wrong rectangle, and each called
 * correctly-sized widgets clipped:
 *
 *  - against `get_width()`, the content box: 116 of 293 widgets in a real window.
 *  - against `compute_bounds()` plus the four margin PROPERTIES: 12 of 127 mapped widgets
 *    in an ordinary Adwaita preferences window, 11 of them false. Its comment claimed
 *    that sum "is `get_allocation()`'s rectangle without calling a function GTK 4.12
 *    deprecated", and the CSS-margin column above is why it is not — `get_margin_start()`
 *    answers the PROPERTY and knows nothing about a stylesheet, while Adwaita's own
 *    stylesheet puts margins on boxes.
 *
 * `gtk_widget_get_allocation()` IS deprecated (4.12), and its notice points at
 * `compute_bounds()`/`get_width()`, the two rectangles this must not use. It is the only
 * public reader of the CSS margin rect, so the deprecation is taken deliberately: a
 * deprecated call that is right is worth more than a current one that is quietly wrong.
 *
 * ## Why the height is measured at the allocated width
 *
 * Because that is the question. A wrapping label asked for its height at its natural
 * width answers one line, and at the width it actually got answers two. The two agree
 * except where a parent measured one and allocated the other, which is the defect.
 *
 * ## Why that width is then clamped to the minimum
 *
 * `gtk_widget_measure()` WARNS on a `for_size` below the widget's minimum in the other
 * orientation — `Trying to measure GtkBox … for width of 34, but it needs at least 40` —
 * and then clamps to that minimum and answers anyway. Clamping first therefore changes no
 * number (measured: every `for_size` from 0 up to the minimum returns the minimum's
 * answer) and keeps a dump of a window that HAS a clipped widget from printing one GTK
 * warning per clipped widget per dump. An instrument that reports a defect by making the
 * toolkit complain cannot be told, in a log, from the defect complaining on its own.
 *
 * Two `gtk_widget_measure()` calls per mapped node. GTK caches a size request per
 * (orientation, for_size) — measured with a counting `vfunc_measure`: repeated calls at
 * one `for_size` reach the widget once, and twenty distinct sizes did not evict an earlier
 * entry — and the pair asked for here is the pair the layout just asked for itself, so
 * this reads that cache rather than provoking a re-layout. That is only true in the right
 * box: the border-box width missed the cache on every CSS-margined widget, because the
 * layout had asked at the margin-box width.
 */
function geometryOf(widget: Gtk.Widget): NodeGeometry | undefined {
    if (!widget.get_mapped()) return undefined;
    const allocation = widget.get_allocation();
    const width = allocation.width + widget.get_margin_start() + widget.get_margin_end();
    const height = allocation.height + widget.get_margin_top() + widget.get_margin_bottom();
    const [minWidth, natWidth] = widget.measure(Gtk.Orientation.HORIZONTAL, -1);
    // `-1` when there is no allocation to speak of: `measure(VERTICAL, 0)` is a legal
    // call that answers about a zero-width widget, which is a constraint rather than the
    // absence of one.
    const forWidth = width > 0 ? Math.max(width, minWidth) : -1;
    const [minHeight, natHeight] = widget.measure(Gtk.Orientation.VERTICAL, forWidth);
    const geometry: NodeGeometry = {
        width,
        height,
        widthRequest: [minWidth, natWidth],
        heightRequest: [minHeight, natHeight],
    };
    if (width < minWidth || height < minHeight) geometry.short = true;
    return geometry;
}

/**
 * Dump a widget subtree to {@link NodeInfo}, bounded by `maxDepth`.
 *
 * The bound LEAVES A TRACE, and that is the half worth stating: a node cut off
 * here carries `truncated: true`, so a caller reading zero children knows which
 * of the two zeros it got (#1553). A bound itself is right — an unbounded dump of
 * a deep tree over D-Bus is not free — and it is only expensive when it is
 * invisible in the answer.
 *
 * Every mapped node also carries {@link NodeGeometry}: what it was allocated and what
 * it asked for, with `short: true` where the first is less than the second. That is
 * unconditional rather than a flag, and the reason is that the caller who needs it does
 * not yet know which widget to ask about — sweeping the dump for `short` finds the
 * clipped widget, and a flag would have to be turned on by someone who already
 * suspected one.
 */
export function dumpTree(root: Gtk.Widget, maxDepth: number, basePath: string): NodeInfo {
    const node: NodeInfo = {
        path: basePath,
        type: widgetType(root),
        name: root.get_name() || null,
        cssClasses: root.get_css_classes(),
        mapped: root.get_mapped(),
        visible: root.get_visible(),
        children: [],
    };
    const geometry = geometryOf(root);
    if (geometry !== undefined) node.geometry = geometry;
    if (maxDepth <= 0) {
        // `get_first_child()` rather than a count: one call answers "is there more
        // below this", and the marker must mean HAS CHILDREN — a leaf reached
        // exactly at the bound is a complete answer and must not be flagged as a
        // partial one.
        if (root.get_first_child()) node.truncated = true;
        return node;
    }
    let child = root.get_first_child();
    let i = 0;
    while (child) {
        node.children.push(dumpTree(child, maxDepth - 1, `${basePath}/child:${i}`));
        child = child.get_next_sibling();
        i++;
    }
    return node;
}

/** Coerce a marshalled GObject value to a JSON-safe representation. */
function jsonSafe(value: unknown): unknown {
    const t = typeof value;
    if (value === null || value === undefined || t === 'string' || t === 'number' || t === 'boolean') {
        return value ?? null;
    }
    return `[${t}]`;
}

/**
 * Read a GObject property by name, trying the original, snake_case and
 * camelCase accessor forms GJS exposes. Returns a JSON-safe value (non-scalars
 * become a `[type]` marker).
 */
export function getWidgetProperty(widget: Gtk.Widget, prop: string): unknown {
    const obj = widget as unknown as Record<string, unknown>;
    const snake = prop.replace(/-/g, '_');
    const camel = prop.replace(/[-_]([a-z])/g, (_, c: string) => c.toUpperCase());
    for (const key of [prop, snake, camel]) {
        if (key in obj) return jsonSafe(obj[key]);
    }
    return undefined;
}

function childIndex(parent: Gtk.Widget, child: Gtk.Widget): number {
    let c = parent.get_first_child();
    let i = 0;
    while (c) {
        if (c === child) return i;
        c = c.get_next_sibling();
        i++;
    }
    return -1;
}

/** Compute the stable path of a live widget by walking up to its toplevel. */
export function pathOfWidget(widget: Gtk.Widget): string | null {
    const chain: number[] = [];
    let node: Gtk.Widget = widget;
    let parent = node.get_parent();
    while (parent) {
        const idx = childIndex(parent, node);
        if (idx < 0) return null;
        chain.unshift(idx);
        node = parent;
        parent = node.get_parent();
    }
    const model = Gtk.Window.get_toplevels();
    const count = model.get_n_items();
    for (let i = 0; i < count; i++) {
        if ((model.get_item(i) as unknown as Gtk.Widget) === node) {
            return buildWidgetPath(i, chain);
        }
    }
    return null;
}
