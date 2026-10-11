// The `Gtk.Widget` members a registered class reaches for on `this`: direction, the sibling links of
// the widget tree and `insert_action_group`. `gobject-door.ts` puts them on the prototype of every
// registered class, next to `get_display()` / `get_clipboard()` (gdk.ts); a class's own member wins.
//
// A registered class is a custom element, so its tree is the element tree: the children a template
// builds are its first and last child, and the parent is the parent element.
//
// Reference: GTK gtk/gtkwidget.c (gtk_widget_set_direction, gtk_widget_get_first_child,
// gtk_widget_insert_action_group)
// Copyright (c) GNOME contributors (GTK). LGPLv2.1+.

import { insertActionGroup, type ActionGroupLike } from './gio-actions.js';

/** `Gtk.TextDirection`: NONE, LTR, RTL. */
const DIRECTIONS = [0, 1, 2];

/** The slice of a DOM element these members read; core has no DOM lib. */
interface WidgetNode {
    dir: string;
    readonly isConnected: boolean;
    removeAttribute(name: string): void;
    readonly firstElementChild: unknown;
    readonly lastElementChild: unknown;
    readonly nextElementSibling: unknown;
    readonly previousElementSibling: unknown;
    readonly parentElement: unknown;
}

const DIRECTION = new WeakMap<object, number>();

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
        get_first_child(this: WidgetNode) {
            return this.firstElementChild;
        },
        get_last_child(this: WidgetNode) {
            return this.lastElementChild;
        },
        get_next_sibling(this: WidgetNode) {
            return this.nextElementSibling;
        },
        get_prev_sibling(this: WidgetNode) {
            return this.previousElementSibling;
        },
        get_parent(this: WidgetNode) {
            return this.parentElement;
        },
        /** `gtk_widget_insert_action_group`: `null` removes the group of `name`. */
        insert_action_group(this: WidgetNode, name: string, group: ActionGroupLike | null) {
            insertActionGroup(this, name, group);
        },
    };
}
