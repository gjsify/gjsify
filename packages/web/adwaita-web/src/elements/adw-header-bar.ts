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

import { bindSlottedChildren } from '../slotted-children.js';

// Registers <adw-window-title>: the derived centre is one, so importing the bar
// alone must still define it.
import './adw-window-title.js';

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

        this._startEl = document.createElement('div');
        this._startEl.className = 'adw-header-bar-start';

        this._centerEl = document.createElement('div');
        this._centerEl.className = 'adw-header-bar-center';

        this._endEl = document.createElement('div');
        this._endEl.className = 'adw-header-bar-end';

        // All three slots stay LIVE: a button appended with `slot="end"` after connect used
        // to sit outside the end section, and `adw-header-bar.spec.ts` carried the
        // workaround ("appended LAST") as a house rule. `src/slotted-children.ts` has the
        // incident. The `onAdopt` hook keeps the title-widget either/or true afterwards —
        // a centre widget that arrives late replaces the derived title, as setting
        // `Adw.HeaderBar:title-widget` at any point does.
        bindSlottedChildren(
            this,
            [
                { name: 'start', into: this._startEl },
                { name: 'center', into: this._centerEl },
                { name: 'end', into: this._endEl },
            ],
            (_node, slot) => {
                if (slot.name === 'center') this._dropDerivedTitle();
            },
        ).install(this._startEl, this._centerEl, this._endEl);

        // Derived only when the centre is still free — the same either/or as
        // `Adw.HeaderBar`, which builds an `AdwWindowTitle` exactly while no title-widget
        // was given.
        if (this._centerEl.childElementCount === 0) {
            this._titleEl = document.createElement('adw-window-title');
            this._titleEl.className = 'adw-header-bar-title';
            this._centerEl.appendChild(this._titleEl);
        }
        this._renderTitle();
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

    /**
     * Give the centre up to a title-widget. `adw_header_bar_set_title_widget` destroys the
     * derived `AdwWindowTitle` rather than stacking the two, so the late case has to remove
     * it too — a bar showing both would be a shape neither GTK nor the declared markup can
     * produce.
     */
    private _dropDerivedTitle() {
        this._titleEl?.remove();
        this._titleEl = null;
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
