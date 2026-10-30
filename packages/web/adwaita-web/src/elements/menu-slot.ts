// The `menu-model` SLOT the menu-bearing elements of this package share.
//
// ADR 0128 made `menu-model` a real `Gio.MenuModel`, and that turned one assignment into
// four steps that only work in one order:
//
//   1. read the write — `readMenuModelWrite` is the core's one door, and it is what tells a
//      real model apart from the JSON string an attribute carries (ADR 0128 § 4);
//   2. REFUSE what this surface cannot draw, before the element renders it;
//   3. take a TREE SNAPSHOT, because every walker (`flattenMenu`, `menuNodeAt`,
//      `menuItemAt`, `menuRefusals`) takes an `AdwMenuTree` and not a model — one snapshot
//      per change rather than a chain of `get_item_link` calls per row;
//   4. connect `items-changed` — on the root AND on every section and submenu it links,
//      which is what `watchMenuModel` does, because a link's emission does NOT bubble.
//
// THE STEP THAT IS EASIEST TO GET WRONG IS THE LAST ONE: the watcher has to be RE-RUN after
// every snapshot, since a mutation can add a section that was not there to connect to. Six
// elements here need all four steps, so the arithmetic lives once and there is no sixth
// place to forget it.
//
// THE TWO WRITES REFUSE DIFFERENTLY, and the difference is which side can hear it, exactly
// as it was before the model became real. {@link MenuSlot.write} is a property assignment,
// so it is a CALL and it THROWS; {@link MenuSlot.writeMarkup} is an attribute the browser
// parsed, where a throw out of `connectedCallback` reaches nobody and is reported as an
// uncaught page error (measured: it broke `adwaita-upgrade-order.spec.ts`, which counts
// exactly those) — so markup refuses the MENU and says why on `console.error`.
//
// THE WATCHER'S LIFETIME IS THE ELEMENT'S, with no `release()` to call. GTK disconnects in
// `dispose`, and a custom element has no dispose: it has `disconnectedCallback`, which also
// fires when a node is MOVED, and an element re-inserted after dropping its watcher would
// be deaf to the menu it still holds. A held model keeping its element alive is the same
// shape GTK has, where the widget owns a reference to the model it reads.

import {
    ADW_MENU_SURFACE_WEB,
    GjsifyMenu,
    assertMenuRenderable,
    menuRefusals,
    menuTree,
    readMenuModelWrite,
    watchMenuModel,
} from '@gjsify/adwaita-core';
import type { AdwMenuTree, GioMenuModel } from '@gjsify/adwaita-core';

export class MenuSlot {
    /**
     * The menu this element OWNS, so an edit to the same `menu-model="[…]"` attribute is a
     * content change rather than a new menu — the popover already open follows it instead of
     * being rebuilt (ADR 0128 § 5, the same rule `GjsifyOptionList` has for a list).
     */
    private readonly _authored = new GjsifyMenu();
    private _model: GioMenuModel | null = null;
    private _tree: AdwMenuTree = [];
    private _unwatch: (() => void) | null = null;

    /** @param onItemsChanged what to do when the HELD menu mutates under the element. */
    constructor(private readonly onItemsChanged: () => void) {}

    /** The model itself, by identity — what `menuModel` answers and what a child is handed. */
    get model(): GioMenuModel | null {
        return this._model;
    }

    /** The snapshot every walker reads. Re-taken on each `items-changed`, never aliased. */
    get tree(): AdwMenuTree {
        return this._tree;
    }

    /**
     * Whether there is anything to show — NOT whether there is a menu.
     *
     * `null` and an empty `Gio.Menu` are different menus and GTK treats them differently: an
     * empty non-null model still builds a `GtkPopoverMenu` and still dissociates an
     * application-set popover (measured, `MENU_MODEL_DOOR_VECTORS`). This answers the
     * question the ROWS ask — "is there a row to draw" — and the elements ask
     * `model === null` where GTK asks about the model.
     */
    get isEmpty(): boolean {
        return this._tree.length === 0;
    }

    /**
     * A PROPERTY write: a real model by identity, a JSON string into the authored menu,
     * `null` for no menu — and a `TypeError` for an array, which this door no longer takes
     * (`buildMenu` is how an array becomes a model now).
     *
     * A REFUSAL PUTS THE AUTHORED MENU BACK, because the door has already reconciled it by
     * the time the tree can be refused: without the restore a refused string would leave the
     * element holding a menu it threw over, and the next render would draw it.
     */
    write(value: unknown): void {
        const before = this._tree;
        const next = readMenuModelWrite(value, this._authored);
        try {
            if (next !== null) assertMenuRenderable(menuTree(next), ADW_MENU_SURFACE_WEB);
        } catch (error) {
            if (next === this._authored) this._authored.reconcile(before);
            throw error;
        }
        this._adopt(next);
    }

    /**
     * The `menu-model` ATTRIBUTE, through the same door. A `null` attribute is no menu.
     *
     * A REFUSAL AND A TYPO ARE STILL DIFFERENT THINGS: `parseMenuModel` is total because
     * malformed JSON is an author slip that must not stop the element upgrading, while a
     * `custom` item is well-formed, deliberate, and unhonourable on this surface.
     */
    writeMarkup(value: string | null): void {
        const next = readMenuModelWrite(value, this._authored);
        const refusals = next === null ? [] : menuRefusals(menuTree(next), ADW_MENU_SURFACE_WEB);
        if (refusals.length === 0) {
            this._adopt(next);
            return;
        }
        // `console.error` is the browser's own channel for "this is wrong, the page
        // continues" — and the alternative here is a row that lies.
        console.error(`${ADW_MENU_SURFACE_WEB.name} cannot render this menu, so it has none:`);
        for (const refusal of refusals) console.error(`  [${refusal.path.join('.')}] ${refusal.message}`);
        this._adopt(null);
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
