// What a menu's items read from the action registry, and how an item fires one (ADR 0097 § 3).
//
// `AdwMenuActions` is the portable stand-in for a `GActionGroup`; this fills it from the REAL
// resolution of ADR 0098 (`findActionGroup`) instead of waiting for the application to write it by
// hand, so a popover and a `PopupMenu` ask the same question a `Gtk.Actionable` does.

import { activateWidgetAction, findActionGroup } from './gio-actions.js';
import { parseDetailedAction } from './menu.js';
import type { AdwMenuAction, AdwMenuActions, AdwMenuModel, AdwMenuItem } from './menu.js';

type Parent = (node: object) => object | null | undefined;

/**
 * The actions the model's items name, as `widget` resolves them. An action the walk does not find,
 * because no group has its prefix or the group lacks it, is left out, which is "missing" and makes
 * the item insensitive. That is GTK's answer, measured on GJS (`menu-actions.gjs.spec.ts`), and it
 * overrules ADR 0097 § 3's "no group dims nothing": an application that dispatches an action
 * itself declares it, or passes `actions` to say what it knows.
 */
export function menuActionsFor(model: AdwMenuModel, widget: object, parent: Parent): AdwMenuActions {
    const actions: Record<string, AdwMenuAction> = {};
    const visit = (nodes: AdwMenuModel): void => {
        for (const node of nodes) {
            if (node.kind !== 'item') {
                visit(node.items);
                continue;
            }
            const name = parseDetailedAction(node.action)?.name;
            if (name === undefined || name in actions) continue;
            const dot = name.indexOf('.');
            const group = dot > 0 ? findActionGroup(widget, name.slice(0, dot), parent) : null;
            if (group === null) continue;
            const action = group.lookup_action(name.slice(dot + 1));
            if (action !== null) actions[name] = { enabled: action.enabled };
        }
    };
    visit(model);
    return actions;
}

/**
 * Fire the action an item names, the way `GtkMenuTrackerItem` does on activation. A target is
 * passed as its text: `GLib.Variant` is outside the subset until stage 3.
 */
export function activateMenuItem(item: AdwMenuItem, widget: object, parent: Parent): boolean {
    const detailed = parseDetailedAction(item.action);
    if (detailed === null) return false;
    return activateWidgetAction(widget, detailed.name, parent, detailed.target ?? null);
}
