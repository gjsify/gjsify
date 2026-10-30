// A portable menu shown at a view: the one function `GtkMenuButton`, `AdwSplitButton` and
// `GtkPopoverMenu` open theirs through (ADR 0097 § 2).
//
// It joins the three halves: the action state the menu reads and the action a tap fires come from
// the registry of ADR 0098 (`./actions.ts`), the plan from the core, the platform from
// `./popup-menu-surface.js`. NS-core-free, so a spec drives it with a recording surface.

import { menuItemAt } from '@gjsify/adwaita-core';
import type { AdwMenuActions, AdwMenuItem, AdwMenuPath, AdwMenuTree } from '@gjsify/adwaita-core';

import { activateViewMenuItem, menuActionsOfView, type ActionHost } from './actions.js';
import { openPopupMenu, type PopupMenuSurface } from './popup-menu.js';
import { createPopupMenuSurface } from './popup-menu-surface.js';

export interface MenuPopupOptions {
    /** The SNAPSHOT of the menu model, as `MenuSlot.tree` holds it (ADR 0128 § 3). */
    readonly tree: AdwMenuTree;
    /** What the application wrote itself; absent, the registry above `anchor` answers. */
    readonly actions?: AdwMenuActions | null;
    /** A leaf item was chosen, after its action fired. */
    readonly onActivated?: (item: AdwMenuItem, path: AdwMenuPath) => void;
    /** The popup went away, after a choice or without one. */
    readonly onDismiss?: () => void;
}

/** What {@link showMenuPopup} hands back. */
export interface MenuPopupHandle {
    dismiss(): void;
}

let override: ((anchor: object) => PopupMenuSurface) | null = null;

/** Replace the platform surface, so a spec can show a menu without a device. Pass `null` to restore it. */
export function setPopupMenuSurfaceForTesting(factory: ((anchor: object) => PopupMenuSurface) | null): void {
    override = factory;
}

export function showMenuPopup(anchor: ActionHost, options: MenuPopupOptions): MenuPopupHandle {
    const surface = (override ?? createPopupMenuSurface)(anchor);
    openPopupMenu({
        surface,
        tree: options.tree,
        actions: options.actions ?? menuActionsOfView(anchor, options.tree),
        activate(path) {
            const item = menuItemAt(options.tree, path);
            if (item === null) return;
            activateViewMenuItem(anchor, item);
            options.onActivated?.(item, path);
        },
        onDismiss: options.onDismiss,
    });
    return { dismiss: () => surface.dismiss() };
}
