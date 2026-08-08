// <adw-window-title> — A composite title + subtitle for a header bar.
// Attributes: title, subtitle.
// Events: notify::title / notify::subtitle (CustomEvent, mirroring the GObject
//   notify names Adw.WindowTitle emits).
//
// The two labels, their visibility and the change-detection are HEADLESS and
// live in `@gjsify/adwaita-core` (ADR 0004) as {@link WindowTitleState}; this
// element composes it and keeps only the DOM render half.
// `@gjsify/adwaita-nativescript` composes the same state, so both ports share one
// behaviour. Three rules from adw-window-title.c that neither renderer had:
//   - the TITLE label hides when the title is empty (C:207-208; the template even
//     starts it `visible=False`, adw-window-title.ui:15). Only the subtitle was
//     ever hidden here, so a header bar with a subtitle and no title reserved a
//     blank title line above it.
//   - setting the value it already has returns early (C:203-204, :244-245).
//   - a real change notifies (C:210, :251).
//
// Reference: refs/adwaita-web/adwaita-web/docs/widgets/windowtitle.md
// Reference: refs/libadwaita/src/adw-window-title.c, adw-window-title.ui
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web; the
// title/subtitle state composed from @gjsify/adwaita-core.

import { WindowTitleState } from '@gjsify/adwaita-core';

export class AdwWindowTitle extends HTMLElement {
    private _titleEl!: HTMLSpanElement;
    private _subtitleEl!: HTMLSpanElement;
    /** The headless title/subtitle pair + change detection (ADR 0004). */
    private readonly _state = new WindowTitleState();
    private _initialized = false;

    static get observedAttributes() {
        return ['title', 'subtitle'];
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        this._titleEl = document.createElement('span');
        this._titleEl.className = 'adw-window-title-title';

        this._subtitleEl = document.createElement('span');
        this._subtitleEl.className = 'adw-window-title-subtitle';

        this.replaceChildren(this._titleEl, this._subtitleEl);
        // Adopt the declared attributes without notifying: this is the initial
        // value, not a change (`adw_window_title_new` sets both at construction).
        this._state.setTitle(this.getAttribute('title'));
        this._state.setSubtitle(this.getAttribute('subtitle'));
        this._render();
    }

    attributeChangedCallback(name: string, _old: string | null, value: string | null) {
        if (!this._initialized) return;
        const changed = name === 'title' ? this._state.setTitle(value) : this._state.setSubtitle(value);
        // The early-return is the whole point: re-setting the same value paints
        // nothing and notifies nothing (C:203-204, :244-245).
        if (!changed) return;
        this._render();
        this.dispatchEvent(
            new CustomEvent(`notify::${name}`, {
                bubbles: true,
                detail: { [name]: name === 'title' ? this._state.title : this._state.subtitle },
            }),
        );
    }

    private _render() {
        const { title, titleVisible, subtitle, subtitleVisible } = this._state.state;
        this._titleEl.textContent = title;
        this._titleEl.hidden = !titleVisible;
        this._subtitleEl.textContent = subtitle;
        // Hiding the empty label entirely keeps the other one vertically
        // centered, which is what the GTK box does when a child is invisible.
        this._subtitleEl.hidden = !subtitleVisible;
    }
}

customElements.define('adw-window-title', AdwWindowTitle);
