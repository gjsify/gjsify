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
// The `menu-model` attribute is a JSON array in the portable menu model (ADR 0042) —
// items, sections and submenus, with the same attributes GTK reads. Choosing an item
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

import {
    ADW_MENU_SURFACE_WEB,
    assertMenuRenderable,
    isSplitButtonDirection,
    menuRefusals,
    menuButtonPopupDirection,
    menuItemAt,
    normalizeMenuModel,
    parseMenuModel,
} from '@gjsify/adwaita-core';
import type { AdwMenuActions, AdwMenuInput, AdwMenuModel, SplitButtonDirection } from '@gjsify/adwaita-core';

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

export class GtkMenuButton extends HTMLElement {
    private _buttonEl!: HTMLButtonElement;
    private _popoverEl!: GtkPopover;
    private _model: AdwMenuModel = [];
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

    /** The menu, normalised (ADR 0042). Setting rebuilds the popover. */
    get menuModel(): AdwMenuModel {
        return this._model;
    }

    /**
     * Set the menu from anything the portable model accepts. Refused HERE, at the
     * assignment, for a `custom` item this surface cannot host — see the split button's
     * note on the same setter.
     */
    set menuModel(value: AdwMenuInput) {
        this._model = this._acceptMenu(value);
        if (this._initialized) this._renderMenu();
    }

    /**
     * Normalise, REFUSE, store — the one door every menu comes through.
     *
     * The property setter is not the only way a menu arrives: an attribute is, and the
     * first cut refused only the setter, so a `custom` item written in markup drew
     * exactly the row `assertMenuRenderable` exists to prevent — one that reads like a
     * command and does nothing.
     *
     * THE TWO DOORS REFUSE DIFFERENTLY, and the difference is which side can hear it.
     * A property assignment is a CALL, so it throws and the caller can catch. An
     * attribute is MARKUP, parsed by the browser: a throw from `connectedCallback` is
     * not delivered to whoever appended the element, it is reported as an uncaught
     * page error — measured, it broke `adwaita-upgrade-order.spec.ts`, which counts
     * exactly those. Nobody can handle it and everybody else pays for it. So the
     * attribute path REFUSES THE MENU (no menu, and a menu-less dropdown is
     * insensitive, which is visible) and says why on `console.error`.
     *
     * A REFUSAL AND A TYPO ARE STILL DIFFERENT THINGS. `parseMenuModel` is total
     * because malformed JSON is an author slip and must not stop the element
     * upgrading; `custom` is well-formed, deliberate, and unhonourable here.
     */
    private _acceptMenu(input: AdwMenuInput, strict = true): AdwMenuModel {
        const model = normalizeMenuModel(input);
        if (strict) {
            assertMenuRenderable(model, ADW_MENU_SURFACE_WEB);
            return model;
        }
        const refusals = menuRefusals(model, ADW_MENU_SURFACE_WEB);
        if (refusals.length === 0) return model;
        // `console.error` is the browser's own channel for "this is wrong, the page
        // continues" — and the alternative here is a row that lies.
        console.error(`${ADW_MENU_SURFACE_WEB.name} cannot render this menu, so it has none:`);
        for (const refusal of refusals) console.error(`  [${refusal.path.join('.')}] ${refusal.message}`);
        return [];
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
            const item = menuItemAt(this._model, path);
            if (item === null) return;
            this._popoverEl.popdown();
            this._buttonEl.focus();
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
            if (!this._popoverEl.open && this._model.length === 0) return;
            this._popoverEl.open = !this._popoverEl.open;
        });

        // Seed the menu from the attribute if the property was not set.
        if (this._model.length === 0) this._model = this._parseMenuAttr();
        // The flat default is set only now the DOM exists, so the observed-attribute
        // callback (which renders) never runs before `_buttonEl` is created.
        if (!this.hasAttribute('flat') && !this.hasAttribute('circular')) this.setAttribute('flat', '');
        this._render();
    }

    attributeChangedCallback(name: string) {
        if (!this._initialized || !this._buttonEl) return;
        if (name === 'menu-model') {
            this._model = this._parseMenuAttr();
            this._renderMenu();
            return;
        }
        this._render();
    }

    /**
     * The `menu-model` attribute, through the core parser both elements share.
     *
     * The copy this replaces was weaker in a way markup can reach: it kept `id` and
     * `icon` WHATEVER their runtime type, so `{"label":"Open","id":7}` produced an
     * entry whose `id` is a number in a field typed `string` — and `id` is what the
     * activation event reports. The core parser keeps only string-typed attributes.
     */
    private _parseMenuAttr(): AdwMenuModel {
        return this._acceptMenu(parseMenuModel(this.getAttribute('menu-model')), false);
    }

    private _onPopoverToggled(open: boolean): void {
        this.classList.toggle('active', open);
        this._buttonEl.setAttribute('aria-expanded', String(open));
        if (open) this._menuView.focusableRows[0]?.focus();
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

    private _renderMenu(): void {
        this._menuView.setModel(this._model);
        this._menuView.setTitle(this.getAttribute('menu-title') ?? this._menuTitle);
        this._menuView.render();
        if (this._model.length === 0) this._popoverEl.popdown();
    }
}

customElements.define('gtk-menu-button', GtkMenuButton);
