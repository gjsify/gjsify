// <gtk-popover-menu> — `GtkPopoverMenu`, a `GtkPopover` whose contents are a MENU MODEL
// instead of a child widget, and which switches between the pages of a submenu stack
// rather than nesting a second surface.
//
// It EXTENDS `<gtk-popover>` and nothing is re-implemented: the dismissal state machine,
// the document-level grab, the arrow/Home/End arithmetic and the `popup`/`popdown`
// vocabulary are the ones the menu button, the drop down and the split button already
// share (ADR 0004). What is new here is only what `gtkpopovermenu.c` adds on top of
// `GtkPopover`:
//
//   · the MODEL, read through the portable value ADR 0042 gave it — the same
//     `menu-model` JSON `<gtk-menu-button>` takes, parsed by the same core function;
//   · the PAGE STACK. `gtk_popover_menu_rebuild_contents` (gtkpopovermenu.c:707-717)
//     empties a `GtkStack` and rebuilds it from the model, and
//     `gtk_popover_menu_open_submenu` is `gtk_stack_set_visible_child_name` (:755-757).
//     So the submenu a reader is inside is a NAMED PAGE of one surface, not a second
//     popup beside it — which is why `visible-submenu` is a real property here and why a
//     back row is drawn at the top of an open page;
//   · the two ARIA facts GTK sets on the surface: `menu` for the popover and the
//     `menuitem` / `menuitemcheckbox` / `menuitemradio` roles the rows carry
//     (gtkpopovermenu.c:160-164).
//
// The ROWS are not new either: they are `PopoverMenuView`, the one implementation
// `<gtk-menu-button>` and `<adw-split-button>` already share, including Left/Right
// changing the page and the accelerator/check/submenu decoration. What this element adds
// is where the activation goes, and that is `GtkPopoverMenu`'s own rule: activating an
// item closes the popover and hands focus back to the anchor, so a menu cannot be left
// open by choosing from it.
//
// `menu-title` is a PORT-ONLY attribute. `GMenuModel` has no title; GTK spells a heading
// as a labelled SECTION, which `menu-model` already carries. The title exists because a
// popover menu with a heading is the commonest shape an application writes by hand, and
// both existing surfaces take it.
//
// Attributes (in addition to every `<gtk-popover>` one):
//   menu-model       — the portable menu model as JSON (ADR 0042): items, sections and
//                      submenus, with the attribute names GTK reads.
//   menu-title       — optional heading above the menu.
//   visible-submenu  — the name of the open page; `'main'` is the root, a submenu's label
//                      is its name. `gtk_popover_menu_open_submenu(popover, "main")` is
//                      the way back, so this is writeable and readable.
// Properties:
//   menuModel        — the real `Gio.MenuModel` (ADR 0128), or `null` (get/set; a `custom`
//                      item throws here). A menu bar hands one of these over for a submenu
//                      of its own; a JSON string is the authored spelling.
//   actions          — what the action group publishes about the actions the model names
//                      (ADR 0042), the source of every row's enabled/checked state.
//   visibleSubmenu   — the open page's name (get/set).
// Methods:
//   openSubmenu(name) — `gtk_popover_menu_open_submenu`.
//   closeSubmenus()   — `gtk_popover_menu_close_submenus`, one level (gtkpopovermenu.c:223-233).
// Events:
//   `notify::visible-submenu` (CustomEvent, bubbles, detail = { visibleSubmenu }) —
//     mirrors the GObject notify; the page changed.
//   `menu-item-activated` (CustomEvent, bubbles, detail = { id, label, path }) — the
//     item at `path` was chosen. Same payload and the same `id` fallback as
//     `<gtk-menu-button>`, so one listener serves both.
//
// KNOWN_GAPS — the one `GtkPopoverMenu` scalar property this element does not observe:
//
//   `flags`   GTK's `GTK_POPOVER_MENU_NESTED` opens a submenu as a NESTED POPOVER beside
//             the row (`gtk_popover_menu_new_from_model_full`, gtkpopovermenu.c:817-825)
//             and `GTK_POPOVER_MENU_SLIDING` — the DEFAULT — swaps the page of the one
//             surface, which is what `PopoverMenuView` has always drawn. Only the sliding
//             half is modelled: a nested popover would need the arrow this package does not
//             draw and a second anchor the CSS placement cannot point at.
//
// Reference: refs/gtk/gtk/gtkpopovermenu.c (the page stack :707-757, the flags :638-648,
//   the roles :160-164, `close_submenus` :223-233)
// Reference: refs/gtk/gtk/gtkmodelbutton.c:1174-1210 (Left/Right change the page)
// Reference: refs/libadwaita/src/stylesheet/widgets/_menus.scss (popover.menu, modelbutton)
// Copyright (c) GNOME contributors (GTK, libadwaita). LGPLv2.1+
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import { menuItemAt, menuNodeAt } from '@gjsify/adwaita-core';
import { activateElementMenuItem, menuActionsOfElement } from '../application.js';
import type { AdwMenuActions, AdwMenuModel, AdwMenuPath, AdwMenuTree } from '@gjsify/adwaita-core';

import { GtkPopover } from './gtk-popover.js';
import { MenuSlot } from './menu-slot.js';
import { PopoverMenuView } from './popover-menu.js';

/** The name the ROOT page carries — `gtk_popover_menu_open_submenu`'s own "main". */
const MAIN_PAGE = 'main';

export class GtkPopoverMenu extends GtkPopover {
    /** The model, its tree snapshot and its `items-changed` subscription (ADR 0128). */
    private readonly _slot = new MenuSlot(() => {
        if (this._menuInitialized) this._renderMenu();
    });
    private _actions: AdwMenuActions | null = null;
    private _menuView!: PopoverMenuView;
    /** Named apart from `GtkPopover`'s own: two `private` fields of one name are two fields. */
    private _menuInitialized = false;

    static get observedAttributes() {
        return [...GtkPopover.observedAttributes, 'menu-model', 'menu-title', 'visible-submenu'];
    }

    /** The menu this popover draws, by identity, or `null` (ADR 0128). */
    get menuModel(): AdwMenuModel | null {
        return this._slot.model;
    }

    /**
     * Take a real model, a JSON string in the portable spelling, or `null`, refusing a
     * `custom` item HERE — at the assignment, where it is a call the caller can catch.
     * An ATTRIBUTE is markup the browser parses, so that path refuses the whole menu and
     * says why on `console.error`; {@link MenuSlot} owns both doors.
     *
     * A REAL MODEL IS WHAT A MENU BAR HANDS OVER for one of its submenus, and the model
     * it hands over is `buildMenu(node.items)` — a menu of its own rather than this
     * element's authored one, so the two cannot overwrite each other.
     */
    set menuModel(value: AdwMenuModel | string | null) {
        this._slot.write(value);
        if (this._menuInitialized) this._renderMenu();
    }

    /** What the action group publishes about the actions this menu names (ADR 0042). */
    get actions(): AdwMenuActions | null {
        return this._actions;
    }

    set actions(value: AdwMenuActions | null) {
        this._actions = value ?? null;
        this._menuView?.setActions(this._actions);
        if (this._menuInitialized) this._renderMenu();
    }

    /** The optional heading. GTK spells one as a labelled SECTION; this is the shorthand. */
    get menuTitle(): string {
        return this.getAttribute('menu-title') ?? '';
    }

    set menuTitle(value: string) {
        this.setAttribute('menu-title', value ?? '');
    }

    /**
     * The name of the open page — `'main'` for the root, a submenu's label for a submenu.
     *
     * GTK's value is the stack child's NAME, which `GtkMenuTracker` gives a submenu page
     * from the node it links; with no name given that is the submenu's label, so the label
     * is what this element answers with. `gtk_popover_menu_open_submenu` (gtkpopovermenu.c
     * :755-757) is the only way in, so setting it navigates rather than describing.
     */
    get visibleSubmenu(): string {
        const open = this._openPageLabel();
        return open === null ? MAIN_PAGE : open;
    }

    set visibleSubmenu(value: string) {
        this.openSubmenu(value);
    }

    /** The menu's own stack is the child (gtkpopovermenu.c `gtk_popover_menu_init`). */
    protected override takesChild(): boolean {
        return false;
    }

    connectedCallback() {
        super.connectedCallback();
        if (this._menuInitialized) return;
        this._menuInitialized = true;

        // `gtk_popover_menu_new` creates the popover with `autohide = TRUE`
        // (gtkpopovermenu.c:729-731), which is also the plain `<gtk-popover>` default.
        this.classList.add('adw-popover-menu');
        this.setAttribute('role', 'menu');
        // `GtkPopoverMenu` "is one of the cases that add a `.menu` style class to the main
        // `popover` node" (gtkpopovermenu.c:152-154), so the 6px menu inset and the
        // `min-width: 120px` are not a choice here — they are what the node IS.
        this.setAttribute('menu', '');

        this._menuView = new PopoverMenuView(this, 'adw-popover-menu', (path) => this._activate(path));
        this._menuView.setActions(this._actions);

        if (this._slot.model === null) this._slot.writeMarkup(this.getAttribute('menu-model'));
        // The VIEW is what draws, and it holds the TREE it walks — seeding the slot
        // without handing the view the same snapshot would leave it drawing an EMPTY
        // page over a model the element believes it has.
        this._renderMenu();

        // The visible page RESETS when the popover closes, as `gtk_popover_menu_show` does
        // with `gtk_popover_menu_set_open_submenu (widget, NULL)` (gtkpopovermenu.c:573-579):
        // a menu that reopens three levels deep is one the reader cannot get out of.
        this.subscribe((open) => {
            if (open) {
                this._menuView.setActions(this._actions ?? menuActionsOfElement(this, this._slot.tree));
                this._menuView.render();
                this._menuView.focusableRows[0]?.focus();
            } else this._menuView.reset();
        });
    }

    attributeChangedCallback(name?: string, previous?: string | null, value?: string | null) {
        super.attributeChangedCallback(name, previous, value);
        if (!this._menuInitialized) return;
        if (name === 'menu-model') {
            this._slot.writeMarkup(this.getAttribute('menu-model'));
            this._renderMenu();
            return;
        }
        if (name === 'menu-title') {
            this._menuView.setTitle(this.menuTitle);
            this._menuView.render();
            return;
        }
        if (name === 'visible-submenu') {
            // The ATTRIBUTE is navigation, because the PROPERTY is: `visibleSubmenu` is a
            // thin setter over `openSubmenu`, so a markup change and a code change reach the
            // same page. `_reflectSubmenu` writes the attribute back only when it DIFFERS,
            // which is what stops this from looping.
            this._navigate(value ?? MAIN_PAGE);
        }
    }

    /** `gtk_popover_menu_open_submenu` — switch to the named page. */
    openSubmenu(name: string): void {
        this._navigate(name);
    }

    /**
     * The ONE way the open page changes, from the property and from the attribute alike.
     *
     * The notify belongs HERE rather than beside the attribute write: a page can change
     * without the attribute's text changing (`openSubmenu('More')` when it is already
     * `More` after a dismissal, or an attribute set to the page already showing), and
     * `GObject` notifies on the state, not on the spelling.
     */
    private _navigate(name: string): void {
        const before = this.visibleSubmenu;
        if (!this._showPage(name)) return;
        const after = this.visibleSubmenu;
        this._reflectSubmenu();
        if (after === before) return;
        this.dispatchEvent(
            new CustomEvent('notify::visible-submenu', { bubbles: true, detail: { visibleSubmenu: after } }),
        );
    }

    /**
     * Point the page stack at the named page and rebuild it. `false` when the name is not
     * one of the stack's children, which is what `gtk_stack_set_visible_child_name` leaves
     * alone — the current page keeps showing rather than the surface blanking.
     */
    private _showPage(name: string): boolean {
        if (name === MAIN_PAGE || name.length === 0) {
            this._menuView.reset();
        } else {
            const path = this._findSubmenu(name);
            if (path === null) return false;
            this._menuView.setMenuTree(this._slot.tree);
            this._menuView.showPage(path);
        }
        this._menuView.render();
        return true;
    }

    /**
     * `gtk_popover_menu_close_submenus` — leave the open submenu, ONE level
     * (gtkpopovermenu.c:223-233), which is what the back row does.
     */
    closeSubmenus(): void {
        this.openSubmenu(MAIN_PAGE);
    }

    private _openPageLabel(): string | null {
        const path = this._menuView.page;
        if (path.length === 0) return null;
        const node = menuNodeAt(this._slot.tree, path);
        return node !== null && node.kind !== 'item' ? node.label : null;
    }

    private _findSubmenu(label: string): AdwMenuPath | null {
        const walk = (nodes: AdwMenuTree, path: AdwMenuPath): AdwMenuPath | null => {
            for (const [index, node] of nodes.entries()) {
                if (node.kind === 'item') continue;
                const here = [...path, index];
                if (node.label === label) return here;
                const found = walk(node.items, here);
                if (found !== null) return found;
            }
            return null;
        };
        return walk(this._slot.tree, []);
    }

    /**
     * Write the open page back to the attribute, ONCE, and only when the spelling differs.
     *
     * Reading the attribute instead of the state is the whole loop guard: navigating sets
     * this, the attribute change calls back into `_navigate`, and a comparison against the
     * current value stops the second turn.
     */
    private _reflectSubmenu(): void {
        const name = this.visibleSubmenu;
        if (this.getAttribute('visible-submenu') === name) return;
        this.setAttribute('visible-submenu', name);
    }

    /**
     * Activating an item closes the popover and returns focus to the anchor — the
     * behaviour every menu-bearing surface here has, and the reason a menu cannot be left
     * open by choosing from it.
     */
    private _activate(path: AdwMenuPath): void {
        const target = menuItemAt(this._slot.tree, path);
        this.popdown();
        this.anchor?.focus();
        if (target === null) return;
        activateElementMenuItem(this, target);
        this.dispatchEvent(
            new CustomEvent('menu-item-activated', {
                bubbles: true,
                detail: { id: target.id ?? target.label, label: target.label, path: [...path] },
            }),
        );
    }

    private _renderMenu(): void {
        this._menuView.setMenuTree(this._slot.tree);
        this._menuView.setTitle(this.menuTitle);
        this._menuView.render();
        if (this._slot.isEmpty) this.popdown();
    }
}

customElements.define('gtk-popover-menu', GtkPopoverMenu);
