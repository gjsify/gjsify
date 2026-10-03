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
//               the surface sits on. Only the placement AXIS is modelled: GTK's
//               `GtkPopover:position` is a `GtkPositionType` whose four values pick a
//               side and then, in GTK, negotiate with the surface for room
//               (`present_popover`); here placement is CSS and nothing measures a rect.
//   autohide  — boolean, default TRUE — GTK's grab. `gtk_popover_map` takes the grab
//               only when it holds (gtkpopover.c:1245-1247) and `gtk_popover_show`
//               focuses the first child only then (gtkpopover.c:1188-1192), so with it
//               off an outside click and an Escape do not dismiss and focus stays where
//               the caller left it. That is entry completion's own shape, which is the
//               usecase the property documents (gtkpopover.c:1978-1988).
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
//   autohide  — whether an outside click dismisses (get/set).
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
// KNOWN_GAPS — the `GtkPopover` scalar properties this element does not observe:
//
//   `cascade-popdown`   GTK closes the ANCESTOR popovers when a child popover takes the
//                       focus (`cascade_popdown`, gtkpopover.c:2455-2478), walking
//                       `gtk_widget_get_parent` upward while each ancestor opts in. A
//                       DOM popup has no focus owner to walk FROM — focus moves without
//                       the element learning of it — so there is no event to hang this on.
//   `has-arrow`         GTK draws the `arrow` node, and `popover > arrow` is a real rule
//                       (_popovers.scss:44-56). Placement here is the `position`/`align`
//                       pair alone, with nothing for an arrow to point at.
//   `mnemonics-visible` GTK underlines the `_` mnemonic of a Pango label
//                       (gtkpopover.c:2034-2041). The labels here are plain text with no
//                       keyval, so there is nothing for the property to reveal.
//
// `child` and `default-widget` are widget-typed, and on this renderer they are SLOTS —
// the exclusion `check-adwaita-element-properties.mjs` already applies to every
// widget-valued property.
//
// Reference: refs/gtk/gtk/gtkpopover.c (autohide :1046, :1188, :1245; the property list)
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
        // GTK's grab is the whole mechanism: `gtk_popover_map` adds it only when
        // `autohide` holds (gtkpopover.c:1245-1247), and without a grab nothing routes an
        // outside click to the popover. So the property is honoured HERE rather than in the
        // markup, and the listener is still bound either way — unbinding it would make the
        // attribute change rebuild the document bindings for a boolean.
        if (!this.autohide) return;
        const target = event.target as Node;
        if (this.contains(target)) return;
        // A click on the anchor is the anchor's own toggle — closing here too would close
        // and immediately reopen (or reopen and immediately close).
        if (this.anchor?.contains(target) === true) return;
        this._state.dismiss();
    };

    private _onDocumentKeyDown = (event: KeyboardEvent): void => {
        if (event.key !== 'Escape') return;
        // Same grab, same gate: with `autohide` off the caret belongs to whatever is
        // behind the surface, and an Escape that closed it would be a keypress with no
        // handler at all.
        if (!this.autohide) return;
        // Captured at the document, so a nested popover's Escape does not also close its
        // parent.
        event.stopPropagation();
        this._state.dismiss();
        this.anchor?.focus();
    };

    static get observedAttributes() {
        return ['open', 'position', 'align', 'role', 'menu', 'autohide'];
    }

    get open(): boolean {
        return this._state.open;
    }

    set open(value: boolean) {
        if (value) this._state.popup();
        else this._state.popdown();
    }

    /**
     * Whether an outside click (or an Escape) dismisses the popover — GTK's grab.
     *
     * `autohide` defaults to TRUE in C (`priv->autohide = TRUE`, gtkpopover.c:1046) and
     * that default is what every existing consumer in this package relies on, so it is
     * the ABSENCE of the attribute rather than its presence, exactly as GTK spells it.
     * Turning it off is entry completion's shape, which is the usecase the property
     * documents: the entry keeps the caret and the list follows the typing.
     */
    get autohide(): boolean {
        return this.getAttribute('autohide') !== 'false';
    }

    set autohide(value: boolean) {
        // `autohide` is a DEFAULT-TRUE boolean, so its attribute form has to be able to
        // say BOTH values: `<gtk-popover autohide="false">` is the only markup spelling
        // of "no grab", and a bare `autohide` cannot be told apart from the default.
        this.setAttribute('autohide', String(value));
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

    /**
     * The navigable rows, in DOM order.
     *
     * HIDDEN rows are skipped — a filtered list navigates what it shows. DISABLED rows
     * are skipped for a harder reason: a disabled `<button>` cannot take focus at all, so
     * `items[index].focus()` is a NO-OP and the arrow key reads as dead. Keeping one in
     * the walk is the same defect a roving tabindex with no keys behind it has, one row
     * wide — measured on a menu whose action group reported an action disabled
     * (ADR 0042): ArrowDown onto it left `document.activeElement` where it was.
     *
     * GTK skips them for the same reason and says so in the general rule rather than in
     * the menu: `gtk_widget_focus_move` walks only widgets `gtk_widget_get_can_focus`
     * accepts, and an insensitive widget is not one.
     */
    get items(): HTMLElement[] {
        return [...this.querySelectorAll<HTMLElement>(ITEM_SELECTOR)].filter(
            (item) => !item.hidden && !(item as HTMLButtonElement).disabled,
        );
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

    /**
     * Every parameter is optional, and that is FOR `<gtk-popover-menu>`, which subclasses
     * this element: an override may not demand a parameter the base signature does not pass,
     * and the platform always passes all three — the `?` is a typescript-visible fact about
     * the CALLER, not about what arrives.
     */
    attributeChangedCallback(name?: string, _previous?: string | null, value?: string | null) {
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
