// <adw-dialog> — A generic adaptive dialog: the web counterpart of Adw.Dialog.
// It wraps arbitrary content in a floating card centred over a full-cover scrim
// on wide viewports, and re-anchors it as a bottom sheet (full-width, rounded
// top corners) on narrow ones — the adaptive presentation Adw.Dialog gets for
// free from AdwBreakpoint on GTK. There is no Adw.Breakpoint primitive on the
// web, so the switch is a CSS media query keyed on the `presentation-mode`.
//
// Unlike the specialised dialogs (<adw-alert-dialog>, <adw-preferences-dialog>,
// <adw-about-dialog>) this one imposes no content model of its own: its default
// slot holds any markup, and it renders an OPTIONAL flat header bar (a title +
// a trailing close button) only when a `title` is set or `show-header` is used.
// It is the generic base those specialised dialogs could later be built on.
//
// Like Adw.Dialog it starts hidden; `present()` (or the `open` attribute)
// reveals it and `close()` dismisses it — gated by `can-close` (Escape /
// scrim-click / close-button raise `close-attempt` instead of closing while
// locked). Presenting traps focus inside the dialog and returns it to the
// previously-focused element on close. A disconnected element is attached to
// `document.body` on present (the Adw.Dialog.present(parent) idiom); a
// declaratively-authored dialog already in the DOM is simply revealed in place
// (and stays reusable — close hides, it does not detach).
//
// Attributes:
//   title             (the header title — Adw.Dialog:title; presence renders the header)
//   open              (boolean — whether the dialog is revealed; default hidden)
//   can-close         (boolean — user may dismiss; default on. `="false"` locks it
//                        so a dismissal raises `close-attempt` — Adw.Dialog:can-close)
//   content-width     (max content width in px — Adw.Dialog:content-width; default 360)
//   content-height    (max content height in px — Adw.Dialog:content-height; default unset)
//   presentation-mode (`auto` | `floating` | `bottom-sheet`; default `auto` —
//                        Adw.Dialog:presentation-mode. `auto` = floating when wide,
//                        bottom sheet when narrow)
//   show-header       (boolean — render the header bar even without a title)
//
// Properties: open, title, canClose, contentWidth, contentHeight, presentationMode.
// Methods:    present(), close(), forceClose().
// Events:
//   `notify::open`   (CustomEvent, bubbles, detail = { open }) — revealed state changed.
//   `closed`         (CustomEvent, bubbles) — the dialog finished closing (Adw.Dialog::closed).
//   `close-attempt`  (CustomEvent, bubbles) — a dismissal was attempted while locked
//                      (Adw.Dialog::close-attempt).
//
// Reference: refs/libadwaita/src/adw-dialog.c (present/close/can-close, Escape, focus)
// Reference: refs/libadwaita/src/stylesheet/widgets/_dialogs.scss (floating sheet + bottom sheet)
// Copyright (c) 2023-2024 GNOME Foundation Inc. (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

/** Adaptive presentation of the dialog — mirrors Adw.DialogPresentationMode. */
export type AdwDialogPresentationMode = 'auto' | 'floating' | 'bottom-sheet';

const DEFAULT_CONTENT_WIDTH = 360;
const PRESENTATION_MODES: readonly AdwDialogPresentationMode[] = ['auto', 'floating', 'bottom-sheet'];

// Selector matching the tabbable elements a focus trap must cycle through.
const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(',');

export class AdwDialog extends HTMLElement {
    private _initialized = false;
    private _scrimEl!: HTMLDivElement;
    private _boxEl!: HTMLDivElement;
    private _headerEl!: HTMLDivElement;
    private _titleEl!: HTMLSpanElement;
    private _closeBtn!: HTMLButtonElement;
    private _contentEl!: HTMLDivElement;
    // The element focused before present(), restored on close (return-focus).
    private _previouslyFocused: HTMLElement | null = null;

    static get observedAttributes() {
        return ['title', 'open', 'can-close', 'content-width', 'content-height', 'presentation-mode', 'show-header'];
    }

    /** Whether the dialog is currently revealed. */
    get open(): boolean {
        return this.hasAttribute('open');
    }

    set open(value: boolean) {
        if (value) this.setAttribute('open', '');
        else this.removeAttribute('open');
    }

    /** The header title (Adw.Dialog:title). Setting a title renders the header. */
    get title(): string {
        return this.getAttribute('title') ?? '';
    }

    set title(value: string) {
        this.setAttribute('title', value);
    }

    /** Whether the user can dismiss the dialog (scrim / Escape / close button). */
    get canClose(): boolean {
        const value = this.getAttribute('can-close');
        // Absent → default on; explicit `="false"` → off (mirrors the boxed dialogs).
        if (value === null) return true;
        return value !== 'false';
    }

    set canClose(value: boolean) {
        if (value) this.setAttribute('can-close', '');
        else this.setAttribute('can-close', 'false');
    }

    /** The dialog's preferred/max content width in px (Adw.Dialog:content-width). */
    get contentWidth(): number {
        const raw = Number.parseInt(this.getAttribute('content-width') ?? '', 10);
        return Number.isNaN(raw) ? DEFAULT_CONTENT_WIDTH : raw;
    }

    set contentWidth(value: number) {
        this.setAttribute('content-width', String(value));
    }

    /** The dialog's max content height in px, or 0 for "unconstrained" (Adw.Dialog:content-height). */
    get contentHeight(): number {
        const raw = Number.parseInt(this.getAttribute('content-height') ?? '', 10);
        return Number.isNaN(raw) ? 0 : raw;
    }

    set contentHeight(value: number) {
        if (value > 0) this.setAttribute('content-height', String(value));
        else this.removeAttribute('content-height');
    }

    /** The adaptive presentation mode (Adw.Dialog:presentation-mode). */
    get presentationMode(): AdwDialogPresentationMode {
        const value = this.getAttribute('presentation-mode') as AdwDialogPresentationMode | null;
        return value && PRESENTATION_MODES.includes(value) ? value : 'auto';
    }

    set presentationMode(value: AdwDialogPresentationMode) {
        this.setAttribute('presentation-mode', value);
    }

    /** The content container — arbitrary child markup lives here after connect. */
    get contentArea(): HTMLDivElement {
        return this._contentEl;
    }

    /** Reveal the dialog (mirrors Adw.Dialog.present). Auto-attaches if disconnected. */
    present(parent?: Element): void {
        if (!this.isConnected) (parent ?? document.body).appendChild(this);
        this.open = true;
    }

    /** Dismiss the dialog, respecting `can-close` (mirrors Adw.Dialog.close). */
    close(): void {
        this._attemptClose();
    }

    /** Dismiss the dialog regardless of `can-close` (mirrors Adw.Dialog.force_close). */
    forceClose(): void {
        if (!this.open) return;
        this.open = false;
    }

    connectedCallback() {
        if (this._initialized) {
            // A re-attach (e.g. present() on a previously-connected dialog) must
            // not rebuild the subtree — the DOM already exists.
            return;
        }
        this._initialized = true;

        this.classList.add('adw-dialog');

        // Everything the author placed inside becomes the dialog content.
        const contentChildren = Array.from(this.childNodes);

        // Full-cover scrim — a flex container that centres the box; clicking it
        // (outside the box) attempts to dismiss the dialog.
        this._scrimEl = document.createElement('div');
        this._scrimEl.className = 'adw-dialog-scrim';
        this._scrimEl.addEventListener('click', () => this._attemptClose());

        // The dialog box (the "sheet"). Focusable so it can receive keys even
        // when the content has none; clicks inside must not reach the scrim.
        this._boxEl = document.createElement('div');
        this._boxEl.className = 'adw-dialog-box';
        this._boxEl.setAttribute('role', 'dialog');
        this._boxEl.setAttribute('aria-modal', 'true');
        this._boxEl.tabIndex = -1;
        this._boxEl.addEventListener('click', (event) => event.stopPropagation());
        this._boxEl.addEventListener('keydown', (event) => this._onBoxKeyDown(event));

        // Optional flat header bar (title + trailing close button), strictly
        // centred like an AdwHeaderBar.
        this._headerEl = document.createElement('div');
        this._headerEl.className = 'adw-dialog-header';

        const leading = document.createElement('div');
        leading.className = 'adw-dialog-header-side';

        this._titleEl = document.createElement('span');
        this._titleEl.className = 'adw-dialog-title';

        const trailing = document.createElement('div');
        trailing.className = 'adw-dialog-header-side adw-dialog-header-side--end';

        this._closeBtn = document.createElement('button');
        this._closeBtn.type = 'button';
        this._closeBtn.className = 'adw-dialog-close';
        this._closeBtn.setAttribute('aria-label', 'Close');
        // No `window-close` symbolic ships in @gjsify/adwaita-icons; the "×"
        // glyph is drawn in CSS (same approach as <adw-preferences-dialog>).
        this._closeBtn.addEventListener('click', () => this._attemptClose());
        trailing.appendChild(this._closeBtn);

        this._headerEl.append(leading, this._titleEl, trailing);

        // The content area — the author's markup.
        this._contentEl = document.createElement('div');
        this._contentEl.className = 'adw-dialog-content';
        for (const child of contentChildren) this._contentEl.appendChild(child);

        this._boxEl.append(this._headerEl, this._contentEl);
        this._scrimEl.appendChild(this._boxEl);
        this.replaceChildren(this._scrimEl);

        this._render();
    }

    attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null) {
        if (!this._initialized) return;
        if (oldValue === newValue) return;
        this._render();
        if (name === 'open') {
            this.dispatchEvent(new CustomEvent('notify::open', { bubbles: true, detail: { open: this.open } }));
            if (this.open) this._onPresented();
            else this._onClosed();
        }
    }

    // ── internals ──────────────────────────────────────────────────────────

    /** A dismissal was requested: honour `can-close`, else raise close-attempt. */
    private _attemptClose(): void {
        if (!this.open) return;
        if (!this.canClose) {
            this.dispatchEvent(new CustomEvent('close-attempt', { bubbles: true }));
            return;
        }
        // Drives attributeChangedCallback → notify::open + closed + return-focus.
        this.open = false;
    }

    /** Focus trap + Escape while the box has focus. */
    private _onBoxKeyDown(event: KeyboardEvent): void {
        if (event.key === 'Escape' && this.open) {
            event.stopPropagation();
            this._attemptClose();
            return;
        }
        if (event.key !== 'Tab') return;
        const focusables = this._focusables();
        if (focusables.length === 0) {
            // Nothing tabbable inside — keep focus on the box.
            event.preventDefault();
            this._boxEl.focus();
            return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        if (event.shiftKey && (active === first || active === this._boxEl)) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && active === last) {
            event.preventDefault();
            first.focus();
        }
    }

    private _focusables(): HTMLElement[] {
        return Array.from(this._boxEl.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
            (el) => !el.hasAttribute('disabled') && !el.hidden,
        );
    }

    /** On present: remember focus, then move it into the dialog. */
    private _onPresented(): void {
        const active = document.activeElement;
        this._previouslyFocused = active instanceof HTMLElement && active !== this ? active : null;
        const target = this._focusables()[0] ?? this._boxEl;
        target.focus();
    }

    /** On close: emit `closed` and return focus to where it was before present. */
    private _onClosed(): void {
        this.dispatchEvent(new CustomEvent('closed', { bubbles: true }));
        const restore = this._previouslyFocused;
        this._previouslyFocused = null;
        if (restore && restore.isConnected) restore.focus();
    }

    private _render(): void {
        this.classList.toggle('open', this.open);

        const title = this.title;
        this._titleEl.textContent = title;

        // The header shows when there is a title or the author forces it.
        const hasHeader = title.length > 0 || this.hasAttribute('show-header');
        this._headerEl.hidden = !hasHeader;

        // Presentation mode drives the CSS layout (floating vs bottom sheet).
        this.dataset.presentation = this.presentationMode;

        // Size constraints as CSS custom properties consumed by the box.
        this._boxEl.style.setProperty('--adw-dialog-content-width', `${this.contentWidth}px`);
        const height = this.contentHeight;
        if (height > 0) this._boxEl.style.setProperty('--adw-dialog-content-height', `${height}px`);
        else this._boxEl.style.removeProperty('--adw-dialog-content-height');

        // A locked dialog's close button has no effect; reflect that.
        const locked = !this.canClose;
        this._closeBtn.disabled = locked;
        this._closeBtn.classList.toggle('locked', locked);
    }
}

customElements.define('adw-dialog', AdwDialog);
