// <adw-split-button> — Adwaita split button: a primary action button paired
// with an attached dropdown that opens a menu of related actions. The two
// halves are separated by a thin divider; the .suggested-action /
// .destructive-action / .flat style classes recolor the whole control like the
// matching Adwaita button variants.
//
// Attributes:
//   label            — the action label. MUTUALLY EXCLUSIVE with icon-name.
//   icon-name        — symbolic name (with or without the `-symbolic` suffix).
//   use-underline    — boolean; an underline in the label marks a mnemonic.
//   tooltip          — tooltip/accessible name of the action half.
//   dropdown-tooltip — tooltip of the dropdown half; empty restores "More Options".
//   direction        — none | up | down | left | right (default down).
//   menu             — JSON array of entries, each `{ "label", "action"? }`.
//   disabled, flat, suggested, destructive — boolean flags.
// Events (all CustomEvent, bubbles — mirror the Adw.SplitButton GObject signals):
//   `clicked`         — the primary action half was activated.
//   `notify::active`  — the dropdown menu was opened/closed (detail.active).
//   `notify::<prop>`  — one per GObject property the state machine notified,
//                       in libadwaita's emission order.
//   `menu-activated`  — a menu entry was chosen (detail.label / .action / .index).
//
// All of the behavior above lives in `@gjsify/adwaita-core` (ADR 0004) as
// {@link SplitButtonState}; this element only paints it and translates DOM
// events into state calls. It used to carry its own copy, and that copy rendered
// the label AND the icon together (libadwaita clears whichever slot it is not
// using), could not clear the label at all, hardcoded "Menu" as the dropdown's
// accessible name, and opened an empty popover when there was no menu. The
// shared vectors in `@gjsify/adwaita-core/conformance` now pin this element to
// the C source — see `src/split-button.spec.ts`.
//
// Reference: refs/libadwaita/src/adw-split-button.c (AdwSplitButton)
// Reference: refs/adwaita-web/adwaita-web/scss/_split_button.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Copyright (c) 2025 csm (adwaita-web). MIT License.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import {
    SplitButtonState,
    isSplitButtonDirection,
    parseMenuEntries,
    resolveDropdownTooltip,
    splitButtonRootState,
} from '@gjsify/adwaita-core';
import type { AdwMenuEntry, SplitButtonChange, SplitButtonDirection } from '@gjsify/adwaita-core';

const VARIANT_CLASSES: Record<string, string> = {
    flat: 'flat',
    suggested: 'suggested-action',
    destructive: 'destructive-action',
};

/**
 * libadwaita's arrow glyphs mapped onto the mask classes `_icons.generated.scss`
 * actually ships. `pan-up-symbolic` has no mask here, so `up` reuses the
 * `go-down` mask flipped — the alternative is a blank arrow.
 */
const ARROW_CLASSES: Readonly<Record<SplitButtonDirection, string>> = {
    none: 'open-menu',
    down: 'go-down',
    up: 'go-down',
    left: 'go-previous',
    right: 'go-next',
};

/**
 * The symbolic name as a single CSS class token.
 *
 * The `-symbolic` suffix is stripped (GTK names carry it, the mask classes do
 * not), and anything that is not a class token is dropped rather than
 * interpolated: `icon-name="a b"` used to inject a stray `b` class onto the icon
 * span.
 */
function iconClass(name: string): string {
    const base = name.replace(/-symbolic$/, '');
    return /^[A-Za-z0-9_-]+$/.test(base) ? ` adw-icon--${base}` : '';
}

export class AdwSplitButton extends HTMLElement {
    private readonly _state = new SplitButtonState();
    private _actionEl!: HTMLButtonElement;
    private _dropdownEl!: HTMLButtonElement;
    private _arrowEl!: HTMLSpanElement;
    private _menuEl!: HTMLDivElement;
    /** Inline text content, captured before we take over the subtree. */
    private _inlineLabel = '';
    /** Last `open` value reflected as `notify::active`, so the event fires once per flip. */
    private _openReflected = false;
    private _initialized = false;
    private _onDocumentPointerDown = (event: Event): void => {
        if (!this.contains(event.target as Node)) this._state.closeMenu();
    };

    static get observedAttributes() {
        return [
            'label',
            'icon-name',
            'use-underline',
            'tooltip',
            'dropdown-tooltip',
            'direction',
            'menu',
            'disabled',
            'flat',
            'suggested',
            'destructive',
        ];
    }

    /** Whether the dropdown menu is currently open. */
    get active(): boolean {
        return this._state.open;
    }

    /** Whether the dropdown half is live (there is a menu to show). */
    get dropdownEnabled(): boolean {
        return this._state.dropdownEnabled;
    }

    /** The action label, or `null` when the action half shows an icon or nothing. */
    get label(): string | null {
        return this._state.label;
    }

    set label(value: string) {
        this.setAttribute('label', value ?? '');
        // Setting the label clears the icon (adw-split-button.c:658-659); mirror
        // that in the DOM so the attributes never contradict the state.
        this.removeAttribute('icon-name');
    }

    /** The symbolic icon name, or `null` when the action half shows a label or nothing. */
    get iconName(): string | null {
        return this._state.iconName;
    }

    set iconName(value: string) {
        this.setAttribute('icon-name', value ?? '');
        this.removeAttribute('label');
    }

    /** The dropdown menu entries. */
    get menuItems(): readonly AdwMenuEntry[] {
        return this._state.menuModel ?? [];
    }

    set menuItems(value: readonly AdwMenuEntry[]) {
        this._state.setMenuModel(Array.isArray(value) ? value.map((entry) => ({ ...entry })) : null);
        if (this._initialized) this._render();
    }

    /** The dropdown tooltip as set — `''` while unset. */
    get dropdownTooltip(): string {
        return this._state.dropdownTooltip;
    }

    set dropdownTooltip(value: string) {
        this.setAttribute('dropdown-tooltip', value ?? '');
    }

    /** The direction the popup opens in, and the arrow points. */
    get direction(): SplitButtonDirection {
        return this._state.direction;
    }

    set direction(value: SplitButtonDirection) {
        this.setAttribute('direction', value);
    }

    /** Whether an underline in the label marks a mnemonic. */
    get useUnderline(): boolean {
        return this._state.useUnderline;
    }

    set useUnderline(value: boolean) {
        if (value) this.setAttribute('use-underline', '');
        else this.removeAttribute('use-underline');
    }

    /** Pop the menu up — `adw_split_button_popup()`. */
    popup(): void {
        this._state.openMenu();
    }

    /** Dismiss the menu — `adw_split_button_popdown()`. */
    popdown(): void {
        this._state.closeMenu();
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        // Inline text is the label when no `label` attribute is given. This seed
        // IS trimmed — markup indentation is not part of the value — while an
        // explicit attribute never is, because C keys `text-button` off label[0].
        this._inlineLabel = (this.textContent ?? '').trim();

        this.classList.add('adw-split-button');

        this._actionEl = document.createElement('button');
        this._actionEl.type = 'button';
        this._actionEl.className = 'adw-split-button-action';

        this._dropdownEl = document.createElement('button');
        this._dropdownEl.type = 'button';
        this._dropdownEl.className = 'adw-split-button-dropdown';
        this._dropdownEl.setAttribute('aria-haspopup', 'menu');
        this._arrowEl = document.createElement('span');
        this._arrowEl.setAttribute('aria-hidden', 'true');
        this._dropdownEl.appendChild(this._arrowEl);

        this._menuEl = document.createElement('div');
        this._menuEl.className = 'adw-split-button-menu';
        this._menuEl.setAttribute('role', 'menu');
        this._menuEl.hidden = true;

        this.replaceChildren(this._actionEl, this._dropdownEl, this._menuEl);

        this._actionEl.addEventListener('click', () => {
            if (this.hasAttribute('disabled')) return;
            this.dispatchEvent(new CustomEvent('clicked', { bubbles: true }));
        });
        this._dropdownEl.addEventListener('click', () => {
            if (this.hasAttribute('disabled')) return;
            this._state.toggleMenu();
        });

        // Seed the state from the attributes BEFORE subscribing, so connecting an
        // element does not fire a burst of notify::* for properties that were
        // never "changed" from an author's point of view.
        this._syncStateFromAttributes();
        this._state.subscribe((change) => this._onStateChange(change));
        this._render();
    }

    disconnectedCallback() {
        document.removeEventListener('pointerdown', this._onDocumentPointerDown);
    }

    attributeChangedCallback(name: string, _previous: string | null, value: string | null) {
        if (!this._initialized) return;
        switch (name) {
            case 'label':
            case 'icon-name':
                this._applyContentAttribute(name, value);
                break;
            case 'use-underline':
                this._state.setUseUnderline(value !== null);
                break;
            case 'direction':
                this._state.setDirection(isSplitButtonDirection(value) ? value : 'down');
                break;
            case 'dropdown-tooltip':
                this._state.setDropdownTooltip(value ?? '');
                break;
            case 'menu':
                this._state.setMenuModel(parseMenuEntries(value));
                break;
            default:
                break;
        }
        // A change that the state machine swallowed as a no-op still has to reach
        // the DOM (`tooltip`, `disabled`, the variant flags have no state).
        this._render();
    }

    /** Seed label/icon/menu/direction/tooltip from the attributes present at connect time. */
    private _syncStateFromAttributes(): void {
        const label = this.getAttribute('label') ?? (this._inlineLabel.length > 0 ? this._inlineLabel : null);
        const iconName = this.getAttribute('icon-name');
        // With both present the icon wins — exactly where `set_label();
        // set_icon_name();` leaves the widget (adw-split-button.c:749-771).
        if (label !== null) this._state.setLabel(label);
        if (iconName !== null) this._state.setIconName(iconName);

        this._state.setUseUnderline(this.hasAttribute('use-underline'));
        const direction = this.getAttribute('direction');
        if (isSplitButtonDirection(direction)) this._state.setDirection(direction);
        this._state.setDropdownTooltip(this.getAttribute('dropdown-tooltip') ?? '');
        // The `menuItems` property may have been set before the element upgraded;
        // the attribute only seeds an otherwise empty menu.
        if (this._state.menuModel === null) this._state.setMenuModel(parseMenuEntries(this.getAttribute('menu')));
    }

    /**
     * Route a `label` / `icon-name` attribute mutation into the content machine.
     *
     * C has no independent "unset" for either slot — clearing one is a side
     * effect of setting another — so a REMOVED attribute falls back to whichever
     * sibling is still present, and to the empty child otherwise. That fallback
     * is what makes `removeAttribute('label')` actually drop the label; it used
     * to be a silent no-op, so the storybook's icon-only mode rendered the icon
     * next to a stale "Save".
     */
    private _applyContentAttribute(name: 'label' | 'icon-name', value: string | null): void {
        if (value !== null) {
            if (name === 'label') this._state.setLabel(value);
            else this._state.setIconName(value);
            return;
        }
        const sibling = this.getAttribute(name === 'label' ? 'icon-name' : 'label');
        if (sibling === null) this._state.setChild(null);
        else if (name === 'label') this._state.setIconName(sibling);
        else this._state.setLabel(sibling);
    }

    private _onStateChange(change: SplitButtonChange): void {
        for (const property of change.notified) {
            this.dispatchEvent(new CustomEvent(`notify::${property}`, { bubbles: true }));
        }
        if (change.open !== this._openReflected) {
            this._openReflected = change.open;
            if (change.open) document.addEventListener('pointerdown', this._onDocumentPointerDown);
            else document.removeEventListener('pointerdown', this._onDocumentPointerDown);
            this.dispatchEvent(new CustomEvent('notify::active', { bubbles: true, detail: { active: change.open } }));
        }
        this._render();
    }

    private _render(): void {
        const disabled = this.hasAttribute('disabled');
        this.classList.toggle('disabled', disabled);
        this._actionEl.disabled = disabled;
        // With neither a menu model nor a popover the dropdown is INSENSITIVE
        // (adw-split-button.c:376-378, :394-396) — it must not open an empty
        // popover, which is what the old unguarded click handler did.
        this._dropdownEl.disabled = disabled || !this._state.dropdownEnabled;

        this.classList.remove('flat', 'suggested-action', 'destructive-action');
        for (const [attribute, cls] of Object.entries(VARIANT_CLASSES)) {
            if (this.hasAttribute(attribute)) this.classList.add(cls);
        }

        this._renderContent();
        this._renderDropdown();
        this._renderMenu();
    }

    /** The action half + the root style classes libadwaita derives from it. */
    private _renderContent(): void {
        const { mode, label, iconName, styleClasses } = this._state;

        // `splitbutton[.image-button][.text-button]` — the documented CSS node
        // contract (adw-split-button.c:32-50, :145-165).
        this.classList.toggle('image-button', styleClasses.includes('image-button'));
        this.classList.toggle('text-button', styleClasses.includes('text-button'));

        this._actionEl.replaceChildren();
        this._actionEl.classList.toggle('icon-only', mode === 'icon');

        if (mode === 'icon' && iconName !== null) {
            const icon = document.createElement('span');
            icon.className = `adw-icon${iconClass(iconName)}`;
            icon.setAttribute('aria-hidden', 'true');
            this._actionEl.appendChild(icon);
        } else if (mode === 'label' && label !== null) {
            // Never trimmed: two spaces are a valid label and render as one.
            this._actionEl.appendChild(document.createTextNode(label));
        }

        const tooltip = this.getAttribute('tooltip');
        this._actionEl.title = tooltip ?? '';
        // An icon-only action half has no text, so give it an accessible name —
        // prefer the tooltip, fall back to the symbolic icon name (WCAG 4.1.2).
        if (mode === 'icon') this._actionEl.setAttribute('aria-label', tooltip ?? (iconName || 'Action'));
        else this._actionEl.removeAttribute('aria-label');
    }

    /** The dropdown half: arrow glyph, tooltip/accessible name, expanded state. */
    private _renderDropdown(): void {
        const { direction, open } = this._state;
        this._arrowEl.className = `adw-icon adw-icon--${ARROW_CLASSES[direction]}`;
        // No pan-up mask ships yet, so `up` is the down arrow turned over.
        this._arrowEl.style.transform = direction === 'up' ? 'rotate(180deg)' : '';

        // An empty value RESTORES the translated default (adw-split-button.c:1044-1051)
        // instead of leaving the button without an accessible name.
        const { text } = resolveDropdownTooltip(this._state.dropdownTooltip);
        this._dropdownEl.title = text;
        this._dropdownEl.setAttribute('aria-label', text);
        this._dropdownEl.setAttribute('aria-expanded', String(open));

        // update_state folds both halves onto the root (adw-split-button.c:118-143).
        // The browser gives the ACTIVE half of that fold for free — CSS `:active`
        // matches the ancestors of the pressed element — so only CHECKED, which
        // the arrow half carries while the menu is open, has to be applied here.
        const { checked } = splitButtonRootState(
            { active: false, checked: false, keyboardActivating: false },
            { active: false, checked: open, keyboardActivating: false },
        );
        this.classList.toggle('checked', checked);
        // `.active` predates the lift and stays the open-state hook; libadwaita
        // spells the same state `checked`.
        this.classList.toggle('active', open);
    }

    /** The popover contents, one button per menu entry, dispatched BY POSITION. */
    private _renderMenu(): void {
        this._menuEl.replaceChildren();
        this._menuEl.hidden = !this._state.open;

        for (const [index, entry] of (this._state.menuModel ?? []).entries()) {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'adw-split-button-menu-item';
            item.setAttribute('role', 'menuitem');
            item.textContent = entry.label;
            item.addEventListener('click', () => {
                // By position, never by label: two entries called "Copy" are
                // legal and must dispatch their own action (c:385-388).
                const activated = this._state.activateMenuEntry(index);
                if (activated === null) return;
                this.dispatchEvent(
                    new CustomEvent('menu-activated', {
                        bubbles: true,
                        detail: { label: activated.label, action: activated.action, index },
                    }),
                );
            });
            this._menuEl.appendChild(item);
        }
    }
}

customElements.define('adw-split-button', AdwSplitButton);
