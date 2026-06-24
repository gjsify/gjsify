// <adw-split-button> — Adwaita split button: a primary action button paired
// with an attached dropdown that opens a menu of related actions. The two
// halves are separated by a thin divider; the .suggested-action /
// .destructive-action / .flat style classes recolor the whole control like the
// matching Adwaita button variants.
// Attributes: label, icon-name (symbolic name, e.g. "document-save"; an icon
//   without a label collapses the action half to icon-only), tooltip,
//   dropdown-tooltip, disabled, and the boolean variant flags
//   suggested / destructive / flat.
//   Menu entries are provided as a JSON array on the `menu` attribute, each
//   entry `{ "label": "Save as…", "action": "app.save-as" }`.
// Events (all CustomEvent, bubbles — mirror the Adw.SplitButton GObject signals):
//   `clicked`            — the primary action half was activated.
//   `notify::active`     — the dropdown menu was opened/closed (detail.active).
//   `menu-activated`     — a menu entry was chosen (detail.action / detail.label).
// Reference: refs/libadwaita/src/adw-split-button.c (AdwSplitButton)
// Reference: refs/adwaita-web/adwaita-web/scss/_split_button.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Copyright (c) 2025 csm (adwaita-web). MIT License.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

const VARIANT_CLASSES: Record<string, string> = {
    flat: 'flat',
    suggested: 'suggested-action',
    destructive: 'destructive-action',
};

interface MenuEntry {
    label: string;
    action?: string;
}

export class AdwSplitButton extends HTMLElement {
    private _actionEl!: HTMLButtonElement;
    private _dropdownEl!: HTMLButtonElement;
    private _menuEl!: HTMLDivElement;
    private _label = '';
    private _active = false;
    private _initialized = false;
    private _onDocumentPointerDown = (event: Event): void => {
        if (!this.contains(event.target as Node)) this._setActive(false);
    };

    static get observedAttributes() {
        return [
            'label',
            'icon-name',
            'tooltip',
            'dropdown-tooltip',
            'menu',
            'disabled',
            'flat',
            'suggested',
            'destructive',
        ];
    }

    /** Whether the dropdown menu is currently open. */
    get active(): boolean {
        return this._active;
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        // Capture any inline text as the label before we take over the subtree.
        this._label = (this.getAttribute('label') ?? this.textContent ?? '').trim();

        this.classList.add('adw-split-button');

        this._actionEl = document.createElement('button');
        this._actionEl.type = 'button';
        this._actionEl.className = 'adw-split-button-action';

        this._dropdownEl = document.createElement('button');
        this._dropdownEl.type = 'button';
        this._dropdownEl.className = 'adw-split-button-dropdown';
        const arrow = document.createElement('span');
        arrow.className = 'adw-icon adw-icon--go-down';
        arrow.setAttribute('aria-hidden', 'true');
        this._dropdownEl.appendChild(arrow);

        this._menuEl = document.createElement('div');
        this._menuEl.className = 'adw-split-button-menu';
        this._menuEl.hidden = true;

        this.replaceChildren(this._actionEl, this._dropdownEl, this._menuEl);

        this._actionEl.addEventListener('click', () => {
            if (this.hasAttribute('disabled')) return;
            this.dispatchEvent(new CustomEvent('clicked', { bubbles: true }));
        });
        this._dropdownEl.addEventListener('click', () => {
            if (this.hasAttribute('disabled')) return;
            this._setActive(!this._active);
        });

        this._render();
    }

    disconnectedCallback() {
        document.removeEventListener('pointerdown', this._onDocumentPointerDown);
    }

    attributeChangedCallback() {
        if (this._initialized) this._render();
    }

    private _setActive(active: boolean): void {
        if (this._active === active) return;
        this._active = active;
        this._menuEl.hidden = !active;
        this.classList.toggle('active', active);
        this._dropdownEl.setAttribute('aria-expanded', String(active));
        if (active) {
            document.addEventListener('pointerdown', this._onDocumentPointerDown);
        } else {
            document.removeEventListener('pointerdown', this._onDocumentPointerDown);
        }
        this.dispatchEvent(new CustomEvent('notify::active', { bubbles: true, detail: { active } }));
    }

    private _parseMenu(): MenuEntry[] {
        const raw = this.getAttribute('menu');
        if (!raw) return [];
        try {
            const parsed: unknown = JSON.parse(raw);
            if (!Array.isArray(parsed)) return [];
            return parsed
                .filter((entry): entry is MenuEntry => typeof entry === 'object' && entry !== null && 'label' in entry)
                .map((entry) => ({ label: String(entry.label), action: entry.action }));
        } catch {
            return [];
        }
    }

    private _render() {
        const disabled = this.hasAttribute('disabled');
        this.classList.toggle('disabled', disabled);
        this._actionEl.disabled = disabled;
        this._dropdownEl.disabled = disabled;

        this.classList.remove('flat', 'suggested-action', 'destructive-action');
        for (const [attr, cls] of Object.entries(VARIANT_CLASSES)) {
            if (this.hasAttribute(attr)) this.classList.add(cls);
        }

        // --- Primary action half ---
        const icon = this.getAttribute('icon-name');
        const label = (this.getAttribute('label') ?? this._label).trim();
        this._actionEl.classList.toggle('icon-only', Boolean(icon) && !label);

        this._actionEl.replaceChildren();
        if (icon) {
            const span = document.createElement('span');
            span.className = `adw-icon adw-icon--${icon}`;
            span.setAttribute('aria-hidden', 'true');
            this._actionEl.appendChild(span);
        }
        if (label) this._actionEl.appendChild(document.createTextNode(label));

        const tooltip = this.getAttribute('tooltip');
        this._actionEl.title = tooltip ?? '';
        // An icon-only action half has no text, so give it an accessible name —
        // prefer the tooltip, fall back to the symbolic icon name (WCAG 4.1.2).
        if (icon && !label) {
            this._actionEl.setAttribute('aria-label', tooltip ?? icon);
        } else {
            this._actionEl.removeAttribute('aria-label');
        }

        // --- Dropdown half ---
        const dropdownTooltip = this.getAttribute('dropdown-tooltip');
        this._dropdownEl.title = dropdownTooltip ?? '';
        this._dropdownEl.setAttribute('aria-label', dropdownTooltip ?? 'Menu');
        this._dropdownEl.setAttribute('aria-haspopup', 'menu');
        this._dropdownEl.setAttribute('aria-expanded', String(this._active));

        // --- Menu ---
        const entries = this._parseMenu();
        this._menuEl.replaceChildren();
        this._menuEl.setAttribute('role', 'menu');
        for (const entry of entries) {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'adw-split-button-menu-item';
            item.setAttribute('role', 'menuitem');
            item.textContent = entry.label;
            item.addEventListener('click', () => {
                this._setActive(false);
                this.dispatchEvent(
                    new CustomEvent('menu-activated', {
                        bubbles: true,
                        detail: { label: entry.label, action: entry.action },
                    }),
                );
            });
            this._menuEl.appendChild(item);
        }
        // A split button with no menu entries hides its (empty) popover entirely.
        if (entries.length === 0) this._setActive(false);
    }
}

customElements.define('adw-split-button', AdwSplitButton);
