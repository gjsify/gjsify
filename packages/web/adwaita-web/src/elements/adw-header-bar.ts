// <adw-header-bar> — Adwaita header bar with centered title and start/end button slots.
//
// The derived centre is an `<adw-window-title>`, which is what `Adw.HeaderBar`
// itself puts there (`adw-header-bar.c`: the title widget it creates when none is
// given IS an `AdwWindowTitle`). It used to be a bare span with
// `textContent = title ?? ''`, and that span carried none of the three rules the
// window title already held in `@gjsify/adwaita-core`: an EMPTY title still
// reserved a blank line, re-setting the same value repainted, and there was no
// subtitle at all. So a header bar could not show what its own NativeScript twin
// could, and the fix is delegation rather than a fourth copy of the derivation.
//
// CORE-VIA: ./adw-window-title.js — the derived centre IS that element, so the three rules run in its WindowTitleState.
//
// Reference: refs/libadwaita/src/adw-header-bar.c
// Adapted from Adwaita Web UI Framework (https://github.com/mclellac/adwaita-web).
// Copyright (c) 2025 csm. MIT License.
// Modifications: Reimplemented as Web Component for @gjsify/adwaita-web.

// Registers <adw-window-title>: the derived centre is one, so importing the bar
// alone must still define it.
import './adw-window-title.js';
import { bindSlotAdoption } from '../slot-adoption.js';

export class AdwHeaderBar extends HTMLElement {
    private _initialized = false;
    private _startEl: HTMLDivElement | null = null;
    private _centerEl: HTMLDivElement | null = null;
    private _endEl: HTMLDivElement | null = null;
    /**
     * The derived `<adw-window-title>`, or `null` when a `slot="center"`
     * title-widget took the centre. `Adw.HeaderBar` has the same either/or:
     * setting `title-widget` replaces the derived `AdwWindowTitle` outright.
     */
    private _titleEl: HTMLElement | null = null;

    static get observedAttributes() {
        return ['title', 'subtitle'];
    }

    /** The start (left) section container — append buttons/widgets here. */
    get startSection(): HTMLDivElement | null {
        return this._startEl;
    }

    /** The center (title) section — holds the `title` text or any `slot="center"`
     * widget (the equivalent of Adw.HeaderBar's title-widget, e.g. a URL entry). */
    get centerSection(): HTMLDivElement | null {
        return this._centerEl;
    }

    /** The end (right) section container — append buttons/widgets here. */
    get endSection(): HTMLDivElement | null {
        return this._endEl;
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        // Capture any pre-existing slotted children before clearing
        const startChildren = Array.from(this.querySelectorAll(':scope > [slot="start"]'));
        const centerChildren = Array.from(this.querySelectorAll(':scope > [slot="center"]'));
        const endChildren = Array.from(this.querySelectorAll(':scope > [slot="end"]'));

        // Start section
        this._startEl = document.createElement('div');
        this._startEl.className = 'adw-header-bar-start';
        for (const child of startChildren) this._startEl.appendChild(child);

        // Center section — a `slot="center"` widget (title-widget) wins over the
        // plain `title` text.
        this._centerEl = document.createElement('div');
        this._centerEl.className = 'adw-header-bar-center';
        if (centerChildren.length > 0) {
            for (const child of centerChildren) this._centerEl.appendChild(child);
        } else {
            this._titleEl = document.createElement('adw-window-title');
            this._titleEl.className = 'adw-header-bar-title';
            this._centerEl.appendChild(this._titleEl);
        }

        // End section
        this._endEl = document.createElement('div');
        this._endEl.className = 'adw-header-bar-end';
        for (const child of endChildren) this._endEl.appendChild(child);

        // Replace all children atomically
        this.replaceChildren(this._startEl, this._centerEl, this._endEl);
        this._renderTitle();
        // A child appended after this point is routed the same way, or it sits in the
        // light DOM looking placed. `_renderTitle` re-runs so a late `slot="center"`
        // widget displaces the automatic title, as the declared form already does.
        bindSlotAdoption(this, { start: this._startEl, center: this._centerEl, end: this._endEl }, () =>
            this._renderTitle(),
        );
    }

    /**
     * `title` used to be read ONCE, in `connectedCallback`, so every later write
     * was a silent no-op — a header bar whose title tracked the open document
     * kept whatever it was created with. `Adw.HeaderBar`'s derived title widget
     * is bound to the property and re-renders on every change.
     */
    attributeChangedCallback() {
        if (this._initialized) this._renderTitle();
    }

    private _renderTitle() {
        // A `slot="center"` widget replaced the derived title, so there is
        // nothing for the attribute to write to — the same either/or as
        // `Adw.HeaderBar:title-widget`.
        if (!this._titleEl) return;
        // Forwarded as ATTRIBUTES, so the window title's own change detection and
        // empty-string collapse do the work. Removing rather than writing `''`
        // keeps "unset" distinguishable from "set to empty" on the child.
        for (const name of ['title', 'subtitle']) {
            const value = this.getAttribute(name);
            if (value === null) this._titleEl.removeAttribute(name);
            else this._titleEl.setAttribute(name, value);
        }
    }
}

customElements.define('adw-header-bar', AdwHeaderBar);
