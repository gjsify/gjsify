// <gtk-popover-menu-bar> — a horizontal bar of items that pop up a menu when clicked.
// `GtkPopoverMenuBar` (gtkpopovermenubar.c:24-56) exists in exactly one form: a bar whose
// contents come from a `GMenuModel` of SUBMENUS, one `item` per submenu and one popover
// below it. There is no constructor that takes children — `tracker_insert` warns
// "Don't know how to handle this item" for a toplevel node that is not a submenu link
// (gtkpopovermenubar.c:466), which is why a non-submenu toplevel is refused HERE with that
// same wording rather than drawn as a label that opens nothing.
//
// What makes it a MENU BAR rather than a row of menu buttons is `set_active_item`
// (gtkpopovermenubar.c:126-163), and its three rules are the whole element:
//
//   1. ONE item is active at a time. Changing it UNSETS `SELECTED` on the old one and sets
//      it on the new one WITHOUT emitting a notify — GTK's state flags are silent, and a
//      `notify` per hover would make `aria-expanded` chatter on the wrong element.
//   2. CLICKING opens (the `popup` argument is TRUE); HOVERING only SELECTS. The popover
//      then opens only if it was already mapped when the pointer moved on, which is the
//      behaviour that lets a reader walk the bar with the arrow keys and open the bar by
//      arriving — `if (popup || (was_popup && changed)) open_submenu (…)`.
//   3. THE ITEM WHOSE POPOVER IS OPEN GETS `.active`, and the bar's `leave` clears it only
//      when that popover is not mapped (`bar_leave_cb`, gtkpopovermenubar.c:203-214): a
//      pointer that leaves the bar INTO an open menu keeps the item lit.
//
// Arrow keys move between items and WRAP: `gtk_popover_menu_bar_focus`
// (gtkpopovermenubar.c:221-256) takes LEFT/RIGHT to the previous/next sibling and, past
// either end, to the last/first child; any other direction returns FALSE so the menu below
// keeps it. Up/Down is the menu's own, which is why this element does not steal it — and
// the bar forwards a direction into an open submenu FIRST (:224-231), so a popover that is
// open is the test for whether the bar or the menu owns the key.
//
// Each item's popover is a `GtkPopoverMenu`, pinned to `GTK_POS_BOTTOM` with `has-arrow`
// FALSE (gtkpopovermenubar.c:435-437), and its accessible relation is LABELLED_BY the item
// and CONTROLS the popover, with `HAS_POPUP` set and `EXPANDED` maintained by the popover's
// `show`/`hide` (:322-327, :399-415). This port spells that as `aria-haspopup`,
// `aria-expanded` and `aria-controls`.
//
// Attributes:
//   menu-model — the portable menu model as JSON (ADR 0042), whose TOPLEVEL entries must
//               all be submenus.
// Properties:
//   menuModel  — the model, normalised (get/set; a `custom` item throws here).
//   actions    — what the action group publishes about the actions the menus name.
//   activeItem — the focused/selected item's button, or `null`. GTK's `active_item`.
// Methods:
//   selectFirst() — `gtk_popover_menu_bar_select_first` (:761-767): activate the first item
//                   and open it.
//   popup()       — what the bar's `menu.popup` action does, which is the same thing.
// Events:
//   `menu-item-activated` (CustomEvent, bubbles, detail = { id, label, path }) — an item in
//     one of the popovers was chosen; `path` addresses it in the WHOLE model, so the
//     `File ▸ New` row reports `[0, 0]`.
//
// KNOWN_GAPS — none: `menu-model` is the widget's only property and it is observed.
//
// Reference: refs/gtk/gtk/gtkpopovermenubar.c (the class docs :24-56, `set_active_item`
//   :126-163, `…_focus` :221-256, `tracker_insert` :422-468, the `leave` handler :203-214)
// Reference: refs/libadwaita/src/stylesheet/widgets/_menus.scss:244-269 (`menubar > item`)
// Copyright (c) GNOME contributors (GTK, libadwaita). LGPLv2.1+
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import {
    ADW_MENU_SURFACE_WEB,
    assertMenuRenderable,
    menuItemAt,
    menuRefusals,
    normalizeMenuModel,
    parseMenuModel,
} from '@gjsify/adwaita-core';
import type { AdwMenuActions, AdwMenuInput, AdwMenuModel, AdwMenuPath, AdwMenuSubmenu } from '@gjsify/adwaita-core';

// The definition has to be there before this module's own can build one in
// `connectedCallback`; a combined `import { GtkPopoverMenu }` would be elided, because the
// binding is only used in type position.
import './gtk-popover-menu.js';

import type { GtkPopoverMenu } from './gtk-popover-menu.js';

/** One bar item: its submenu node, the popover below it, and the DOM that draws both. */
interface MenuBarItem {
    /** The submenu node this item was built from — the source of the label. */
    node: AdwMenuSubmenu;
    /** The item's own path in the whole model, so a row inside it reports one path. */
    path: AdwMenuPath;
    root: HTMLElement;
    button: HTMLButtonElement;
    popover: GtkPopoverMenu;
}

export class GtkPopoverMenuBar extends HTMLElement {
    private _model: AdwMenuModel = [];
    private _actions: AdwMenuActions | null = null;
    private _items: MenuBarItem[] = [];
    private _active: MenuBarItem | null = null;
    private _initialized = false;

    static get observedAttributes() {
        return ['menu-model'];
    }

    /** The menu model, normalised (ADR 0042). */
    get menuModel(): AdwMenuModel {
        return this._model;
    }

    set menuModel(value: AdwMenuInput) {
        this._model = normalizeMenuModel(value);
        assertMenuRenderable(this._model, ADW_MENU_SURFACE_WEB);
        if (this._initialized) this._rebuild();
    }

    /** What the action group publishes about the actions these menus name (ADR 0042). */
    get actions(): AdwMenuActions | null {
        return this._actions;
    }

    set actions(value: AdwMenuActions | null) {
        this._actions = value ?? null;
        if (this._initialized) this._rebuild();
    }

    /** The active item's button, or `null` — GTK's `active_item`, as a widget. */
    get activeItem(): HTMLElement | null {
        return this._active?.button ?? null;
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;
        this.classList.add('adw-popover-menu-bar');
        // `gtk_widget_class_set_accessible_role (…, GTK_ACCESSIBLE_ROLE_MENU_BAR)`
        // (gtkpopovermenubar.c:641).
        this.setAttribute('role', 'menubar');
        this.addEventListener('keydown', (event) => this._onKeyDown(event));
        // `bar_leave_cb` is installed on the BAR, not on an item (gtkpopovermenubar.c:650-656).
        this.addEventListener('pointerleave', () => {
            if (this._active !== null && !this._active.popover.open) this._setActive(null, false);
        });
        if (this._model.length === 0) this._model = this._parseMenuAttr();
        this._rebuild();
    }

    attributeChangedCallback(name?: string) {
        if (!this._initialized || name !== 'menu-model') return;
        this._model = this._parseMenuAttr();
        this._rebuild();
    }

    /** `gtk_popover_menu_bar_select_first` — activate and OPEN the first item. */
    selectFirst(): void {
        this._setActive(this._items[0] ?? null, true);
    }

    /** What the bar's `menu.popup` action does, which is the same thing. */
    popup(): void {
        this.selectFirst();
    }

    /**
     * `set_active_item` (gtkpopovermenubar.c:126-163), variable names and all.
     *
     * `changed` and `was_popup` decide three DIFFERENT outcomes — close the old one, open
     * the new one, or move focus onto it — and collapsing them is how a hover would come to
     * open menus, which is the single behaviour that separates a menubar from a row of menu
     * buttons.
     */
    private _setActive(item: MenuBarItem | null, popup: boolean): void {
        const changed = item !== this._active;
        // The C reads the OLD item's popover through `gtk_widget_get_mapped`; `open` is
        // that same question, asked of the same widget in this renderer.
        const wasPopup = this._active !== null && this._active.popover.open;

        if (wasPopup && changed) this._active?.popover.popdown();
        if (changed) {
            this._active?.button.classList.remove('selected');
            this._active = item;
            // `gtk_widget_set_state_flags (…, GTK_STATE_FLAG_SELECTED, FALSE)` — the
            // no-notify argument. A notify here would be an `aria-expanded` per pointer move.
            item?.button.classList.add('selected');
        }
        if (this._active === null) return;
        if (popup || (wasPopup && changed)) this._active.popover.open = true;
        else if (changed && this.matches(':focus-within')) this._active.button.focus();
    }

    private _onKeyDown(event: KeyboardEvent): void {
        // The bar's `focus` vfunc forwards the direction into an open submenu FIRST and
        // only then moves between items (gtkpopovermenubar.c:224-231), so an open popover
        // is the test for who owns the key. `<gtk-popover>` and `PopoverMenuView` inside it
        // handle Up/Down/Left/Right themselves in that state.
        if (this._active?.popover.open === true) return;
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        this._move(event.key === 'ArrowRight' ? 1 : -1);
    }

    /**
     * The sibling in `step`'s direction, WRAPPING at either end
     * (gtkpopovermenubar.c:232-252): with no active item there is no sibling, so the first
     * move goes to the first child for RIGHT and to the LAST for LEFT.
     */
    private _move(step: number): void {
        const count = this._items.length;
        if (count === 0) return;
        const current = this._active === null ? -1 : this._items.indexOf(this._active);
        let next = current + step;
        if (next < 0) next = count - 1;
        if (next >= count) next = 0;
        this._setActive(this._items[next], false);
    }

    private _rebuild(): void {
        this._items = [];
        this._active = null;
        const built: MenuBarItem[] = [];
        this._model.forEach((node, index) => {
            if (node.kind !== 'submenu') return;
            built.push(this._buildItem(node, [index]));
        });
        this._items = built;
        this.replaceChildren(...built.map((item) => item.root));
    }

    /**
     * Focus the first row a key can reach in a menu that has just opened.
     *
     * This is what `autohide` does in GTK: `gtk_popover_show` calls
     * `gtk_widget_child_focus (widget, GTK_DIR_TAB_FORWARD)` when the property holds
     * (gtkpopover.c:1188-1192), and a browser popup takes no focus until it is told to —
     * which is why the item whose menu opened is what does it here.
     */
    private _focusFirstRow(popover: GtkPopoverMenu): void {
        const row = popover.querySelector<HTMLButtonElement>('.adw-popover-item:not([hidden]):not([disabled])');
        row?.focus();
    }

    /**
     * One `menubar > item > popover` (the node tree in gtkpopovermenubar.c:38-46).
     *
     * A toplevel node that is not a submenu is refused by `_parseMenuAttr` with GTK's own
     * wording rather than drawn: `tracker_insert` builds nothing for it
     * (gtkpopovermenubar.c:466), and a row that opens nothing is the same lie in another
     * shape.
     */
    private _buildItem(node: AdwMenuSubmenu, path: AdwMenuPath): MenuBarItem {
        const root = document.createElement('div');
        // The wrapper is GTK's `item` NODE, which carries no accessible role of its own —
        // `menubar`'s children are the `menuitem`s (gtkpopovermenubar.c:55-57). `none` is
        // what keeps the wrapper from being read as a second level of the bar.
        root.className = 'adw-popover-menu-bar-item';
        root.setAttribute('role', 'none');

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'adw-popover-menu-bar-button';
        // `gtk_widget_class_set_accessible_role (…, GTK_ACCESSIBLE_ROLE_MENU_ITEM)` and
        // `set_activate_signal` (gtkpopovermenubar.c:347-349) — which is why a Space or
        // Enter on the item opens its menu through the same click a pointer gives.
        button.setAttribute('role', 'menuitem');
        button.setAttribute('aria-haspopup', 'menu');
        button.setAttribute('aria-expanded', 'false');
        const label = document.createElement('span');
        label.className = 'adw-popover-menu-bar-label';
        label.textContent = node.label;
        button.appendChild(label);

        const popover = document.createElement('gtk-popover-menu') as GtkPopoverMenu;
        // `gtk_popover_set_position (popover, GTK_POS_BOTTOM)` and `set_has_arrow (FALSE)`
        // (gtkpopovermenubar.c:435-436).
        popover.setAttribute('position', 'bottom');
        popover.setAttribute('align', 'start');
        // The submenu's OWN items, handed back as they are: `normalizeMenuModel` is
        // idempotent and explicitly takes an already-normalised node (ADR 0042).
        popover.menuModel = node.items;
        popover.actions = this._actions;
        popover.anchor = button;
        // `gtk_accessible_update_relation (…, LABELLED_BY, item->label, CONTROLS,
        // item->popover)` (gtkpopovermenubar.c:322-327).
        button.setAttribute('aria-controls', 'popover');

        const item: MenuBarItem = { node, path, root, button, popover };
        popover.subscribe((open) => {
            button.setAttribute('aria-expanded', String(open));
            if (open) {
                // `.active` belongs to the item whose popover is OPEN, not to the selected
                // one (gtkpopovermenubar.c:50-51), which is why hover does not light it.
                for (const candidate of this._items) candidate.root.classList.toggle('active', candidate === item);
                this._focusFirstRow(popover);
            } else {
                item.root.classList.remove('active');
                // `popover_unmap` clears the active item when its OWN popover unmaps
                // (gtkpopovermenubar.c:389-396): the reader is back in the bar with nothing
                // lit and no stale selection. The POPOVER resets its own page for the same
                // reason — a menu that reopens three levels deep is one nobody gets out of.
                if (this._active === item) this._active = null;
            }
        });
        // The popover's OWN activation, re-addressed against the BAR's model. Listening to
        // the element rather than driving a second view is the whole point: two views on one
        // surface is two models to keep in step, and the second render of the pair wins —
        // which is how the rows of every item's menu came out empty.
        popover.addEventListener('menu-item-activated', (event) => {
            // CONSUMED, not forwarded: the popover's path is relative to its OWN submenu,
            // and a bar-level listener must see one address for the whole model. Left to
            // bubble it would arrive AFTER this handler's re-dispatch with the shorter
            // path — two activations of one choice, the second one wrong.
            event.stopPropagation();
            const inner = (event as CustomEvent<{ path: number[] }>).detail;
            this._activate(item, [...path, ...inner.path]);
        });

        // CLICK opens (`clicked_cb` passes TRUE, gtkpopovermenubar.c:165-176); HOVER only
        // selects (`item_enter_cb` passes FALSE, :178-189).
        button.addEventListener('click', () => this._setActive(item, true));
        root.addEventListener('pointerenter', () => this._setActive(item, false));

        root.append(button, popover);
        return item;
    }

    /**
     * Activating a row inside one of the popovers closes THAT popover and hands focus back
     * to its item, which is what `gtk_popover_menu_set_active_item` does when the active
     * row is not the row that opened a submenu (gtkpopovermenu.c:257-259).
     */
    private _activate(item: MenuBarItem, path: AdwMenuPath): void {
        const target = menuItemAt(this._model, path);
        item.popover.popdown();
        item.button.focus();
        if (target === null) return;
        this.dispatchEvent(
            new CustomEvent('menu-item-activated', {
                bubbles: true,
                detail: { id: target.id ?? target.label, label: target.label, path: [...path] },
            }),
        );
    }

    private _parseMenuAttr(): AdwMenuModel {
        const model = normalizeMenuModel(parseMenuModel(this.getAttribute('menu-model')));
        const refusals = menuRefusals(model, ADW_MENU_SURFACE_WEB);
        if (refusals.length > 0) {
            console.error(`${ADW_MENU_SURFACE_WEB.name} cannot render this menu, so it has none:`);
            for (const refusal of refusals) console.error(`  [${refusal.path.join('.')}] ${refusal.message}`);
            return [];
        }
        for (const [index, node] of model.entries()) {
            if (node.kind === 'submenu') continue;
            // A WARNING and not an error, and the distinction is GTK's: `g_warning` is
            // recoverable, and the submenus beside the offending entry still work.
            console.warn(`Don't know how to handle this item: top-level entry ${index} is a ${node.kind}.`);
        }
        return model;
    }
}

customElements.define('gtk-popover-menu-bar', GtkPopoverMenuBar);
