// <adw-preferences-dialog> — A modal preferences dialog (the web counterpart of
// Adw.PreferencesDialog). It is a centred floating dialog over a full-cover
// scrim, hosting one or more <adw-preferences-page> children — each a scrollable
// clamp of <adw-preferences-group> boxed lists — under a flat header bar that
// shows the dialog title and a trailing close button.
//
// Pages are declared as <adw-preferences-page> children (each with optional `title` /
// `icon-name` / `name` / `use-underline` attributes + arbitrary group content) and are
// moved — as ELEMENTS, keeping their identity — into the scrolled body.
// `add(page)` accepts one at any later time, mirroring `adw_preferences_dialog_add`.
//
// DEVIATION: Adw shows one page at a time behind a view switcher; this port renders
// them stacked. The page COLLECTION model belongs to Adw.ViewStack and is available as
// `ViewStackState` in @gjsify/adwaita-core when this port grows a switcher.
//
// `search(query)` searches those pages: corpus, filter and `page → group` result
// subtitles all come from @gjsify/adwaita-core, so the browser and NativeScript dialogs
// answer identically for the same tree.
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

import type { PreferencesSearchResult, SearchPreferencesOptions } from '@gjsify/adwaita-core';
import { searchPreferencesDom } from '../preferences-search.js';
import { bindSlottedChildren } from '../slotted-children.js';
import { AdwModalSurface } from './modal-surface.js';

const DEFAULT_CONTENT_WIDTH = 640;

/**
 * A single preferences page (Adw.PreferencesPage), child of <adw-preferences-dialog>.
 *
 * The dialog keeps the page ELEMENT rather than hoisting its children out, because the
 * page's identity is load-bearing: `adw_preferences_dialog_add` binds title / icon-name
 * / name / use-underline / visible onto the view-stack page, and
 * `create_search_row_subtitle` needs the title back the moment a second page is visible.
 */
export class AdwPreferencesPage extends HTMLElement {
    static get observedAttributes() {
        return ['title', 'icon-name', 'name', 'use-underline', 'open'];
    }

    /** `adw_preferences_page_get_name` — the view-stack child name. */
    get name(): string {
        return this.getAttribute('name') ?? '';
    }

    set name(value: string) {
        this.setAttribute('name', value);
    }

    /** `AdwPreferencesPage:icon-name`, shown by a view switcher. */
    get iconName(): string {
        return this.getAttribute('icon-name') ?? '';
    }

    set iconName(value: string) {
        this.setAttribute('icon-name', value);
    }

    /** `AdwPreferencesPage:use-underline` — the title carries a mnemonic. */
    get useUnderline(): boolean {
        return this.hasAttribute('use-underline');
    }

    set useUnderline(value: boolean) {
        this.toggleAttribute('use-underline', value);
    }

    get groups(): HTMLElement[] {
        return Array.from(this.querySelectorAll('adw-preferences-group'));
    }
}

export class AdwPreferencesDialog extends HTMLElement {
    private _initialized = false;
    private _scrimEl!: HTMLDivElement;
    private _dialogEl!: HTMLDivElement;
    private _titleEl!: HTMLSpanElement;
    private _bodyEl!: HTMLDivElement;
    private _pagesEl!: HTMLDivElement;
    private _closeBtn!: HTMLButtonElement;
    private _modal!: AdwModalSurface;

    static get observedAttributes() {
        return ['title', 'open', 'can-close', 'content-width'];
    }

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

    /**
     * `adw_preferences_dialog_add` — add a page at ANY time. A page that is only
     * snapshotted in `connectedCallback` stays a sibling of the scrim and renders
     * OUTSIDE the dialog card; GTK and the NativeScript port both accept one whenever
     * it arrives.
     */
    add(page: AdwPreferencesPage): void {
        this._pagesEl.appendChild(page);
    }

    /**
     * `adw_preferences_dialog_remove`. C logs `ADW_CRITICAL_CANNOT_REMOVE_CHILD` and
     * no-ops for a page it does not own; returning `false` is the same contract without
     * a console write.
     *
     * NOT named `remove`: `ChildNode.remove()` exists on every element and takes no
     * arguments, so overriding it with a different signature makes the class
     * un-assignable to `HTMLElement` — which `customElements.define` requires.
     */
    removePage(page: AdwPreferencesPage): boolean {
        if (page.parentNode !== this._pagesEl) return false;
        this._pagesEl.removeChild(page);
        return true;
    }

    get pages(): AdwPreferencesPage[] {
        return Array.from(this._pagesEl.querySelectorAll('adw-preferences-page')) as AdwPreferencesPage[];
    }

    /**
     * The preferences search (`filter_search_results` + `create_search_row_subtitle`),
     * over this dialog's live page subtree. The pipeline is `@gjsify/adwaita-core`'s,
     * including the three corpus filters (visible page → visible group → titled visible
     * row) and the case fold that makes `strasse` find `Straße`.
     *
     * An empty query returns the WHOLE corpus, as C does, which is what makes the
     * results list non-empty before the user types.
     */
    search(query: string, options?: SearchPreferencesOptions): PreferencesSearchResult<Element>[] {
        return searchPreferencesDom(this._pagesEl, query, options);
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        // Clicking the scrim dismisses the dialog, or raises close-attempt when locked.
        this._scrimEl = document.createElement('div');
        this._scrimEl.className = 'adw-preferences-dialog-scrim';
        this._scrimEl.addEventListener('click', () => this._attemptClose());

        this._dialogEl = document.createElement('div');
        this._dialogEl.className = 'adw-preferences-dialog-box';
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
        // The "×" is a CSS glyph, for the sizing reason adw-tab-view's close affordance
        // records — not for want of a mask class, which `window-close` has.
        this._closeBtn.addEventListener('click', () => this._attemptClose());
        trailing.appendChild(this._closeBtn);

        header.append(leading, this._titleEl, trailing);

        this._bodyEl = document.createElement('div');
        this._bodyEl.className = 'adw-preferences-dialog-body';

        this._pagesEl = document.createElement('div');
        this._pagesEl.className = 'adw-preferences-dialog-pages';
        this._bodyEl.appendChild(this._pagesEl);

        this._dialogEl.append(header, this._bodyEl);

        // The page ELEMENTS move into the body intact — their title / name / icon-name are
        // what a search result subtitle and a view switcher read — and any unwrapped child
        // follows them (the Adw.PreferencesDialog buildable default adds a child as a
        // page). LIVE, because `adw_preferences_dialog_add` works at any point in the
        // dialog's life. `src/slotted-children.ts` has the incident.
        bindSlottedChildren(this, [{ into: this._pagesEl }]).install(this._scrimEl, this._dialogEl);

        // The role, `aria-modal`, Escape (Adw.Dialog's shortcut → `maybe_close_cb`), the
        // Tab trap and the return-focus.
        this._modal = new AdwModalSurface({
            host: this,
            surface: this._dialogEl,
            role: 'dialog',
            isOpen: () => this.open,
            onEscape: () => this._attemptClose(),
        });

        this._render();
    }

    attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null) {
        if (!this._initialized) return;
        if (oldValue === newValue) return;
        this._render();
        if (name === 'open') {
            this.dispatchEvent(new CustomEvent('notify::open', { bubbles: true, detail: { open: this.open } }));
            if (this.open) {
                this._modal.present();
            } else {
                this.dispatchEvent(new CustomEvent('closed', { bubbles: true }));
                this._modal.dismiss();
            }
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

        const locked = !this.canClose;
        this._closeBtn.disabled = locked;
        this._closeBtn.classList.toggle('locked', locked);
    }
}

customElements.define('adw-preferences-page', AdwPreferencesPage);
customElements.define('adw-preferences-dialog', AdwPreferencesDialog);
