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
// The `menu` attribute is a JSON array of `{ "id"?, "label", "icon"? }`. Choosing an
// item closes the popover and fires `menu-item-activated` (CustomEvent, bubbles,
// detail `{ id, label, index }`) with `id` falling back to `label`, matching the NS
// twin.
//
// Reference: refs/gtk/gtk/gtkmenubutton.c (GtkMenuButton)
// Reference: refs/libadwaita/src/stylesheet/widgets/_buttons.scss (menubutton)
// Reference: refs/libadwaita/src/stylesheet/widgets/_menus.scss (popover.menu / modelbutton)
// Reference: packages/nativescript-bridge/adwaita/src/widgets/adw-menu-button.ts (NS twin)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import {
    isSplitButtonDirection,
    menuButtonPopupDirection,
    parseMenuEntries,
    stringIsNotEmpty,
} from '@gjsify/adwaita-core';
import type { AdwMenuEntry, SplitButtonDirection } from '@gjsify/adwaita-core';

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
 * A menu entry — `@gjsify/adwaita-core`'s {@link AdwMenuEntry} under the name both
 * renderers export it as.
 *
 * IT KEEPS THE `Adw` PREFIX WHILE THE ELEMENT ABOVE IT DOES NOT, and the reason is not
 * "the name it has always used" — ADR 0034 clause 1 just moved every name in this file
 * that had one. It is that this is not a WIDGET name: clause 1 is about the tag, and
 * this is the descriptor a consumer writes menu entries with. `@gjsify/adwaita-
 * nativescript` exports `AdwMenuItem` for the same type, and that port deliberately
 * keeps `Adw` throughout, so renaming this half would give one object two spellings —
 * which is the thing the ADR is removing, not applying. (`GtkDropDownOption` next door
 * DID move: its NativeScript twin exports no such name, so there was nothing to split.)
 *
 * It used to be a SECOND declaration of the same shape, and the NativeScript menu
 * button declared a THIRD that was missing `icon` entirely. One type, so a consumer
 * writing menu entries writes the same object for either renderer.
 */
export type AdwMenuItem = AdwMenuEntry;

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
    private _items: AdwMenuItem[] = [];
    private _menuTitle = '';
    private _initialized = false;
    private _itemButtons: HTMLButtonElement[] = [];

    static get observedAttributes() {
        return ['icon-name', 'menu-title', 'menu', 'disabled', 'flat', 'circular', 'direction'];
    }

    /** Whether the popover menu is currently open. */
    get active(): boolean {
        return this._popoverEl?.open ?? false;
    }

    /** The menu entries. Setting rebuilds the popover. */
    get menuItems(): AdwMenuItem[] {
        return this._items;
    }

    set menuItems(value: AdwMenuItem[]) {
        this._items = Array.isArray(value) ? value.map((it) => ({ ...it })) : [];
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

        this._buttonEl.addEventListener('click', () => {
            if (this.hasAttribute('disabled')) return;
            // Nothing to show is not a menu — never open an empty popover.
            if (!this._popoverEl.open && this._items.length === 0) return;
            this._popoverEl.open = !this._popoverEl.open;
        });

        // Seed items from the `menu` attribute if the property was not set.
        if (this._items.length === 0) this._items = this._parseMenuAttr();
        // The flat default is set only now the DOM exists, so the observed-attribute
        // callback (which renders) never runs before `_buttonEl` is created.
        if (!this.hasAttribute('flat') && !this.hasAttribute('circular')) this.setAttribute('flat', '');
        this._render();
    }

    attributeChangedCallback(name: string) {
        if (!this._initialized || !this._buttonEl) return;
        if (name === 'menu') {
            this._items = this._parseMenuAttr();
            this._renderMenu();
            return;
        }
        this._render();
    }

    /**
     * The `menu` attribute, through the core parser the split button already used.
     *
     * The copy this replaces was weaker in a way markup can reach: it kept `id` and
     * `icon` WHATEVER their runtime type, so `{"label":"Open","id":7}` produced an
     * entry whose `id` is a number in a field typed `string` — and `id` is what the
     * activation event reports. The core parser keeps only string-typed extras.
     */
    private _parseMenuAttr(): AdwMenuItem[] {
        return parseMenuEntries(this.getAttribute('menu'));
    }

    private _onPopoverToggled(open: boolean): void {
        this.classList.toggle('active', open);
        this._buttonEl.setAttribute('aria-expanded', String(open));
        if (open) this._itemButtons[0]?.focus();
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
        this._popoverEl.replaceChildren();
        this._itemButtons = [];

        const title = this.getAttribute('menu-title') ?? this._menuTitle;
        if (title) {
            const titleEl = document.createElement('div');
            titleEl.className = 'adw-popover-title adw-menu-button-title';
            titleEl.textContent = title;
            this._popoverEl.appendChild(titleEl);
        }

        for (const [index, entry] of this._items.entries()) {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'adw-popover-item adw-menu-button-item';
            item.setAttribute('role', 'menuitem');
            item.tabIndex = -1;

            // An entry that asked for NO icon gets no icon node — the emptiness of the
            // declared name, not whether it resolved. Testing `resolvedIconName` dropped
            // the node for a name that was given and merely undrawable, which is the one
            // case a reader needs to SEE; `<gtk-image>` draws `image-missing` there.
            const entryIcon = createGtkImage(entry.icon ?? null, 'adw-menu-button-item-icon');
            if (stringIsNotEmpty(entry.icon)) item.appendChild(entryIcon);
            const labelEl = document.createElement('span');
            labelEl.className = 'adw-menu-button-item-label';
            labelEl.textContent = entry.label;
            item.appendChild(labelEl);

            item.addEventListener('click', () => {
                this._popoverEl.popdown();
                this._buttonEl.focus();
                this.dispatchEvent(
                    new CustomEvent('menu-item-activated', {
                        bubbles: true,
                        detail: { id: entry.id ?? entry.label, label: entry.label, index },
                    }),
                );
            });
            this._popoverEl.appendChild(item);
            this._itemButtons.push(item);
        }

        if (this._items.length === 0) this._popoverEl.popdown();
    }
}

customElements.define('gtk-menu-button', GtkMenuButton);
