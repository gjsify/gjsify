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
// All of the behaviour above lives in `@gjsify/adwaita-core` (ADR 0004) as
// {@link SplitButtonState}; this element only paints it and translates DOM events
// into state calls, pinned to the C source by the shared vectors in
// `@gjsify/adwaita-core/conformance` (see `src/split-button.spec.ts`). Of the
// element's own former copies only the glyph→mask-class mapping is a renderer
// concern — see ARROW_MASK_CLASSES. The menu surface is `<gtk-popover>`, which is
// what brings the 15px radius, Escape dismissal and arrow-key navigation; do not
// hand-roll a surface here instead.
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
    splitButtonArrowIcon,
    splitButtonPopupDirection,
    splitButtonRootState,
} from '@gjsify/adwaita-core';
import type { AdwArrowIcon, AdwMenuEntry, SplitButtonChange, SplitButtonDirection } from '@gjsify/adwaita-core';

// SIDE-EFFECT import, deliberately separate from the type import below: it is
// what guarantees `gtk-popover` is defined before this module's own
// `customElements.define` can upgrade a server-rendered `<adw-split-button>` and
// build one. A combined `import { GtkPopover }` would NOT do it — the binding is
// only ever used in type position here, and this package compiles without
// `verbatimModuleSyntax`, so TypeScript would elide the whole statement and take
// the registration with it.
import './gtk-popover.js';
import type { GtkPopover } from './gtk-popover.js';

import { type GtkImage, createGtkImage } from './gtk-image.js';

const VARIANT_CLASSES: Record<string, string> = {
    flat: 'flat',
    suggested: 'suggested-action',
    destructive: 'destructive-action',
};

/**
 * libadwaita's arrow GLYPH NAMES mapped onto the mask classes
 * `_icons.generated.scss` actually ships. Renderer-specific by nature: the icon set
 * here is the `go-*` family, so no `pan-*` mask exists to map onto, and
 * `pan-up-symbolic` reuses `go-down` flipped by the caller rather than drawing a blank
 * arrow.
 *
 * WHICH glyph a direction gets is NOT decided here — {@link splitButtonArrowIcon} owns
 * that, and this table is keyed by its OUTPUT rather than by direction. Keying by
 * direction is how this element came to draw the `open-menu` hamburger for
 * `direction="none"`, where a split button draws the down caret
 * (`splitbutton > menubutton > button > arrow.none`). The mask mapping is a fact about
 * our asset set, the glyph choice a fact about libadwaita.
 */
const ARROW_MASK_CLASSES: Readonly<Record<AdwArrowIcon, string>> = {
    'open-menu-symbolic': 'open-menu',
    'pan-down-symbolic': 'go-down',
    'pan-up-symbolic': 'go-down',
    'pan-start-symbolic': 'go-previous',
    'pan-end-symbolic': 'go-next',
};

// The `-symbolic` strip and the single-CSS-token guard belong to `normalizeIconName`,
// applied by <gtk-image>: never rebuild the mask class by hand, which is how five sites
// in this package shipped without the guard.

/**
 * Direction → the CSS axis `<gtk-popover>` places the surface on. WHICH
 * direction applies is not decided here — {@link splitButtonPopupDirection}
 * folds `none` onto `down` (GtkMenuButton's rule, not the split button's), and
 * this table is keyed by its output for the same reason ARROW_MASK_CLASSES is.
 */
const POPOVER_POSITIONS = {
    down: 'bottom',
    up: 'top',
    left: 'start',
    right: 'end',
} as const;

export class AdwSplitButton extends HTMLElement {
    private readonly _state = new SplitButtonState();
    private _actionEl!: HTMLButtonElement;
    private _dropdownEl!: HTMLButtonElement;
    private _arrowEl!: GtkImage;
    private _menuEl!: GtkPopover;
    /** Inline text content, captured before we take over the subtree. */
    private _inlineLabel = '';
    /** Last `open` value reflected as `notify::active`, so the event fires once per flip. */
    private _openReflected = false;
    private _initialized = false;

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
        // Setting the label clears the icon; mirror that in the DOM so the
        // attributes never contradict the state.
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

    get direction(): SplitButtonDirection {
        return this._state.direction;
    }

    set direction(value: SplitButtonDirection) {
        this.setAttribute('direction', value);
    }

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
        this._arrowEl = createGtkImage(null);
        this._dropdownEl.appendChild(this._arrowEl);

        this._menuEl = document.createElement('gtk-popover') as GtkPopover;
        this._menuEl.classList.add('adw-split-button-menu');
        this._menuEl.setAttribute('role', 'menu');
        // The dropdown half IS a GtkMenuButton (the C passes straight through to
        // one), so its popover is a `popover.menu`.
        this._menuEl.setAttribute('menu', '');
        this._menuEl.setAttribute('align', 'end');

        this.replaceChildren(this._actionEl, this._dropdownEl, this._menuEl);
        // The DROPDOWN half is the anchor, not the whole control: the popover
        // must not treat the half that toggles it as "outside" (it would close
        // and immediately reopen), and Escape returns focus to the half that
        // opened the menu.
        this._menuEl.anchor = this._dropdownEl;
        // The popover is a MIRROR of `SplitButtonState.open`, which stays the
        // single source of truth (`dropdownEnabled`, the root `checked` fold and
        // `notify::active` all read it). A dismissal the popover owns — outside
        // click, Escape — is fed back in here rather than diverging.
        this._menuEl.subscribe((open) => {
            if (!open) this._state.closeMenu();
        });

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

    private _syncStateFromAttributes(): void {
        const label = this.getAttribute('label') ?? (this._inlineLabel.length > 0 ? this._inlineLabel : null);
        const iconName = this.getAttribute('icon-name');
        // With both present the icon wins — exactly where `set_label();
        // set_icon_name();` leaves the widget.
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
     * Route a `label` / `icon-name` attribute mutation into the content machine. C has no
     * independent "unset" for either slot — clearing one is a side effect of setting
     * another — so a REMOVED attribute falls back to whichever sibling is still present,
     * and to the empty child otherwise. Without that fallback
     * `removeAttribute('label')` is a silent no-op and an icon-only button keeps a stale
     * label beside its icon.
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
        const opened = change.open && !this._openReflected;
        if (change.open !== this._openReflected) {
            this._openReflected = change.open;
            this.dispatchEvent(new CustomEvent('notify::active', { bubbles: true, detail: { active: change.open } }));
        }
        this._render();
        // Focus lands in the menu on open, AFTER _render has built the rows —
        // otherwise the popover's arrow keys have nothing to move from.
        if (opened) this._menuEl.items[0]?.focus();
    }

    private _render(): void {
        const disabled = this.hasAttribute('disabled');
        this.classList.toggle('disabled', disabled);
        this._actionEl.disabled = disabled;
        // With neither a menu model nor a popover the dropdown is INSENSITIVE: it must
        // not open an empty popover.
        this._dropdownEl.disabled = disabled || !this._state.dropdownEnabled;

        this.classList.remove('flat', 'suggested-action', 'destructive-action');
        for (const [attribute, cls] of Object.entries(VARIANT_CLASSES)) {
            if (this.hasAttribute(attribute)) this.classList.add(cls);
        }

        this._renderContent();
        this._renderDropdown();
        this._renderMenu();
    }

    private _renderContent(): void {
        const { mode, label, iconName, styleClasses } = this._state;

        // `splitbutton[.image-button][.text-button]` — the documented CSS node contract.
        this.classList.toggle('image-button', styleClasses.includes('image-button'));
        this.classList.toggle('text-button', styleClasses.includes('text-button'));

        this._actionEl.replaceChildren();
        this._actionEl.classList.toggle('icon-only', mode === 'icon');

        if (mode === 'icon' && iconName !== null) {
            this._actionEl.appendChild(createGtkImage(iconName));
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

    private _renderDropdown(): void {
        const { direction, open } = this._state;
        const glyph = splitButtonArrowIcon(direction);
        this._arrowEl.iconName = ARROW_MASK_CLASSES[glyph];
        // No pan-up mask ships yet, so it is the down arrow turned over. Keyed off
        // the GLYPH, not the direction: the flip belongs to the mask substitution.
        this._arrowEl.style.transform = glyph === 'pan-up-symbolic' ? 'rotate(180deg)' : '';
        // Where the popup goes is core's call (`none` → `down`); only the direction →
        // CSS-axis mapping is ours.
        this._menuEl.position = POPOVER_POSITIONS[splitButtonPopupDirection(direction)];

        // An empty value RESTORES the translated default instead of leaving the button
        // without an accessible name.
        const { text } = resolveDropdownTooltip(this._state.dropdownTooltip);
        this._dropdownEl.title = text;
        this._dropdownEl.setAttribute('aria-label', text);
        this._dropdownEl.setAttribute('aria-expanded', String(open));

        // update_state folds both halves onto the root.
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

    private _renderMenu(): void {
        this._menuEl.replaceChildren();
        this._menuEl.open = this._state.open;

        for (const [index, entry] of (this._state.menuModel ?? []).entries()) {
            const item = document.createElement('button');
            item.type = 'button';
            // `.adw-popover-item` is what makes the row navigable: it is the selector
            // `<gtk-popover>` walks for arrow/Home/End/Enter.
            item.className = 'adw-popover-item adw-split-button-menu-item';
            item.setAttribute('role', 'menuitem');
            item.tabIndex = -1;
            item.textContent = entry.label;
            item.addEventListener('click', () => {
                // By position, never by label: two entries called "Copy" are legal
                // and must each dispatch their own action.
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
