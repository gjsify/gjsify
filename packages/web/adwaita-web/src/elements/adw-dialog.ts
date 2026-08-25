// <adw-dialog> — the web counterpart of Adw.Dialog: arbitrary content in a floating
// card over a full-cover scrim on wide viewports, re-anchored as a bottom sheet
// (full-width, rounded top corners) on narrow ones. The adaptive switch is a CSS
// media query keyed on `presentation-mode`, not an AdwBreakpoint object.
//
// Unlike the specialised dialogs (<adw-alert-dialog>, <adw-preferences-dialog>,
// <adw-about-dialog>) this one imposes no content model of its own: its default slot
// holds any markup, and the flat header bar (title + trailing close button) renders
// only when a `title` is set or `show-header` is used.
//
// Starts hidden; `present()` (or the `open` attribute) reveals it and `close()`
// dismisses it — gated by `can-close`, so while locked Escape / scrim-click /
// close-button raise `close-attempt` instead. Presenting traps focus inside the
// dialog and returns it to the previously-focused element on close. A DISCONNECTED
// element is attached to `document.body` on present (the Adw.Dialog.present(parent)
// idiom); one already in the DOM is revealed in place and stays reusable — close
// hides, it does not detach.
//
// Events, all bubbling CustomEvents: `notify::open` (detail `{ open }`), `closed`
// (Adw.Dialog::closed), `close-attempt` (Adw.Dialog::close-attempt).
//
// Reference: refs/libadwaita/src/adw-dialog.c (present/close/can-close, Escape, focus)
// Reference: refs/libadwaita/src/stylesheet/widgets/_dialogs.scss (floating sheet + bottom sheet)
// Copyright (c) 2023-2024 GNOME Foundation Inc. (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import { bindSlottedChildren } from '../slotted-children.js';
import { AdwModalSurface } from './modal-surface.js';

/** Adaptive presentation of the dialog — mirrors Adw.DialogPresentationMode. */
export type AdwDialogPresentationMode = 'auto' | 'floating' | 'bottom-sheet';

const DEFAULT_CONTENT_WIDTH = 360;
const PRESENTATION_MODES: readonly AdwDialogPresentationMode[] = ['auto', 'floating', 'bottom-sheet'];

export class AdwDialog extends HTMLElement {
    private _initialized = false;
    private _scrimEl!: HTMLDivElement;
    private _boxEl!: HTMLDivElement;
    private _headerEl!: HTMLDivElement;
    private _titleEl!: HTMLSpanElement;
    private _closeBtn!: HTMLButtonElement;
    private _contentEl!: HTMLDivElement;
    private _modal!: AdwModalSurface;

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
            // A re-attach (present() on a previously-connected dialog) must not rebuild
            // the subtree — the DOM already exists.
            return;
        }
        this._initialized = true;

        this.classList.add('adw-dialog');

        this._scrimEl = document.createElement('div');
        this._scrimEl.className = 'adw-dialog-scrim';
        this._scrimEl.addEventListener('click', () => this._attemptClose());

        // Clicks inside must not reach the scrim's dismiss handler. The role, `aria-modal`
        // and the -1 tabindex that lets the box hold focus when its content has none all
        // come from the modal surface below.
        this._boxEl = document.createElement('div');
        this._boxEl.className = 'adw-dialog-box';
        this._boxEl.addEventListener('click', (event) => event.stopPropagation());
        this._modal = new AdwModalSurface({
            host: this,
            surface: this._boxEl,
            role: 'dialog',
            isOpen: () => this.open,
            onEscape: () => this._attemptClose(),
        });

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
        // The "×" glyph is drawn in CSS (same approach as <adw-preferences-dialog>).
        this._closeBtn.addEventListener('click', () => this._attemptClose());
        trailing.appendChild(this._closeBtn);

        this._headerEl.append(leading, this._titleEl, trailing);

        this._contentEl = document.createElement('div');
        this._contentEl.className = 'adw-dialog-content';

        this._boxEl.append(this._headerEl, this._contentEl);
        this._scrimEl.appendChild(this._boxEl);
        // Everything the author places inside is the dialog content — LIVE, because
        // `Adw.Dialog:child` is a property and a dialog whose body is filled in after it
        // was created is the ordinary case. `src/slotted-children.ts` has the incident.
        bindSlottedChildren(this, [{ into: this._contentEl }]).install(this._scrimEl);

        this._render();
    }

    attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null) {
        if (!this._initialized) return;
        if (oldValue === newValue) return;
        this._render();
        if (name === 'open') {
            this.dispatchEvent(new CustomEvent('notify::open', { bubbles: true, detail: { open: this.open } }));
            if (this.open) this._modal.present();
            else this._onClosed();
        }
    }

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

    /** On close: emit `closed`, then let the surface return focus to where it was. */
    private _onClosed(): void {
        this.dispatchEvent(new CustomEvent('closed', { bubbles: true }));
        this._modal.dismiss();
    }

    private _render(): void {
        this.classList.toggle('open', this.open);

        const title = this.title;
        this._titleEl.textContent = title;

        const hasHeader = title.length > 0 || this.hasAttribute('show-header');
        this._headerEl.hidden = !hasHeader;

        // The CSS reads both of these: the dataset picks floating vs bottom sheet, the
        // custom properties carry the size constraints.
        this.dataset.presentation = this.presentationMode;

        this._boxEl.style.setProperty('--adw-dialog-content-width', `${this.contentWidth}px`);
        const height = this.contentHeight;
        if (height > 0) this._boxEl.style.setProperty('--adw-dialog-content-height', `${height}px`);
        else this._boxEl.style.removeProperty('--adw-dialog-content-height');

        const locked = !this.canClose;
        this._closeBtn.disabled = locked;
        this._closeBtn.classList.toggle('locked', locked);
    }
}

customElements.define('adw-dialog', AdwDialog);
