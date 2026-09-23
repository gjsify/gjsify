// <adw-bottom-sheet> — A content area with a sheet that slides up from the
// bottom edge over the content (the web counterpart of Adw.BottomSheet). The
// content is shown persistently; the sheet is displayed above it when `open` is
// set, with an overlaid drag handle by default. When `modal` is set, a dimming
// layer covers the content and dismisses the sheet on click (unless `can-close`
// is false, in which case a close attempt is signalled instead).
//
// The open/closed state and the dismissal gate are NOT implemented here: they live in
// `@gjsify/adwaita-core` as `BottomSheetPresentation` + `resolveBottomSheetClose`,
// ported from the C source and shared with `@gjsify/adwaita-nativescript` (ADR 0004).
// This element owns only the DOM. Three rules are easy to get wrong:
//   - `open="false"` means CLOSED, like every other boolean here — C's setter is
//     `open = !!open` on a strict gboolean, so `hasAttribute` is the wrong test.
//   - `notify::open` follows the STATE, not the attribute VALUE, so rewriting the
//     attribute to another truthy spelling notifies nobody.
//   - the drag handle is decorative, not a close button — see below.
//
// Children are declared as <adw-bottom-sheet-content> (the persistent content),
// <adw-bottom-sheet-sheet> (the slide-up sheet) and <adw-bottom-sheet-bottom-bar>
// (the collapsed bar shown in its place); all three are consumed at connect time.
// Unslotted children fall back to the content, mirroring the AdwBottomSheet
// GtkBuildable default (omitting the child type sets content).
//
// THE BOTTOM BAR IS THE AFFORDANCE. It is the only thing libadwaita lets a user
// click to OPEN a sheet, so an element without one can be opened by its owner and
// by nobody else. It is a real <button>, because the bin upstream is a GtkButton
// (adw-bottom-sheet.c:1203) — that is where the keyboard activation comes from.
//
// Attributes:
//   open              (boolean — whether the sheet is revealed; default closed)
//   modal             (boolean — dim + block the content while open; default on)
//   can-close         (boolean — user can dismiss via the dimming / Esc / the
//                        sheet.close action; default on. When off, a dismissal
//                        raises `close-attempt` instead of closing — mirrors
//                        Adw.BottomSheet:can-close)
//   can-open          (boolean — user can open the sheet from the bottom bar;
//                        default on. When off the bar stays on screen and gains
//                        the `inert` class, because libadwaita refuses the click
//                        without disabling the button — Adw.BottomSheet:can-open)
//   reveal-bottom-bar (boolean — whether the bottom bar is shown at all while the
//                        sheet is closed; default on)
//   show-drag-handle  (boolean — overlay the drag handle on the sheet; default on)
//
// Events:
//   `notify::open` (CustomEvent, bubbles, `detail = { open }`) when the revealed
//     state changes — mirrors the Adw.BottomSheet `open` GObject property.
//   `close-attempt` (CustomEvent, bubbles) when a dismissal is attempted that the
//     sheet refuses — mirrors the Adw.BottomSheet `close-attempt` signal.
//   `sheet.close` (CustomEvent, bubbles) when the sheet.close action is used on an
//     ALREADY-closed sheet, so an enclosing sheet/dialog can handle it — the DOM
//     equivalent of `gtk_widget_activate_action (parent, "sheet.close")`.
//
// Reference: refs/libadwaita/src/adw-bottom-sheet.c (AdwBottomSheet behaviour)
// Reference: refs/libadwaita/src/stylesheet/widgets/_bottom-sheet.scss
// Copyright (c) 2023-2024 GNOME Foundation Inc. (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import { BottomSheetPresentation } from '@gjsify/adwaita-core';
import type {
    BottomSheetCloseOutcome,
    BottomSheetCloseSource,
    BottomSheetOpenOutcome,
    BottomSheetOpenSource,
} from '@gjsify/adwaita-core';

import { bindSlottedChildren, type AdwSlot } from '../slotted-children.js';

/** The persistent content. Child of <adw-bottom-sheet>; consumed at connect time. */
export class AdwBottomSheetContent extends HTMLElement {}

/** The slide-up sheet. Child of <adw-bottom-sheet>; consumed at connect time. */
export class AdwBottomSheetSheet extends HTMLElement {}

/** The collapsed bar the sheet morphs out of. Child of <adw-bottom-sheet>. */
export class AdwBottomSheetBottomBar extends HTMLElement {}

export class AdwBottomSheet extends HTMLElement {
    private _initialized = false;
    private _contentEl!: HTMLDivElement;
    private _dimmingEl!: HTMLDivElement;
    private _sheetEl!: HTMLDivElement;
    private _sheetBodyEl!: HTMLDivElement;
    private _bottomBarEl!: HTMLButtonElement;
    private _dragHandleEl!: HTMLDivElement;
    /** A bar set through {@link setBottomBar} before the element upgraded. */
    private _pendingBottomBar: Node | null = null;
    /** The shared open/can-close model — the single source of truth for both. */
    private readonly _state = new BottomSheetPresentation();
    /** Set while the element writes `open` back, so the write does not re-enter. */
    private _reflecting = false;

    static get observedAttributes() {
        return ['open', 'modal', 'can-close', 'can-open', 'reveal-bottom-bar', 'show-drag-handle'];
    }

    get open(): boolean {
        return this._state.open;
    }

    set open(value: boolean) {
        this._setOpen(!!value);
    }

    /** Whether the content is dimmed and blocked while the sheet is open (`AdwBottomSheet:modal`). */
    get modal(): boolean {
        return this._state.modal;
    }

    set modal(value: boolean) {
        this._setBoolAttr('modal', value);
    }

    /** Whether the user can dismiss the sheet (dimming / Escape / sheet.close). */
    get canClose(): boolean {
        return this._state.canClose;
    }

    set canClose(value: boolean) {
        this._setBoolAttr('can-close', value);
    }

    /** Whether the user can open the sheet from its bottom bar (`Adw.BottomSheet:can-open`). */
    get canOpen(): boolean {
        return this._state.canOpen;
    }

    set canOpen(value: boolean) {
        this._setBoolAttr('can-open', value);
    }

    /** Whether the bottom bar is shown while the sheet is closed. */
    get revealBottomBar(): boolean {
        return this._state.revealBottomBar;
    }

    set revealBottomBar(value: boolean) {
        this._setBoolAttr('reveal-bottom-bar', value);
    }

    get showDragHandle(): boolean {
        return this._boolAttr('show-drag-handle', true);
    }

    set showDragHandle(value: boolean) {
        this._setBoolAttr('show-drag-handle', value);
    }

    /** The bar's content, or `null` when the sheet has none — the read-back for {@link setBottomBar}. */
    get bottomBar(): Node | null {
        return this._initialized ? this._bottomBarEl.firstChild : this._pendingBottomBar;
    }

    /**
     * Give the sheet a bottom bar, or take it away — `adw_bottom_sheet_set_bottom_bar`.
     *
     * Presence is an INPUT to the open gate, not decoration: removing the bar removes every
     * way a user has of opening this sheet, which is why the state hears about it rather
     * than only the DOM.
     */
    setBottomBar(child: Node | null): void {
        this._state.setHasBottomBar(child !== null);
        if (!this._initialized) {
            this._pendingBottomBar = child;
            return;
        }
        if (child) this._bottomBarEl.replaceChildren(child);
        else this._bottomBarEl.replaceChildren();
        this._render();
    }

    /**
     * Route an open affordance through the shared gate. `'ignored'` is silent by design:
     * libadwaita has no `open-attempt` counterpart to `close-attempt`, so a refused open
     * emits nothing at all.
     */
    requestOpen(source: BottomSheetOpenSource): BottomSheetOpenOutcome {
        return this._state.requestOpen(source);
    }

    /**
     * Route a dismissal affordance through the shared gate and act on the verdict: close,
     * raise `close-attempt`, forward `sheet.close` to an ancestor, or do nothing. Called
     * for the dimming layer and Escape; a close button inside the sheet passes
     * `'close-button'`.
     *
     * The verdict differs PER SOURCE — a locked sheet signals a scrim click but swallows
     * a swipe, and the drag handle never closes anything (`resolveBottomSheetClose`).
     */
    requestClose(source: BottomSheetCloseSource): BottomSheetCloseOutcome {
        const outcome = this._state.requestClose(source);
        if (outcome === 'close-attempt') {
            this.dispatchEvent(new CustomEvent('close-attempt', { bubbles: true }));
        } else if (outcome === 'delegate') {
            this.dispatchEvent(new CustomEvent('sheet.close', { bubbles: true }));
        }
        return outcome;
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        this._contentEl = document.createElement('div');
        this._contentEl.className = 'adw-bottom-sheet-content';

        this._dimmingEl = document.createElement('div');
        this._dimmingEl.className = 'adw-bottom-sheet-dimming';
        this._dimmingEl.addEventListener('click', () => this.requestClose('dimming'));

        this._sheetEl = document.createElement('div');
        this._sheetEl.className = 'adw-bottom-sheet-sheet';

        // libadwaita builds the handle with can_focus = FALSE and can_target = FALSE: a
        // decorative pill that cannot be clicked or focused at all. Its only behavioural
        // role is elsewhere — `allow_mouse_drag = show_drag_handle || bottom_bar`. Giving
        // it role="button" and a click-to-close handler is the one behaviour it provably
        // does not have.
        this._dragHandleEl = document.createElement('div');
        this._dragHandleEl.className = 'adw-bottom-sheet-drag-handle';
        this._dragHandleEl.setAttribute('aria-hidden', 'true');

        this._sheetBodyEl = document.createElement('div');
        this._sheetBodyEl.className = 'adw-bottom-sheet-sheet-body';

        // A real <button>: the bin upstream is `gtk_button_new ()`
        // (adw-bottom-sheet.c:1203), which is where its keyboard activation comes from
        // (`bottom_bar_clicked_cb`, :402-407) — a div with a click handler would have the
        // pointer door and not that one. It is the sheet bin's OTHER stack child, so it
        // lives inside the sheet element and the two swap rather than stacking.
        this._bottomBarEl = document.createElement('button');
        this._bottomBarEl.type = 'button';
        this._bottomBarEl.className = 'adw-bottom-sheet-bottom-bar';
        this._bottomBarEl.addEventListener('click', () => this.requestOpen('bottom-bar'));

        this._sheetEl.append(this._bottomBarEl, this._dragHandleEl, this._sheetBodyEl);

        // The three layers are SLOTS, bound live (`slotted-children.ts`), under the names
        // GtkBuilder gives the properties — `content`, `sheet`, `bottom-bar` — so a projected
        // `.blp` places its children here, and the mount's refusal of an unknown slot can
        // ask this element which names it has. The wrapper elements are the markup spelling
        // of the same three: each is consumed and its children land in the layer. Anything
        // unslotted is content, the AdwBottomSheet GtkBuildable default.
        const layer = (tag: string, into: HTMLElement): AdwSlot => ({
            claims: (node) => node instanceof Element && node.localName === tag,
            consume: (node) => {
                for (const child of Array.from(node.childNodes)) into.appendChild(child);
            },
        });
        bindSlottedChildren(
            this,
            [
                { name: 'sheet', into: this._sheetBodyEl },
                { name: 'bottom-bar', into: this._bottomBarEl },
                { name: 'content', into: this._contentEl },
                layer('adw-bottom-sheet-sheet', this._sheetBodyEl),
                layer('adw-bottom-sheet-bottom-bar', this._bottomBarEl),
                layer('adw-bottom-sheet-content', this._contentEl),
                { into: this._contentEl },
            ],
            (_node, slot) => {
                // A bar adopted after connect is presence, which the open gate reads.
                if (!('into' in slot) || slot.into !== this._bottomBarEl) return;
                this._state.setHasBottomBar(true);
                this._render();
            },
        ).install(this._contentEl, this._dimmingEl, this._sheetEl);

        // A bar handed to `setBottomBar` before the upgrade wins over a declared one, as the
        // later write does in GTK. `hasBottomBar` is re-seeded from the bin below, so the two
        // cannot start out disagreeing about whether there is a bar.
        if (this._pendingBottomBar) this._bottomBarEl.replaceChildren(this._pendingBottomBar);
        this._pendingBottomBar = null;

        // Escape → `maybe_close_cb`. In GTK the shortcut sits on the sheet itself, so it
        // fires exactly while the sheet has focus — INCLUDING while the sheet is closed,
        // which is the corner that still emits `close-attempt`. This port has no focus
        // transfer into the sheet, so an open sheet counts as the focused surface and a
        // closed one only when focus is still inside its (off-screen) body.
        this.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') return;
            if (!this.open && !this._sheetEl.contains(event.target as Node)) return;
            event.stopPropagation();
            this.requestClose('escape');
        });

        // Seeding BEFORE the subscription keeps the initial value silent, which is what
        // an attribute set during upgrade must be.
        this._state.setCanClose(this._boolAttr('can-close', true));
        this._state.setCanOpen(this._boolAttr('can-open', true));
        this._state.setRevealBottomBar(this._boolAttr('reveal-bottom-bar', true));
        // A declared bar counts as present even where nothing called `setBottomBar`.
        this._state.setHasBottomBar(this._bottomBarEl.childNodes.length > 0);
        this._state.setOpen(this._boolAttr('open', false));
        this._state.subscribe((open) => {
            this._render();
            this.dispatchEvent(new CustomEvent('notify::open', { bubbles: true, detail: { open } }));
        });

        this._render();
    }

    attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null) {
        // Our own write-back of `open`; the state already holds this value.
        if (this._reflecting) return;
        if (oldValue === newValue) return;

        // The state is authoritative even before the DOM exists, so an attribute
        // set during upgrade is not lost. Only the rendering half waits.
        if (name === 'open') {
            // A no-op change (one truthy spelling for another) leaves the state
            // alone, so nothing renders and nothing notifies.
            this._state.setOpen(this._boolAttr('open', false));
            return;
        }
        if (name === 'modal') this._state.setModal(this._boolAttr('modal', true));
        if (name === 'can-close') this._state.setCanClose(this._boolAttr('can-close', true));
        if (name === 'can-open') this._state.setCanOpen(this._boolAttr('can-open', true));
        if (name === 'reveal-bottom-bar') this._state.setRevealBottomBar(this._boolAttr('reveal-bottom-bar', true));
        if (this._initialized) this._render();
    }

    /** The programmatic open/close — `AdwBottomSheet:open`, ungated by `can-close`. */
    private _setOpen(open: boolean): void {
        if (!this._state.setOpen(open)) return;
        // Once connected the subscription renders (which reflects the attribute)
        // and notifies; before that there is no DOM, so only the attribute has
        // to be kept in step.
        if (!this._initialized) this._reflectOpen(open);
    }

    private _render(): void {
        const open = this._state.open;
        const chrome = this._state.chrome;
        const showsBar = chrome.layer === 'bottom-bar';
        this._reflectOpen(open);
        this.classList.toggle('open', open);
        this.classList.toggle('modal', this._state.modal);
        this.classList.toggle('has-drag-handle', this.showDragHandle);
        // `showing-bottom-bar` is what holds the sheet at translateY(0) with only the bar
        // exposed; the CSS transform IS this port's `gtk_widget_set_child_visible`, so the
        // bar being hidden and the sheet being off screen are two different states.
        this.classList.toggle('showing-bottom-bar', showsBar && chrome.surfaceVisible);

        this._dimmingEl.classList.toggle('visible', chrome.dimmed);
        this._bottomBarEl.hidden = !showsBar;
        // `inert` only paints. The button stays enabled and focusable exactly as upstream
        // leaves it (adw-bottom-sheet.c:2033-2036); the gate is what refuses the click, and
        // `disabled` here would take the focus stop away with it.
        this._bottomBarEl.classList.toggle('inert', chrome.bottomBarInert);
        this._sheetBodyEl.hidden = showsBar;
        this._dragHandleEl.hidden = !this.showDragHandle || showsBar;
    }

    private _reflectOpen(open: boolean): void {
        this._reflecting = true;
        if (open) this.setAttribute('open', '');
        else this.removeAttribute('open');
        this._reflecting = false;
    }

    /** Read a boolean attribute: absent → `fallback`, explicit `="false"` → off. */
    private _boolAttr(name: string, fallback: boolean): boolean {
        const value = this.getAttribute(name);
        return value === null ? fallback : value !== 'false';
    }

    private _setBoolAttr(name: string, value: boolean): void {
        if (value) this.setAttribute(name, '');
        else this.setAttribute(name, 'false');
    }
}

customElements.define('adw-bottom-sheet-content', AdwBottomSheetContent);
customElements.define('adw-bottom-sheet-sheet', AdwBottomSheetSheet);
customElements.define('adw-bottom-sheet-bottom-bar', AdwBottomSheetBottomBar);
customElements.define('adw-bottom-sheet', AdwBottomSheet);
