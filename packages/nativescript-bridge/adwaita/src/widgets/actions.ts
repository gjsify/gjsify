// A minimal `GAction` registry — the half of `Gio.ActionGroup` a `.blp` button needs.
//
// A Blueprint writes `action-name: "source-view.copy"` and the widget class answers it with
// `new Gio.SimpleAction({ name: 'copy' })` in an action group inserted under `source-view`.
// Until this file existed the port only HELD the name (`GtkButton.actionName`), so every
// app wired the click to `clicked` itself and the shared class could not run on both sides.
//
// WHAT IS HERE: `SimpleAction` (name, enabled, `activate` signal), `SimpleActionGroup`
// (add/lookup/remove/activate), `insertActionGroup` (`gtk_widget_insert_action_group`) and
// `activateWidgetAction` (what a button does on click: walk the parent chain, find the
// group registered under the name's prefix, activate the action).
//
// THE ACTION MODEL IS THE CORE'S (`@gjsify/adwaita-core`, ADR 0098): `SimpleAction` and the walk
// that resolves `prefix.name` are shared with the web port, and the walk reads `View.parent`
// here. It also finds `win.` (the ActionMap of a window) and `app.` (the application a window
// was added to), which this file's own walk could not.
//
// WHAT IS NOT: parameter types, state, `Gio.Menu` targets, accelerators. An action with a
// `parameter-type` is activated with whatever the caller passes; nothing checks it.
// `enabled = false` is honoured, because GTK greys a button out for it and the click must not
// reach the handler either.
//
// NS-CORE-FREE ON PURPOSE: the parent chain is read through the structural `ActionHost`
// (`@nativescript/core`'s `View.parent`), so a pure spec drives all of it off a device.
//
// Reference: refs/gtk gtk/gtkactionable.c, gtk/gtkwidget.c (gtk_widget_insert_action_group)
// Reference: GLib gio/gsimpleaction.c, gio/gsimpleactiongroup.c

import {
    activateMenuItem as activateMenuItemIn,
    activateWidgetAction as activateIn,
    menuActionsFor,
    findActionGroup as findIn,
    insertActionGroup as insertIn,
    type ActionGroupLike,
    type AdwMenuActions,
    type AdwMenuItem,
    type AdwMenuModel,
    type SimpleAction,
} from '@gjsify/adwaita-core';

export { SimpleAction, SimpleActionGroup } from '@gjsify/adwaita-core';
export type { ActionActivateHandler, SimpleActionProps } from '@gjsify/adwaita-core';

/** What the chain walk needs of a view: `View.parent`, nothing else. */
export interface ActionHost {
    parent?: ActionHost | null;
}

const parentOf = (node: object): object | null | undefined => (node as ActionHost).parent;

/**
 * `gtk_widget_insert_action_group`: make `group`'s actions resolvable as `prefix.name` from
 * `widget` and everything below it. `null` removes the group again.
 */
export function insertActionGroup(widget: ActionHost, prefix: string, group: ActionGroupLike | null): void {
    insertIn(widget, prefix, group);
}

/** `gtk_widget_get_action_group`-style lookup, nearest ancestor first. */
export function findActionGroup(widget: ActionHost, prefix: string): ActionGroupLike | null {
    return findIn(widget, prefix, parentOf);
}

/**
 * What a `Gtk.Actionable` does when it fires: split `prefix.name`, find the group on the
 * widget or its nearest ancestor, activate. Returns whether an enabled action ran, so a
 * caller can tell a wired button from a dangling name (GTK only warns about the latter).
 */
export function activateWidgetAction(widget: ActionHost, fullName: string, parameter: unknown = null): boolean {
    return activateIn(widget, fullName, parentOf, parameter);
}

/** What the items of `model` read from the actions registered at or above `widget` (ADR 0097 § 3). */
export function menuActionsOfView(widget: ActionHost, model: AdwMenuModel): AdwMenuActions {
    return menuActionsFor(model, widget, parentOf);
}

/** What choosing `item` in a menu owned by `widget` does: the action it names fires, as GTK's tracker does. */
export function activateViewMenuItem(widget: ActionHost, item: AdwMenuItem): boolean {
    return activateMenuItemIn(item, widget, parentOf);
}
