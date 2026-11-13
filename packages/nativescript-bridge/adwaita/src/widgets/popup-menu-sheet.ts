// A recording `PopupMenuLike` that keeps the menu as a tree, for a platform whose menu is not
// built call by call (iOS: an action sheet is assembled once, from the finished tree).
//
// Free of `@nativescript/core` and UIKit so the spec suite can exercise the real code.

import type { PopupMenuItemLike, PopupMenuLike } from './popup-menu.js';

export interface SheetEntry {
    readonly itemId: number;
    readonly title: string;
    readonly group: number;
    enabled: boolean;
    checkable: boolean;
    checked: boolean;
    /** Present on a submenu row; a row with children activates nothing itself. */
    readonly children?: SheetMenu;
}

export class SheetMenu implements PopupMenuLike {
    readonly entries: SheetEntry[] = [];

    add(group: number, itemId: number, _order: number, title: string): PopupMenuItemLike {
        const entry: SheetEntry = { itemId, title, group, enabled: true, checkable: false, checked: false };
        this.entries.push(entry);
        return {
            setEnabled: (enabled) => void (entry.enabled = enabled),
            setCheckable: (checkable) => void (entry.checkable = checkable),
            setChecked: (checked) => void (entry.checked = checked),
        };
    }

    addSubMenu(group: number, itemId: number, _order: number, title: string): PopupMenuLike {
        const children = new SheetMenu();
        this.entries.push({ itemId, title, group, enabled: true, checkable: false, checked: false, children });
        return children;
    }

    // Radio exclusivity needs no bookkeeping here: the plan checks exactly one radio per group.
    setGroupCheckable(): void {}
}

/** What a row says on a sheet that has no check column: the state is part of the title. */
export function sheetTitle(entry: SheetEntry): string {
    if (entry.children !== undefined) return `${entry.title} ›`;
    return entry.checked ? `✓ ${entry.title}` : entry.title;
}
