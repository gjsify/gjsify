// The `menuModel` SLOT the menu-bearing widgets of this package share.
//
// ADR 0128 made `menu-model` a real `Gio.MenuModel`, and that turned one assignment into
// four steps that only work in one order:
//
//   1. read the write — `readMenuModelWrite` is the core's one door, and it tells a real
//      model from everything that is not one (ADR 0128 § 4);
//   2. REFUSE what a `PopupMenu` cannot draw, at the assignment and by name;
//   3. take a TREE SNAPSHOT, because `planPopupMenu` and every walker take an
//      `AdwMenuTree` and not a model — one snapshot per change rather than a chain of
//      `get_item_link` calls per row;
//   4. connect `items-changed` — on the root AND on every section and submenu it links,
//      which is what `watchMenuModel` does, because a link's emission does NOT bubble.
//
// THIS IS A COPY OF `@gjsify/adwaita-web`'s `elements/menu-slot.ts` AND NOT A SHARED ONE,
// because the two doors are not the same door. The browser takes a JSON STRING, since an
// authored `menu-model="[…]"` attribute is text by the time it reaches an element; this port
// REFUSES one, because NativeScript's XML Builder writes an attribute straight onto the
// property and ADR 0042 kept that door shut rather than open an XML seam no probe can prove
// (`refuseMenuString`, and the long note on `AdwSplitButton.menuModel` for why a shut door
// that is silent would be worse). A slot in the core would have to take both, which is
// exactly the surface neither renderer wants.
//
// WHAT THE WATCHER BUYS HERE. A `PopupMenu` is the platform's own window, built from the
// tree when it opens, so a mutation between two taps is picked up whether or not anything
// listens. What listening adds is the step a tap does NOT do: re-snapshotting, so
// {@link MenuSlot.isEmpty} — the answer to "is the dropdown live" — stops being the count
// the menu had when it was assigned. A popup ALREADY SHOWING is not rebuilt, and that is a
// platform limit rather than a choice: `android.widget.PopupMenu` has no path back to its
// `Menu` once `show()` ran, where GTK rebuilds the popover in place.
//
// THE WATCHER'S LIFETIME IS THE WIDGET'S. GTK disconnects in `dispose`; a NativeScript view
// is collected with the model it holds, and a held model keeping its widget alive is the
// same shape GTK has, where the widget owns a reference to the model it reads.

import { GjsifyMenu, menuTree, readMenuModelWrite, watchMenuModel } from '@gjsify/adwaita-core';
import type { AdwMenuTree, GioMenuModel } from '@gjsify/adwaita-core';

import { assertPopupMenuAssignable, refuseMenuString } from './popup-menu.js';

export class MenuSlot {
    private readonly _authored = new GjsifyMenu();
    private _model: GioMenuModel | null = null;
    private _tree: AdwMenuTree = [];
    private _unwatch: (() => void) | null = null;

    /**
     * @param widget the class name {@link refuseMenuString} names in its refusal.
     * @param onItemsChanged what to do when the HELD menu mutates under the widget.
     */
    constructor(
        private readonly widget: string,
        private readonly onItemsChanged: () => void,
    ) {}

    /** The model itself, by identity — what `menuModel` answers. */
    get model(): GioMenuModel | null {
        return this._model;
    }

    /** The snapshot `planPopupMenu` reads. Re-taken on each `items-changed`, never aliased. */
    get tree(): AdwMenuTree {
        return this._tree;
    }

    /**
     * Whether there is anything to show — NOT whether there is a menu.
     *
     * `null` and an empty `Gio.Menu` are different menus, and on GTK they behave
     * differently: an empty non-null model still builds a `GtkPopoverMenu` (measured,
     * `MENU_MODEL_DOOR_VECTORS`). A `PopupMenu` with no items draws no window at all, so
     * this is the question the TAP asks, and the widgets ask `model === null` where GTK asks
     * about the model.
     */
    get isEmpty(): boolean {
        return this._tree.length === 0;
    }

    /**
     * A property write: a real model by identity, `null` for no menu — and a `TypeError` for
     * a string, an array or anything else, which this door does not take (`buildMenu` is how
     * an array becomes a model now).
     *
     * The refusal is a THROW because a property assignment is a call: whoever wrote the
     * menu is on the stack and can hear it. There is no second, quieter door here the way
     * the browser has one for markup.
     */
    write(value: unknown): void {
        refuseMenuString(value, this.widget);
        const next = readMenuModelWrite(value, this._authored);
        // LOUD, at the assignment: a `custom` item names an application widget, which a
        // PopupMenu row cannot host — a surface that ignored it would offer a blank row.
        if (next !== null) assertPopupMenuAssignable(menuTree(next));
        this._adopt(next);
    }

    /** Hold `next`, snapshot it, and listen to it — the three that always happen together. */
    private _adopt(next: GioMenuModel | null): void {
        this._unwatch?.();
        this._unwatch = null;
        this._model = next;
        this._tree = next === null ? [] : menuTree(next);
        if (next === null) return;
        // Re-adopting from inside the handler re-snapshots AND re-watches, which is what
        // makes a section added by the mutation audible. The port's `emit` copies its
        // handler list and skips ones disconnected mid-emission, so disconnecting here is
        // safe (`gobject.ts`, `emit`).
        this._unwatch = watchMenuModel(next, () => {
            this._adopt(this._model);
            this.onItemsChanged();
        });
    }
}
