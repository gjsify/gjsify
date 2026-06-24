// <adw-preferences-dialog> — A modal preferences dialog (the web counterpart of
// Adw.PreferencesDialog). It is a centred floating dialog over a full-cover
// scrim, hosting one or more <adw-preferences-page> children — each a scrollable
// clamp of <adw-preferences-group> boxed lists — under a flat header bar that
// shows the dialog title and a trailing close button.
//
// Pages are declared as <adw-preferences-page> children (each with optional
// `title` / `icon-name` attributes + arbitrary group content); the dialog
// snapshots them at connect time and stacks their content in the scrolled body.
// (Adw shows a view-switcher when there is more than one page and the window is
// wide; the web port renders the pages stacked, matching the single-page common
// case the storybook exercises.)
//
// Like Adw.Dialog the dialog starts hidden; `present()` / setting the `open`
// attribute reveals it. It is dismissed by Escape, by clicking the scrim, or by
// the header close button — each routed through the same close path. When
// `can-close` is false a dismissal raises `close-attempt` instead of closing,
// mirroring Adw.Dialog:can-close / ::close-attempt. The content width follows
// the `content-width` attribute (Adw.Dialog:content-width, default 640 — the
// AdwPreferencesDialog template default).
//
// Attributes:
//   title         (the dialog title shown in the header — Adw.Dialog:title)
//   open          (boolean — whether the dialog is revealed; default hidden)
//   can-close     (boolean — user can dismiss via scrim / Escape / close button;
//                    default on. When off a dismissal raises `close-attempt`
//                    instead — mirrors Adw.Dialog:can-close)
//   content-width (the dialog's preferred width in px; default 640)
//
// Events:
//   `notify::open` (CustomEvent, bubbles, `detail = { open }`) when the revealed
//     state changes — mirrors the Adw.Dialog `open`-ness (presented/closed).
//   `closed` (CustomEvent, bubbles) when the dialog finishes closing — mirrors
//     the Adw.Dialog `closed` signal.
//   `close-attempt` (CustomEvent, bubbles) when a dismissal is attempted while
//     `can-close` is false — mirrors the Adw.Dialog `close-attempt` signal.
//
// Reference: refs/libadwaita/src/adw-preferences-dialog.c (AdwPreferencesDialog)
// Reference: refs/libadwaita/src/adw-preferences-dialog.ui (toolbar/title layout)
// Reference: refs/libadwaita/src/adw-dialog.c (present/close/can-close, Escape)
// Reference: refs/libadwaita/src/stylesheet/widgets/_dialogs.scss (floating sheet)
// Copyright (c) 2023-2024 GNOME Foundation Inc. (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

const DEFAULT_CONTENT_WIDTH = 640;

/**
 * A single preferences page. Child of <adw-preferences-dialog>; consumed at
 * connect time. Carries optional `title` / `icon-name` attributes and any
 * <adw-preferences-group> content — mirrors Adw.PreferencesPage.
 */
export class AdwPreferencesPage extends HTMLElement {
    static get observedAttributes() {
        return ['title', 'icon-name', 'open'];
    }
}

export class AdwPreferencesDialog extends HTMLElement {
    private _initialized = false;
    private _scrimEl!: HTMLDivElement;
    private _dialogEl!: HTMLDivElement;
    private _titleEl!: HTMLSpanElement;
    private _bodyEl!: HTMLDivElement;
    private _closeBtn!: HTMLButtonElement;

    static get observedAttributes() {
        return ['title', 'open', 'can-close', 'content-width'];
    }

    /** Whether the dialog is revealed. */
    get open(): boolean {
        return this.hasAttribute('open');
    }

    set open(value: boolean) {
        if (value) this.setAttribute('open', '');
        else this.removeAttribute('open');
    }

    /** Whether the user can dismiss the dialog (scrim / Escape / close button). */
    get canClose(): boolean {
        const value = this.getAttribute('can-close');
        // Absent → default on; explicit `="false"` → off.
        if (value === null) return true;
        return value !== 'false';
    }

    set canClose(value: boolean) {
        if (value) this.setAttribute('can-close', '');
        else this.setAttribute('can-close', 'false');
    }

    /** The dialog's preferred content width in px (Adw.Dialog:content-width). */
    get contentWidth(): number {
        const raw = Number.parseInt(this.getAttribute('content-width') ?? '', 10);
        return Number.isNaN(raw) ? DEFAULT_CONTENT_WIDTH : raw;
    }

    set contentWidth(value: number) {
        this.setAttribute('content-width', String(value));
    }

    /** Reveal the dialog (mirrors Adw.Dialog.present). */
    present(): void {
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
        if (this._initialized) return;
        this._initialized = true;

        // Snapshot the declared pages before taking over the subtree. Each page's
        // content (its groups) is stacked in the scrolled body; any unwrapped
        // children fall back to the body too (Adw.PreferencesDialog's buildable
        // default adds a child as a page).
        const pages = Array.from(this.querySelectorAll(':scope > adw-preferences-page')) as AdwPreferencesPage[];
        const pageContent = pages.flatMap((page) => Array.from(page.childNodes));
        const claimed = new Set<Node>([...pages, ...pageContent]);
        const unwrapped = Array.from(this.childNodes).filter((node) => !claimed.has(node));

        // Full-cover scrim — clicking it dismisses the dialog (or raises
        // close-attempt when locked).
        this._scrimEl = document.createElement('div');
        this._scrimEl.className = 'adw-preferences-dialog-scrim';
        this._scrimEl.addEventListener('click', () => this._attemptClose());

        // The centred dialog box: a flat header bar (title + close button) above
        // a scrolled preferences body.
        this._dialogEl = document.createElement('div');
        this._dialogEl.className = 'adw-preferences-dialog-box';
        this._dialogEl.setAttribute('role', 'dialog');
        this._dialogEl.setAttribute('aria-modal', 'true');
        // Clicks inside the dialog must not bubble to the scrim's dismiss handler.
        this._dialogEl.addEventListener('click', (event) => event.stopPropagation());

        const header = document.createElement('div');
        header.className = 'adw-preferences-dialog-header';

        // A leading spacer keeps the title visually centred against the trailing
        // close button (the AdwHeaderBar `centering-policy: strict` behaviour).
        const leading = document.createElement('div');
        leading.className = 'adw-preferences-dialog-header-side';

        this._titleEl = document.createElement('span');
        this._titleEl.className = 'adw-preferences-dialog-title';

        const trailing = document.createElement('div');
        trailing.className = 'adw-preferences-dialog-header-side adw-preferences-dialog-header-side--end';

        this._closeBtn = document.createElement('button');
        this._closeBtn.type = 'button';
        this._closeBtn.className = 'adw-preferences-dialog-close';
        this._closeBtn.setAttribute('aria-label', 'Close');
        // No symbolic close icon ships in @gjsify/adwaita-icons; draw the "×"
        // glyph in CSS (same approach as <adw-tab-view>'s close affordance).
        this._closeBtn.addEventListener('click', () => this._attemptClose());
        trailing.appendChild(this._closeBtn);

        header.append(leading, this._titleEl, trailing);

        // Scrolled body — a clamped column of the declared pages' content.
        this._bodyEl = document.createElement('div');
        this._bodyEl.className = 'adw-preferences-dialog-body';

        const clamp = document.createElement('div');
        clamp.className = 'adw-preferences-dialog-pages';
        for (const child of pageContent) clamp.appendChild(child);
        for (const child of unwrapped) clamp.appendChild(child);
        this._bodyEl.appendChild(clamp);

        this._dialogEl.append(header, this._bodyEl);

        this.replaceChildren(this._scrimEl, this._dialogEl);

        // Escape closes the dialog while open (mirrors Adw.Dialog's Escape
        // shortcut → maybe_close_cb). The element is focusable so it can receive
        // the key event when the dialog has focus.
        if (!this.hasAttribute('tabindex')) this.tabIndex = -1;
        this.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && this.open) {
                event.stopPropagation();
                this._attemptClose();
            }
        });

        this._render();
    }

    attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null) {
        if (!this._initialized) return;
        if (oldValue === newValue) return;
        this._render();
        if (name === 'open') {
            this.dispatchEvent(new CustomEvent('notify::open', { bubbles: true, detail: { open: this.open } }));
            if (!this.open) this.dispatchEvent(new CustomEvent('closed', { bubbles: true }));
        }
    }

    private _attemptClose(): void {
        if (!this.open) return;
        if (!this.canClose) {
            this.dispatchEvent(new CustomEvent('close-attempt', { bubbles: true }));
            return;
        }
        // Drives attributeChangedCallback → notify::open + closed.
        this.open = false;
    }

    private _render(): void {
        this.classList.toggle('open', this.open);

        const title = this.getAttribute('title') ?? '';
        this._titleEl.textContent = title;

        this._dialogEl.style.setProperty('--adw-dialog-content-width', `${this.contentWidth}px`);

        // While locked the close button has no effect; reflect that visually +
        // for assistive tech.
        const locked = !this.canClose;
        this._closeBtn.disabled = locked;
        this._closeBtn.classList.toggle('locked', locked);

        // Move focus into the dialog on present so Escape works immediately.
        if (this.open) this.focus();
    }
}

customElements.define('adw-preferences-page', AdwPreferencesPage);
customElements.define('adw-preferences-dialog', AdwPreferencesDialog);
