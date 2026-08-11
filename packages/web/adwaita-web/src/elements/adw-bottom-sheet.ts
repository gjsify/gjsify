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
// Children are declared as <adw-bottom-sheet-content> (the persistent content)
// and <adw-bottom-sheet-sheet> (the slide-up sheet); both are consumed at
// connect time. Unslotted children fall back to the content, mirroring the
// AdwBottomSheet GtkBuildable default (omitting the child type sets content).
//
// Attributes:
//   open             (boolean — whether the sheet is revealed; default closed)
//   modal            (boolean — dim + block the content while open; default on)
//   can-close        (boolean — user can dismiss via the dimming / Esc / the
//                       sheet.close action; default on. When off, a dismissal
//                       raises `close-attempt` instead of closing — mirrors
//                       Adw.BottomSheet:can-close)
//   show-drag-handle (boolean — overlay the drag handle on the sheet; default on)
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
import type { BottomSheetCloseOutcome, BottomSheetCloseSource } from '@gjsify/adwaita-core';

/** The persistent content. Child of <adw-bottom-sheet>; consumed at connect time. */
export class AdwBottomSheetContent extends HTMLElement {}

/** The slide-up sheet. Child of <adw-bottom-sheet>; consumed at connect time. */
export class AdwBottomSheetSheet extends HTMLElement {}

export class AdwBottomSheet extends HTMLElement {
    private _initialized = false;
    private _contentEl!: HTMLDivElement;
    private _dimmingEl!: HTMLDivElement;
    private _sheetEl!: HTMLDivElement;
    private _dragHandleEl!: HTMLDivElement;
    /** The shared open/can-close model — the single source of truth for both. */
    private readonly _state = new BottomSheetPresentation();
    /** Set while the element writes `open` back, so the write does not re-enter. */
    private _reflecting = false;

    static get observedAttributes() {
        return ['open', 'modal', 'can-close', 'show-drag-handle'];
    }

    get open(): boolean {
        return this._state.open;
    }

    set open(value: boolean) {
        this._setOpen(!!value);
    }

    get modal(): boolean {
        return this._boolAttr('modal', true);
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

    get showDragHandle(): boolean {
        return this._boolAttr('show-drag-handle', true);
    }

    set showDragHandle(value: boolean) {
        this._setBoolAttr('show-drag-handle', value);
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

        // The sheet and content are placed by slot; anything unslotted falls back to the
        // content (the AdwBottomSheet GtkBuildable default).
        const claimed = new Set<Node>();
        const sheetChildren = this._collectSlot('adw-bottom-sheet-sheet', 'sheet', claimed);
        const contentChildren = this._collectSlot('adw-bottom-sheet-content', 'content', claimed);
        const unslotted = Array.from(this.childNodes).filter((n) => !claimed.has(n));

        this._contentEl = document.createElement('div');
        this._contentEl.className = 'adw-bottom-sheet-content';
        for (const child of contentChildren) this._contentEl.appendChild(child);
        for (const child of unslotted) this._contentEl.appendChild(child);

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

        const sheetBody = document.createElement('div');
        sheetBody.className = 'adw-bottom-sheet-sheet-body';
        for (const child of sheetChildren) sheetBody.appendChild(child);

        this._sheetEl.append(this._dragHandleEl, sheetBody);

        this.replaceChildren(this._contentEl, this._dimmingEl, this._sheetEl);

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
        if (name === 'can-close') this._state.setCanClose(this._boolAttr('can-close', true));
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
        this._reflectOpen(open);
        this.classList.toggle('open', open);
        this.classList.toggle('modal', this.modal);
        this.classList.toggle('has-drag-handle', this.showDragHandle);

        this._dimmingEl.classList.toggle('visible', open && this.modal);
        this._dragHandleEl.hidden = !this.showDragHandle;
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

    /**
     * Collect the nodes declared for one slot, in DOCUMENT order, marking every
     * consumed child in `claimed`.
     *
     * The `<adw-bottom-sheet-sheet>` / `<adw-bottom-sheet-content>` wrappers are
     * markup, not widgets — GtkBuilder's `<child type="sheet">` leaves nothing in
     * the tree — so the wrapper itself is claimed
     * too. It used to fall through to `unslotted` and be appended to the content
     * layer, leaving an empty custom element behind after its children were
     * pulled out.
     */
    private _collectSlot(tag: string, slot: string, claimed: Set<Node>): Node[] {
        const nodes: Node[] = [];
        for (const child of Array.from(this.children)) {
            if (child.tagName.toLowerCase() === tag) {
                claimed.add(child);
                nodes.push(...Array.from(child.childNodes));
            } else if (child.getAttribute('slot') === slot) {
                claimed.add(child);
                nodes.push(child);
            }
        }
        return nodes;
    }
}

customElements.define('adw-bottom-sheet-content', AdwBottomSheetContent);
customElements.define('adw-bottom-sheet-sheet', AdwBottomSheetSheet);
customElements.define('adw-bottom-sheet', AdwBottomSheet);
