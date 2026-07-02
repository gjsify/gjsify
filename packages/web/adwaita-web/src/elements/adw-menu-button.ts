// <adw-menu-button> — An icon button that opens a popover menu, the web
// counterpart of Adw.MenuButton / a Gtk.MenuButton. By default it is the flat
// `open-menu-symbolic` primary/app-menu button used at the end of a header bar
// (About / Preferences / Keyboard Shortcuts / Quit …). Clicking it toggles a
// real Adwaita-styled popover positioned under the button; the popover is
// dismissed on an outside click or Escape and supports arrow-key navigation.
//
// Attributes:
//   icon-name  — symbolic icon (no `-symbolic` suffix), default `open-menu`.
//   menu-title — optional heading shown atop the popover.
//   menu       — JSON array of items, each `{ "id"?, "label", "icon"? }`.
//   disabled   — boolean; a disabled button does not open the menu.
//   flat       — boolean style class (default: flat, like the header app menu).
//   circular   — boolean style class (round 34×34 button).
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

/** A menu entry. `id` defaults to `label` on activation; `icon` is optional. */
export interface AdwMenuItem {
    id?: string;
    label: string;
    icon?: string;
}

export class AdwMenuButton extends HTMLElement {
    private _buttonEl!: HTMLButtonElement;
    private _popoverEl!: HTMLDivElement;
    private _items: AdwMenuItem[] = [];
    private _menuTitle = '';
    private _active = false;
    private _initialized = false;
    private _itemButtons: HTMLButtonElement[] = [];
    private _onDocumentPointerDown = (event: Event): void => {
        if (!this.contains(event.target as Node)) this._setActive(false);
    };
    private _onDocumentKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') {
            this._setActive(false);
            this._buttonEl.focus();
        }
    };

    static get observedAttributes() {
        return ['icon-name', 'menu-title', 'menu', 'disabled', 'flat', 'circular'];
    }

    /** Whether the popover menu is currently open. */
    get active(): boolean {
        return this._active;
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

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        this.classList.add('adw-menu-button');

        this._buttonEl = document.createElement('button');
        this._buttonEl.type = 'button';
        this._buttonEl.className = 'adw-menu-button-button';
        this._buttonEl.setAttribute('aria-haspopup', 'menu');
        this._buttonEl.setAttribute('aria-expanded', 'false');

        this._popoverEl = document.createElement('div');
        this._popoverEl.className = 'adw-menu-button-popover';
        this._popoverEl.setAttribute('role', 'menu');
        this._popoverEl.hidden = true;
        this._popoverEl.addEventListener('keydown', (e) => this._onMenuKeyDown(e));

        this.replaceChildren(this._buttonEl, this._popoverEl);

        this._buttonEl.addEventListener('click', () => {
            if (this.hasAttribute('disabled')) return;
            this._setActive(!this._active);
        });

        // Seed items from the `menu` attribute if the property was not set.
        if (this._items.length === 0) this._items = this._parseMenuAttr();
        // Default to the flat header idiom unless another variant is requested.
        // Set only now the DOM exists, so the observed-attribute callback (which
        // renders) never runs before `_buttonEl` is created.
        if (!this.hasAttribute('flat') && !this.hasAttribute('circular')) this.setAttribute('flat', '');
        this._render();
    }

    disconnectedCallback() {
        document.removeEventListener('pointerdown', this._onDocumentPointerDown);
        document.removeEventListener('keydown', this._onDocumentKeyDown);
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

    private _setActive(active: boolean): void {
        if (this._active === active) return;
        // Only open when there is something to show.
        if (active && this._items.length === 0) return;
        this._active = active;
        this._popoverEl.hidden = !active;
        this.classList.toggle('active', active);
        this._buttonEl.setAttribute('aria-expanded', String(active));
        if (active) {
            document.addEventListener('pointerdown', this._onDocumentPointerDown);
            document.addEventListener('keydown', this._onDocumentKeyDown);
            // Move focus into the menu for keyboard navigation.
            this._itemButtons[0]?.focus();
        } else {
            document.removeEventListener('pointerdown', this._onDocumentPointerDown);
            document.removeEventListener('keydown', this._onDocumentKeyDown);
        }
    }

    private _onMenuKeyDown(event: KeyboardEvent): void {
        const buttons = this._itemButtons;
        if (buttons.length === 0) return;
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        let next = -1;
        if (event.key === 'ArrowDown') next = (current + 1) % buttons.length;
        else if (event.key === 'ArrowUp') next = (current - 1 + buttons.length) % buttons.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = buttons.length - 1;
        else return;
        event.preventDefault();
        buttons[next]?.focus();
    }

    private _render(): void {
        const disabled = this.hasAttribute('disabled');
        this.classList.toggle('disabled', disabled);
        this._buttonEl.disabled = disabled;
        this.classList.toggle('flat', this.hasAttribute('flat'));
        this.classList.toggle('circular', this.hasAttribute('circular'));

        const icon = (this.getAttribute('icon-name') ?? 'open-menu').replace(/-symbolic$/, '');
        this._buttonEl.replaceChildren();
        const iconEl = document.createElement('span');
        iconEl.className = `adw-icon adw-menu-button-icon${icon ? ` adw-icon--${icon}` : ''}`;
        iconEl.setAttribute('aria-hidden', 'true'); // decorative (mask-image only)
        this._buttonEl.appendChild(iconEl);
        this._buttonEl.setAttribute('aria-label', this.getAttribute('menu-title') || 'Menu');

        this._renderMenu();
    }

    private _renderMenu(): void {
        this._popoverEl.replaceChildren();
        this._itemButtons = [];

        const title = this.getAttribute('menu-title') ?? this._menuTitle;
        if (title) {
            const titleEl = document.createElement('div');
            titleEl.className = 'adw-menu-button-title';
            titleEl.textContent = title;
            this._popoverEl.appendChild(titleEl);
        }

        for (const [index, entry] of this._items.entries()) {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'adw-menu-button-item';
            item.setAttribute('role', 'menuitem');
            item.tabIndex = -1;

            const iconName = (entry.icon ?? '').replace(/-symbolic$/, '');
            if (iconName) {
                const iconEl = document.createElement('span');
                iconEl.className = `adw-icon adw-menu-button-item-icon adw-icon--${iconName}`;
                iconEl.setAttribute('aria-hidden', 'true');
                item.appendChild(iconEl);
            }
            const labelEl = document.createElement('span');
            labelEl.className = 'adw-menu-button-item-label';
            labelEl.textContent = entry.label;
            item.appendChild(labelEl);

            item.addEventListener('click', () => {
                this._setActive(false);
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
        if (this._items.length === 0) this._setActive(false);
    }
}

customElements.define('adw-menu-button', AdwMenuButton);
