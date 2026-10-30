// The `Gtk.Widget` members a registered class reaches for on `this`: direction, visibility, the sibling links of
// the widget tree and `insert_action_group`. `gobject-door.ts` puts them on the prototype of every
// registered class, next to `get_display()` / `get_clipboard()` (gdk.ts); a class's own member wins.
//
// A registered class is a custom element, so its tree is the element tree: the children a template
// builds are its first and last child, and the parent is the parent element.
//
// Reference: GTK gtk/gtkwidget.c (gtk_widget_set_direction, gtk_widget_get_first_child,
// gtk_widget_insert_action_group)
// Copyright (c) GNOME contributors (GTK). LGPLv2.1+.

import { Point, computePoint, type PointNode } from './graphene.js';
import { insertActionGroup, type ActionGroupLike } from './gio-actions.js';

/** `Gtk.TextDirection`: NONE, LTR, RTL. */
const DIRECTIONS = [0, 1, 2];

/** The slice of a DOM element these members read; core has no DOM lib. */
interface WidgetNode extends PointNode {
    dir: string;
    readonly isConnected: boolean;
    readonly offsetWidth: number;
    readonly offsetHeight: number;
    removeAttribute(name: string): void;
    hasAttribute(name: string): boolean;
    toggleAttribute(name: string, force?: boolean): boolean;
    readonly localName: string;
    readonly firstElementChild: LinkedNode | null;
    readonly lastElementChild: LinkedNode | null;
    readonly nextElementSibling: LinkedNode | null;
    readonly previousElementSibling: LinkedNode | null;
    readonly parentElement: LinkedNode | null;
    readonly classList: { add(name: string): void; remove(name: string): void; contains(name: string): boolean };
}

/**
 * What the tree walkers need of a node they STEP OVER: its name, and the link to the next
 * candidate. A `<span>` a label built answers both and is no `WidgetNode` — the whole point.
 */
interface LinkedNode {
    readonly localName: string;
    readonly firstElementChild: LinkedNode | null;
    readonly lastElementChild: LinkedNode | null;
    readonly nextElementSibling: LinkedNode | null;
    readonly previousElementSibling: LinkedNode | null;
    readonly parentElement: LinkedNode | null;
}

const DIRECTION = new WeakMap<object, number>();

/**
 * Is this element a WIDGET, or a piece of a widget's own insides?
 *
 * `gtk_widget_get_first_child` walks the WIDGET tree — every node it hands back is a
 * `GtkWidget`, including the template children of a composite one. A DOM port has a second
 * kind of child in the same `children` list: the `<span>` a label's markup renderer builds,
 * the `<div>` a row lays its slots out in. Those are not widgets in any renderer, and a
 * caller that got one back found `instanceof Gtk.Label` false and, one step further, no
 * `get_first_child` on it at all — a `TypeError` thrown in the consumer's walk, far from
 * the port that produced the node. (Measured in Learn6502: a depth-first walk over the
 * rendered tutorial hit the spans inside a label and died.)
 *
 * The test is the one the DOM itself guarantees: a custom element name MUST contain a
 * hyphen and a built-in one may not, so `localName.includes('-')` separates the two kinds
 * exactly. `compute-expand.ts` reads the same signal for the same reason.
 *
 * Reference: GTK gtk/gtkwidget.c (gtk_widget_get_first_child — `priv->first_child`, a
 * GtkWidget), WHATWG HTML § custom element name (the hyphen requirement).
 */
export function isWidgetNode(node: { readonly localName: string } | null | undefined): boolean {
    return node != null && node.localName.includes('-');
}

/** The first of `node` and its following siblings that is a widget, skipping a port's own DOM. */
function widgetSibling(node: LinkedNode | null, next: (from: LinkedNode) => LinkedNode | null): LinkedNode | null {
    for (let at = node; at !== null; at = next(at)) if (isWidgetNode(at)) return at;
    return null;
}

/**
 * Mirrors the held direction onto the `dir` attribute. A custom element may not take an attribute
 * while `createElement` constructs it, and a widget's constructor is where GTK code pins its
 * direction, so a widget that is not connected yet only holds it; the door calls this on connect.
 */
export function syncDirection(node: WidgetNode): void {
    const direction = DIRECTION.get(node);
    if (direction === undefined || !node.isConnected) return;
    if (direction === 0) node.removeAttribute('dir');
    else node.dir = direction === 2 ? 'rtl' : 'ltr';
}

/** The members of `Gtk.Widget` that a registered class gets from the port. */
export function widgetTreeMembers(): Record<string, (this: WidgetNode, ...args: never[]) => unknown> {
    return {
        /** `gtk_widget_set_direction`: held, and mirrored onto `dir` for LTR and RTL. */
        set_direction(this: WidgetNode, direction: number) {
            if (!DIRECTIONS.includes(direction)) {
                throw new TypeError(`${direction} is not a valid value for enum argument dir`);
            }
            DIRECTION.set(this, direction);
            syncDirection(this);
        },
        /** `gtk_widget_get_direction`: LTR until set. */
        get_direction(this: WidgetNode) {
            return DIRECTION.get(this) ?? 1;
        },
        /** `gtk_widget_get_visible`: TRUE until hidden, which is the DOM's `hidden`. */
        get_visible(this: WidgetNode) {
            return !this.hasAttribute('hidden');
        },
        /** `gtk_widget_set_visible`. */
        set_visible(this: WidgetNode, visible: boolean) {
            this.toggleAttribute('hidden', !visible);
        },
        /** `gtk_widget_get_first_child`: the first child WIDGET — see {@link isWidgetNode}. */
        get_first_child(this: WidgetNode) {
            return widgetSibling(this.firstElementChild, (at) => at.nextElementSibling);
        },
        /** `gtk_widget_get_last_child`. */
        get_last_child(this: WidgetNode) {
            return widgetSibling(this.lastElementChild, (at) => at.previousElementSibling);
        },
        /** `gtk_widget_get_next_sibling`. */
        get_next_sibling(this: WidgetNode) {
            return widgetSibling(this.nextElementSibling, (at) => at.nextElementSibling);
        },
        /** `gtk_widget_get_prev_sibling`. */
        get_prev_sibling(this: WidgetNode) {
            return widgetSibling(this.previousElementSibling, (at) => at.previousElementSibling);
        },
        /** `gtk_widget_get_parent`: the nearest ancestor that is a widget, not a port's own wrapper. */
        get_parent(this: WidgetNode) {
            return widgetSibling(this.parentElement, (at) => at.parentElement);
        },
        /** `gtk_widget_get_width`: the layout box in CSS px; 0 until the widget is rendered. */
        get_width(this: WidgetNode) {
            return this.offsetWidth;
        },
        /** `gtk_widget_get_height`: the layout box in CSS px; 0 until the widget is rendered. */
        get_height(this: WidgetNode) {
            return this.offsetHeight;
        },
        /** `gtk_widget_compute_point`: `[false, (0, 0)]` when the two share no tree. */
        compute_point(this: WidgetNode, target: PointNode, point: Point) {
            return computePoint(this, target, point);
        },
        /** `gtk_widget_add_css_class`: the CSS class is a DOM class. */
        add_css_class(this: WidgetNode, css_class: string) {
            this.classList.add(css_class);
        },
        /** `gtk_widget_remove_css_class`. */
        remove_css_class(this: WidgetNode, css_class: string) {
            this.classList.remove(css_class);
        },
        /** `gtk_widget_has_css_class`. */
        has_css_class(this: WidgetNode, css_class: string) {
            return this.classList.contains(css_class);
        },
        /** `gtk_widget_insert_action_group`: `null` removes the group of `name`. */
        insert_action_group(this: WidgetNode, name: string, group: ActionGroupLike | null) {
            insertActionGroup(this, name, group);
        },
    };
}
