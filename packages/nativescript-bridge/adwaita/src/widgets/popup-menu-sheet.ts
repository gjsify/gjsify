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

export interface SheetSessionEvents {
    /** The tapped leaf's id; the answer is not needed on a sheet (nothing falls through to a parent). */
    click(itemId: number): void;
    /** Fires exactly once per opened session, whichever way the last sheet went away. */
    dismissed(): void;
}

/**
 * The open/closed state of one menu on a sheet surface. UIKit tells the driver about a sheet going
 * away through four unrelated doors (an action handler, the cancel row, a tap outside / the iPad
 * popover, our own `dismiss()`), and a submenu is a SECOND sheet presented after the first one is
 * gone. A driver that holds its own flag per door loses one of them, and a lost dismissal leaves
 * the owning button believing the menu is still open for good. So every door funnels into `end()`,
 * which is idempotent, and a late callback of a sheet that was already replaced is ignored.
 */
export class SheetSession {
    #current: SheetMenu | null = null;
    #depth = 0;

    constructor(private readonly events: SheetSessionEvents) {}

    get isOpen(): boolean {
        return this.#current !== null;
    }

    /** How many sheets deep the session is: 0 closed, 1 the root, 2 its submenu, … */
    get depth(): number {
        return this.#depth;
    }

    /** Start a session on `root`; `false` while one is already open (the sheet is not stacked twice). */
    open(root: SheetMenu): boolean {
        if (this.#current !== null) return false;
        this.#current = root;
        this.#depth = 1;
        return true;
    }

    /**
     * A row was tapped (UIKit has already taken its sheet down). A submenu row answers the level to
     * present next; a leaf reports its click and ends the session, answering `null`.
     */
    choose(entry: SheetEntry): SheetMenu | null {
        if (this.#current === null) return null;
        if (entry.children !== undefined) {
            this.#current = entry.children;
            this.#depth++;
            return entry.children;
        }
        try {
            this.events.click(entry.itemId);
        } finally {
            this.end();
        }
        return null;
    }

    /** The cancel row, on any level. */
    cancel(): void {
        this.end();
    }

    /**
     * UIKit took `level` down on its own (tap outside, iPad popover). A level that is no longer
     * the current one was replaced by its submenu; its late callback must not close the session.
     */
    uikitDismissed(level: SheetMenu): void {
        if (level === this.#current) this.end();
    }

    /** The driver's own `dismiss()`. */
    close(): void {
        this.end();
    }

    private end(): void {
        if (this.#current === null) return;
        this.#current = null;
        this.#depth = 0;
        this.events.dismissed();
    }
}
