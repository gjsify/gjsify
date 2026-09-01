// <gtk-popover> — the elevated surface that pops up next to an anchor, the web
// counterpart of GtkPopover as libadwaita styles it. It is the ONE popover in this
// package: `<gtk-menu-button>`, `<gtk-drop-down>` and `<adw-split-button>` all use it
// rather than building their own, which is what keeps the 15px radius, the
// three-layer shadow, Escape dismissal and the wrap arithmetic in one place.
//
// The dismissal + keyboard state machine lives in `@gjsify/adwaita-core`
// ({@link PopoverState}, {@link resolvePopoverKey}, ADR 0004); this element owns
// the DOM: the surface node, the document-level listeners, focus movement, and
// the `open` attribute reflection.
//
// PLACEMENT IS CSS, NOT SCRIPT. `_popover.scss` positions the surface off the
// `position` / `align` attributes; nothing here measures a rect or flips on
// overflow, exactly as the three copies never did. Core carries no positioner
// for the same reason — see the module header of `adwaita-core/src/popover.ts`.
//
// Attributes:
//   open      — boolean; reflects (and drives) the visible state.
//   position  — bottom | top | start | end (default bottom) — which side of the anchor
//               the surface sits on. Only the placement axis is modelled:
//               `GtkPopover:position`'s autohide/has-arrow semantics belong to GTK,
//               which libadwaita does not vendor, so they are not guessed at.
//   align     — start | end (default start) — which edge it lines up with.
//   role      — menu | listbox (default menu) — the ARIA role of the surface.
//               An a11y fact ONLY; it does not pick the surface variant, see
//               `menu` below.
//   menu      — boolean; libadwaita's `.menu` STYLE CLASS on the popover node (0
//               padding on the contents, `$menu_margin` on the item box), opt-in
//               exactly as it is in GTK. DO NOT infer it from `role`: `GtkDropDown`'s
//               popover is a `popover.menu` too (`dropdown { popover.menu { … } }`)
//               while its rows are `option`s, not `menuitem`s, so tying the surface to
//               the role pads the drop-down like a bare content popover.
// Properties:
//   open      — whether the popover is showing (get/set).
//   anchor    — the element the surface is positioned against and returns focus
//               to. Defaults to `parentElement` (get/set).
//   items     — the navigable rows, in DOM order (get). Used for keyboard moves.
// Methods (GtkPopover's own vocabulary):
//   popup()   — show it.  popdown() — hide it.
// Events:
//   `notify::open` (CustomEvent, bubbles, detail = { open }) — mirrors the
//     GObject property-notify; fires on every change, programmatic included.
//   `popover-item-activated` (CustomEvent, bubbles, detail = { index }) — a row
//     was chosen by keyboard. Click activation stays the row's own listener.
//
// Reference: refs/libadwaita/src/stylesheet/widgets/_popovers.scss (popover > contents)
// Reference: refs/libadwaita/src/stylesheet/widgets/_menus.scss (popover.menu, modelbutton)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import { PopoverState, resolvePopoverKey } from '@gjsify/adwaita-core';

/** Which side of the anchor the surface sits on. */
export type GtkPopoverPosition = 'bottom' | 'top' | 'start' | 'end';

/** Which edge of the anchor the surface lines up with. */
export type GtkPopoverAlign = 'start' | 'end';

/** The ARIA role of the surface — it decides the row role consumers give their items. */
export type GtkPopoverRole = 'menu' | 'listbox';

const POSITIONS: readonly GtkPopoverPosition[] = ['bottom', 'top', 'start', 'end'];
const ALIGNS: readonly GtkPopoverAlign[] = ['start', 'end'];
const ROLES: readonly GtkPopoverRole[] = ['menu', 'listbox'];

/** The row selector keyboard navigation walks. */
const ITEM_SELECTOR = '.adw-popover-item';

export class GtkPopover extends HTMLElement {
    private readonly _state = new PopoverState();
    private _anchor: HTMLElement | null = null;
    private _initialized = false;
    /** Guards the `open` attribute↔property loop, which would otherwise recurse. */
    private _reflecting = false;

    private _onDocumentPointerDown = (event: Event): void => {
        const target = event.target as Node;
        if (this.contains(target)) return;
        // A click on the anchor is the anchor's own toggle — closing here too would close
        // and immediately reopen (or reopen and immediately close).
        if (this.anchor?.contains(target) === true) return;
        this._state.dismiss();
    };

    private _onDocumentKeyDown = (event: KeyboardEvent): void => {
        if (event.key !== 'Escape') return;
        // Captured at the document, so a nested popover's Escape does not also close its
        // parent.
        event.stopPropagation();
        this._state.dismiss();
        this.anchor?.focus();
    };

    static get observedAttributes() {
        return ['open', 'position', 'align', 'role', 'menu'];
    }

    get open(): boolean {
        return this._state.open;
    }

    set open(value: boolean) {
        if (value) this._state.popup();
        else this._state.popdown();
    }

    /**
     * The element the surface is positioned against and hands focus back to. Defaults to
     * `parentElement`: the popover is normally the last child of the widget that owns it.
     */
    get anchor(): HTMLElement | null {
        return this._anchor ?? this.parentElement;
    }

    set anchor(value: HTMLElement | null) {
        this._anchor = value;
    }

    get position(): GtkPopoverPosition {
        const value = this.getAttribute('position');
        return POSITIONS.includes(value as GtkPopoverPosition) ? (value as GtkPopoverPosition) : 'bottom';
    }

    set position(value: GtkPopoverPosition) {
        this.setAttribute('position', value);
    }

    get align(): GtkPopoverAlign {
        const value = this.getAttribute('align');
        return ALIGNS.includes(value as GtkPopoverAlign) ? (value as GtkPopoverAlign) : 'start';
    }

    set align(value: GtkPopoverAlign) {
        this.setAttribute('align', value);
    }

    get popoverRole(): GtkPopoverRole {
        const value = this.getAttribute('role');
        return ROLES.includes(value as GtkPopoverRole) ? (value as GtkPopoverRole) : 'menu';
    }

    /** The navigable rows, in DOM order. Hidden rows are skipped — a filtered list navigates what it shows. */
    get items(): HTMLElement[] {
        return [...this.querySelectorAll<HTMLElement>(ITEM_SELECTOR)].filter((item) => !item.hidden);
    }

    /** Show the popover — `gtk_popover_popup()`. */
    popup(): void {
        this._state.popup();
    }

    /** Hide the popover — `gtk_popover_popdown()`. */
    popdown(): void {
        this._state.popdown();
    }

    /** Subscribe to open-state changes. Returns an unsubscribe function. */
    subscribe(listener: (open: boolean) => void): () => void {
        return this._state.subscribe((change) => listener(change.open));
    }

    connectedCallback() {
        this._buildOnce();
        // EVERY connect, not only the first. The document listeners are bound from
        // `_onStateChange` and released by `disconnectedCallback`, so a popover that was
        // OPEN when it moved — a slideshow slide, a client-side route change — comes back
        // visible with neither outside-click nor Escape dismissal, and no state change
        // left to re-arm them: the only ways out are the two that just died. Idempotent
        // by construction, the same function references and capture flag the unbind uses.
        if (this._state.open) this._bindDocument();
    }

    private _buildOnce() {
        if (this._initialized) return;
        this._initialized = true;

        this.classList.add('adw-popover');
        if (!this.hasAttribute('role')) this.setAttribute('role', 'menu');
        // The `menu` variant is NOT defaulted or inferred here — it is GTK's `.menu`
        // style class, added by the widget that owns the popover, as in the C.

        this.addEventListener('keydown', (event) => this._onKeyDown(event));
        this._state.subscribe((change) => this._onStateChange(change.open));

        // The `open` attribute may already be present in server-rendered markup.
        if (this.hasAttribute('open')) this._state.popup();
        this._render();
    }

    disconnectedCallback() {
        this._unbindDocument();
    }

    attributeChangedCallback(name: string, _previous: string | null, value: string | null) {
        if (!this._initialized) return;
        if (name === 'open') {
            if (this._reflecting) return;
            if (value !== null) this._state.popup();
            else this._state.popdown();
            return;
        }
        if (name === 'role' && value === null) {
            // A removed role falls back to the default rather than leaving the surface
            // unlabelled to assistive tech.
            this.setAttribute('role', 'menu');
            return;
        }
        this._render();
    }

    private _onStateChange(open: boolean): void {
        if (open) this._bindDocument();
        else this._unbindDocument();

        this._reflecting = true;
        if (open) this.setAttribute('open', '');
        else this.removeAttribute('open');
        this._reflecting = false;

        this._render();
        this.dispatchEvent(new CustomEvent('notify::open', { bubbles: true, detail: { open } }));
    }

    private _bindDocument(): void {
        document.addEventListener('pointerdown', this._onDocumentPointerDown);
        // Capture, so Escape reaches us before a focused child swallows it.
        document.addEventListener('keydown', this._onDocumentKeyDown, true);
    }

    private _unbindDocument(): void {
        document.removeEventListener('pointerdown', this._onDocumentPointerDown);
        document.removeEventListener('keydown', this._onDocumentKeyDown, true);
    }

    private _render(): void {
        this.hidden = !this._state.open;
        this.dataset.position = this.position;
        this.dataset.align = this.align;
    }

    /**
     * Arrow/Home/End/Enter/Space inside the surface. The arithmetic is core's
     * ({@link resolvePopoverKey}); this only maps its answer onto the DOM.
     *
     * Escape is NOT handled here — it is bound at the document in capture phase
     * so it works no matter where focus sits, including a search entry inside
     * the popover.
     */
    private _onKeyDown(event: KeyboardEvent): void {
        if (!this._state.open) return;
        const items = this.items;
        const active = document.activeElement as HTMLElement | null;
        const currentIndex = active === null ? -1 : items.indexOf(active);
        const hasSearch = this.querySelector('input, textarea') !== null;

        const { action, index } = resolvePopoverKey(event.key, {
            itemCount: items.length,
            currentIndex,
            hasSearch,
        });

        if (action === 'focus') {
            event.preventDefault();
            items[index]?.focus();
            return;
        }
        if (action === 'activate') {
            // preventDefault BEFORE the synthetic click: a focused <button> activates
            // natively on Enter (keydown) and Space (keyup), so the row would fire twice.
            event.preventDefault();
            items[index]?.click();
            this.dispatchEvent(new CustomEvent('popover-item-activated', { bubbles: true, detail: { index } }));
        }
        // 'close' arrives through the document capture handler; 'none' is not ours.
    }
}

customElements.define('gtk-popover', GtkPopover);
