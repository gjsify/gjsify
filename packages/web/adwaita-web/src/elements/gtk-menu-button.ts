// <gtk-menu-button> — the web counterpart of Gtk.MenuButton, which libadwaita styles
// but never subclassed: by default the flat `open-menu-symbolic` app-menu button used
// at the end of a header bar. Clicking it toggles an Adwaita-styled popover under the
// button, dismissed on an outside click or Escape, with arrow-key navigation.
//
// The popover is `<gtk-popover>` and the dismissal/keyboard machine is
// `@gjsify/adwaita-core`'s (ADR 0004); this element keeps only what is a menu button:
// the icon, the item model, the title. Icons go through `<gtk-image>`, whose
// `normalizeIconName` guard is what keeps a multi-token `icon-name="a b"` from
// shipping a stray CSS class — for the button icon and for every menu entry's.
//
// The `menu-model` ATTRIBUTE is a JSON array in the portable menu model (ADR 0042) —
// items, sections and submenus, with the same attributes GTK reads. The `menuModel`
// PROPERTY is a real `Gio.MenuModel` (ADR 0128), which is what GTK's own property is:
// {@link MenuSlot} is the door between the two, and it is what hears a menu mutate
// after it was handed over; a write of the property or the attribute fires
// `notify::menu-model` (CustomEvent, bubbles, detail `{ menuModel }`). Choosing an item
// closes the popover and fires `menu-item-activated` (CustomEvent, bubbles, detail
// `{ id, label, path }`) with `id` falling back to `label`, matching the NS twin. The
// rows themselves are `PopoverMenuView`'s, shared with `<adw-split-button>`: the split
// button's dropdown half IS a GtkMenuButton, so one popup implementation is the whole
// point.
//
// Reference: refs/gtk/gtk/gtkmenubutton.c (GtkMenuButton)
// Reference: refs/libadwaita/src/stylesheet/widgets/_buttons.scss (menubutton)
// Reference: refs/libadwaita/src/stylesheet/widgets/_menus.scss (popover.menu / modelbutton)
// Reference: packages/nativescript-bridge/adwaita/src/widgets/adw-menu-button.ts (NS twin)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import { isSplitButtonDirection, menuButtonPopupDirection, menuItemAt } from '@gjsify/adwaita-core';
import { activateElementMenuItem, menuActionsOfElement } from '../application.js';
import type { AdwMenuActions, AdwMenuModel, SplitButtonDirection } from '@gjsify/adwaita-core';

import { MenuSlot } from './menu-slot.js';
import { PopoverMenuView } from './popover-menu.js';

// SIDE-EFFECT import, deliberately separate from the type import below: it guarantees
// `gtk-popover` is defined before this module's `customElements.define` can upgrade a
// server-rendered `<gtk-menu-button>` and build one. A combined
// `import { GtkPopover }` would NOT do it — the binding is only used in type position,
// and this package compiles without `verbatimModuleSyntax`, so TypeScript would elide
// the statement and take the registration with it.
import './gtk-popover.js';
import type { GtkPopover } from './gtk-popover.js';

import { createGtkImage } from './gtk-image.js';
import { WidgetElement } from '../widget-element.js';

/**
 * Where the popover sits, per `GtkArrowType`. `menuButtonPopupDirection` folds `none`
 * onto `down` — GtkMenuButton's rule, not ours; this table is only the
 * direction→CSS-axis mapping, which is a renderer fact.
 *
 * `left`/`right` become `start`/`end` because the surface is placed with logical
 * properties, so it follows the writing direction as GTK's `:dir(rtl)` popovers do.
 */
const POPOVER_POSITIONS = {
    down: 'bottom',
    up: 'top',
    left: 'start',
    right: 'end',
} as const;

export class GtkMenuButton extends WidgetElement {
    private _buttonEl!: HTMLButtonElement;
    private _popoverEl!: GtkPopover;
    /** The model, its tree snapshot and its `items-changed` subscription (ADR 0128). */
    private readonly _slot = new MenuSlot(() => {
        if (this._initialized) this._renderMenu();
    });
    private _actions: AdwMenuActions | null = null;
    private _menuTitle = '';
    private _initialized = false;
    private _menuView!: PopoverMenuView;

    static get observedAttributes() {
        return ['icon-name', 'menu-title', 'menu-model', 'disabled', 'flat', 'circular', 'direction'];
    }

    /** Whether the popover menu is currently open. */
    get active(): boolean {
        return this._popoverEl?.open ?? false;
    }

    /**
     * The menu this button pops up, BY IDENTITY — the model itself, `null` when there is
     * none, exactly as `gtk_menu_button_get_menu_model` answers (ADR 0128).
     *
     * It no longer answers an array, and `[]` is no longer how "no menu" is spelled: an
     * EMPTY model is a menu that GTK still builds a popover for, and `null` is the one
     * spelling of its absence (measured, `MENU_MODEL_DOOR_VECTORS`).
     */
    get menuModel(): AdwMenuModel | null {
        return this._slot.model;
    }

    /**
     * Take a real model, a JSON string in the portable spelling, or `null`. Refused HERE,
     * at the assignment, for a `custom` item this surface cannot host — {@link MenuSlot}
     * owns both doors and the note on why they refuse differently.
     */
    set menuModel(value: AdwMenuModel | string | null) {
        this._slot.write(value);
        if (this._initialized) this._renderMenu();
        this._notifyModel();
    }

    /** `Gtk.MenuButton:menu-model` — the GIR spelling of {@link menuModel}. */
    get menu_model(): AdwMenuModel | null {
        return this.menuModel;
    }

    set menu_model(value: AdwMenuModel | string | null) {
        this.menuModel = value;
    }

    get_menu_model(): AdwMenuModel | null {
        return this.menuModel;
    }

    set_menu_model(value: AdwMenuModel | string | null): void {
        this.menuModel = value;
    }

    /**
     * What the action group publishes about the actions this menu names — the portable
     * stand-in for a `GActionGroup`, and the only source of a menu's enabled/checked
     * state (ADR 0042).
     */
    get actions(): AdwMenuActions | null {
        return this._actions;
    }

    set actions(value: AdwMenuActions | null) {
        this._actions = value ?? null;
        this._menuView?.setActions(this._actions);
        if (this._initialized) this._renderMenu();
    }

    /** The optional popover heading. */
    get menuTitle(): string {
        return this.getAttribute('menu-title') ?? this._menuTitle;
    }

    set menuTitle(value: string) {
        this._menuTitle = value ?? '';
        this.setAttribute('menu-title', this._menuTitle);
    }

    /** Where the popover opens, and (via core) which way `none` folds. */
    get direction(): SplitButtonDirection {
        const value = this.getAttribute('direction');
        return isSplitButtonDirection(value) ? value : 'down';
    }

    set direction(value: SplitButtonDirection) {
        this.setAttribute('direction', value);
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        this.classList.add('adw-menu-button');

        this._buttonEl = document.createElement('button');
        this._buttonEl.type = 'button';
        this._buttonEl.className = 'adw-menu-button-button';
        this._buttonEl.setAttribute('aria-haspopup', 'menu');
        this._buttonEl.setAttribute('aria-expanded', 'false');

        this._popoverEl = document.createElement('gtk-popover') as GtkPopover;
        this._popoverEl.classList.add('adw-menu-button-popover');
        this._popoverEl.setAttribute('role', 'menu');
        // `gtk_menu_button_set_menu_model` builds a GtkPopoverMenu, whose CSS
        // node is `popover.menu` — the surface _menus.scss styles throughout.
        this._popoverEl.setAttribute('menu', '');
        this._popoverEl.setAttribute('align', 'end'); // the header-end app menu idiom

        this.replaceChildren(this._buttonEl, this._popoverEl);
        this._popoverEl.anchor = this._buttonEl;
        this._popoverEl.subscribe((open) => this._onPopoverToggled(open));

        this._menuView = new PopoverMenuView(this._popoverEl, 'adw-menu-button', (path) => {
            const item = menuItemAt(this._slot.tree, path);
            if (item === null) return;
            this._popoverEl.popdown();
            this._buttonEl.focus();
            activateElementMenuItem(this, item);
            this.dispatchEvent(
                new CustomEvent('menu-item-activated', {
                    bubbles: true,
                    detail: { id: item.id ?? item.label, label: item.label, path: [...path] },
                }),
            );
        });
        this._menuView.setActions(this._actions);

        this._buttonEl.addEventListener('click', () => {
            if (this.hasAttribute('disabled')) return;
            // Nothing to show is not a menu — never open an empty popover.
            if (!this._popoverEl.open && this._slot.isEmpty) return;
            this._popoverEl.open = !this._popoverEl.open;
        });

        // Seed the menu from the attribute if the property was not set — and "not set"
        // is now the ABSENCE of a model, not an empty one, since an empty model is a
        // menu an author may have handed over deliberately.
        if (this._slot.model === null) this._slot.writeMarkup(this.getAttribute('menu-model'));
        // The flat default is set only now the DOM exists, so the observed-attribute
        // callback (which renders) never runs before `_buttonEl` is created.
        if (!this.hasAttribute('flat') && !this.hasAttribute('circular')) this.setAttribute('flat', '');
        this._render();
    }

    attributeChangedCallback(name: string) {
        if (!this._initialized || !this._buttonEl) return;
        if (name === 'menu-model') {
            this._slot.writeMarkup(this.getAttribute('menu-model'));
            this._renderMenu();
            this._notifyModel();
            return;
        }
        this._render();
    }

    private _onPopoverToggled(open: boolean): void {
        this.classList.toggle('active', open);
        this._buttonEl.setAttribute('aria-expanded', String(open));
        if (open) {
            this._refreshActions();
            this._menuView.focusableRows[0]?.focus();
        }
        // A dismissal returns the popup to its top page: a menu that reopens inside a
        // submenu is one the reader cannot get out of.
        else this._menuView.reset();
    }

    private _render(): void {
        const disabled = this.hasAttribute('disabled');
        this.classList.toggle('disabled', disabled);
        this._buttonEl.disabled = disabled;
        if (disabled) this._popoverEl.popdown();
        this.classList.toggle('flat', this.hasAttribute('flat'));
        this.classList.toggle('circular', this.hasAttribute('circular'));
        this._popoverEl.position = POPOVER_POSITIONS[menuButtonPopupDirection(this.direction)];

        this._buttonEl.replaceChildren();
        this._buttonEl.appendChild(
            createGtkImage(this.getAttribute('icon-name') ?? 'open-menu', 'adw-menu-button-icon'),
        );
        this._buttonEl.setAttribute('aria-label', this.getAttribute('menu-title') || 'Menu');

        this._renderMenu();
    }

    /** The registry's answer, unless the application wrote `actions` itself (ADR 0097 § 2). */
    private _refreshActions(): void {
        this._menuView.setActions(this._actions ?? menuActionsOfElement(this, this._slot.tree));
        this._menuView.render();
    }

    /**
     * `gtk_menu_button_set_menu_model` notifies UNCONDITIONALLY — no identity guard, so the
     * same model written twice notifies twice and `null` over `null` notifies as well
     * (measured, `MENU_MODEL_NOTIFY_VECTORS`). Its `Adw.SplitButton` sibling guards on
     * pointer equality, and the two disagree on purpose: a port with one rule for both is
     * wrong about one of them.
     *
     * A MUTATION of the held model is not a write and notifies nothing — it arrives over
     * `items-changed`, where it redraws the rows and stops.
     */
    private _notifyModel(): void {
        this.dispatchEvent(
            new CustomEvent('notify::menu-model', { bubbles: true, detail: { menuModel: this._slot.model } }),
        );
    }

    private _renderMenu(): void {
        this._menuView.setMenuTree(this._slot.tree);
        this._menuView.setTitle(this.getAttribute('menu-title') ?? this._menuTitle);
        this._menuView.render();
        if (this._slot.isEmpty) this._popoverEl.popdown();
    }
}

customElements.define('gtk-menu-button', GtkMenuButton);
