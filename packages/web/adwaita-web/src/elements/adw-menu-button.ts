// <adw-menu-button> — An icon button that opens a popover menu, the web
// counterpart of Adw.MenuButton / a Gtk.MenuButton. By default it is the flat
// `open-menu-symbolic` primary/app-menu button used at the end of a header bar
// (About / Preferences / Keyboard Shortcuts / Quit …). Clicking it toggles a
// real Adwaita-styled popover positioned under the button; the popover is
// dismissed on an outside click or Escape and supports arrow-key navigation.
//
// The popover is `<adw-popover>` and the dismissal/keyboard machine is
// `@gjsify/adwaita-core`'s (ADR 0004). This element used to build both by hand,
// as did `<adw-drop-down>` and `<adw-split-button>` — three surfaces that
// disagreed with libadwaita and with each other on radius, shadow and padding,
// and two copies of the same `(current ± 1 + n) % n` arithmetic. This element
// keeps only what is a menu button: the icon, the item model, the title.
//
// THE ICON WENT THE SAME WAY, and it is where the drift actually bit: this
// element interpolated `class="adw-icon adw-menu-button-icon adw-icon--<name>"`
// while `<adw-split-button>` — alone among six copies — first checked the name
// was one CSS token. So `icon-name="a b"` shipped a stray `b` class here, and so
// did every JSON menu entry's `icon`. Both are `<adw-icon>` now, and the guard
// is `normalizeIconName`'s.
//
// Attributes:
//   icon-name  — symbolic icon (no `-symbolic` suffix), default `open-menu`.
//   menu-title — optional heading shown atop the popover.
//   menu       — JSON array of items, each `{ "id"?, "label", "icon"? }`.
//   disabled   — boolean; a disabled button does not open the menu.
//   flat       — boolean style class (default: flat, like the header app menu).
//   circular   — boolean style class (round 34×34 button).
//   direction  — none | up | down | left | right (default down); where the
//                popover opens. `none` behaves as `down`, which is
//                Gtk.MenuButton's own rule, not ours — see
//                {@link menuButtonPopupDirection}.
// Properties (mirroring Adw.MenuButton / the NS twin):
//   menuItems  — the menu entries ({ id?, label, icon? }[]) (get/set).
//   menuTitle  — the popover heading (get/set).
//   active     — whether the popover is open (get).
// Events:
//   `menu-item-activated` (CustomEvent, bubbles, detail = { id, label, index })
//     when an item is chosen — `id` falls back to `label` when omitted (matches
//     the NS twin). The popover closes on activation.
// Reference: refs/libadwaita/src/adw-menu-button.c (AdwMenuButton)
// Reference: refs/libadwaita/src/stylesheet/widgets/_menus.scss (popover.menu / modelbutton)
// Reference: packages/nativescript-bridge/adwaita/src/widgets/adw-menu-button.ts (NS twin)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import { isSplitButtonDirection, menuButtonPopupDirection } from '@gjsify/adwaita-core';
import type { SplitButtonDirection } from '@gjsify/adwaita-core';

// SIDE-EFFECT import, deliberately separate from the type import below: it is
// what guarantees `adw-popover` is defined before this module's own
// `customElements.define` can upgrade a server-rendered `<adw-menu-button>` and
// build one. A combined `import { AdwPopover }` would NOT do it — the binding is
// only ever used in type position here, and this package compiles without
// `verbatimModuleSyntax`, so TypeScript would elide the whole statement and take
// the registration with it.
import './adw-popover.js';
import type { AdwPopover } from './adw-popover.js';

import { createAdwIcon } from './adw-icon.js';

/** A menu entry. `id` defaults to `label` on activation; `icon` is optional. */
export interface AdwMenuItem {
    id?: string;
    label: string;
    icon?: string;
}

/**
 * Where the popover sits, per `GtkArrowType`. `menuButtonPopupDirection` folds
 * `none` onto `down` (adw-split-button.c:415 — a pass-through to
 * `gtk_menu_button_set_direction`, so it is GtkMenuButton's rule); this table is
 * only the direction→CSS-axis mapping, which is a renderer fact.
 *
 * `left`/`right` become `start`/`end` because the surface is placed with
 * logical properties, so it follows the writing direction the way GTK's
 * `:dir(rtl)` popovers do.
 */
const POPOVER_POSITIONS = {
    down: 'bottom',
    up: 'top',
    left: 'start',
    right: 'end',
} as const;

export class AdwMenuButton extends HTMLElement {
    private _buttonEl!: HTMLButtonElement;
    private _popoverEl!: AdwPopover;
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

        this._popoverEl = document.createElement('adw-popover') as AdwPopover;
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
        // Default to the flat header idiom unless another variant is requested.
        // Set only now the DOM exists, so the observed-attribute callback (which
        // renders) never runs before `_buttonEl` is created.
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

    private _parseMenuAttr(): AdwMenuItem[] {
        const raw = this.getAttribute('menu');
        if (!raw) return [];
        try {
            const parsed: unknown = JSON.parse(raw);
            if (!Array.isArray(parsed)) return [];
            return parsed
                .filter((e): e is AdwMenuItem => typeof e === 'object' && e !== null && 'label' in e)
                .map((e) => ({ id: e.id, label: String(e.label), icon: e.icon }));
        } catch {
            return [];
        }
    }

    private _onPopoverToggled(open: boolean): void {
        this.classList.toggle('active', open);
        this._buttonEl.setAttribute('aria-expanded', String(open));
        // Move focus into the menu for keyboard navigation.
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
            createAdwIcon(this.getAttribute('icon-name') ?? 'open-menu', 'adw-menu-button-icon'),
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

            // An entry with no USABLE icon gets no icon node at all, rather than
            // an empty 16px box — the element itself answers whether the name
            // resolved, so the `-symbolic`-only and bad-token cases agree.
            const entryIcon = createAdwIcon(entry.icon ?? null, 'adw-menu-button-item-icon');
            if (entryIcon.resolvedIconName !== '') item.appendChild(entryIcon);
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

        // A menu-button with no entries can never open.
        if (this._items.length === 0) this._popoverEl.popdown();
    }
}

customElements.define('adw-menu-button', AdwMenuButton);
