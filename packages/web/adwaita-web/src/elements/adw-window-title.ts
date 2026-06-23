// <adw-window-title> — A composite title + subtitle for a header bar.
// Attributes: title, subtitle.
// Mirrors Adw.WindowTitle: two centered, ellipsized labels stacked vertically;
// the subtitle is hidden when empty.
// Reference: refs/adwaita-web/adwaita-web/docs/widgets/windowtitle.md
// Reference: refs/libadwaita (Adw.WindowTitle)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

export class AdwWindowTitle extends HTMLElement {
    private _titleEl!: HTMLSpanElement;
    private _subtitleEl!: HTMLSpanElement;
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
        this._render();
    }

    attributeChangedCallback() {
        if (this._initialized) this._render();
    }

    private _render() {
        const title = this.getAttribute('title') ?? '';
        const subtitle = this.getAttribute('subtitle') ?? '';
        this._titleEl.textContent = title;
        this._subtitleEl.textContent = subtitle;
        // Hide the subtitle slot entirely when empty so the title stays
        // vertically centered (matches Adw.WindowTitle).
        this._subtitleEl.hidden = subtitle.length === 0;
    }
}

customElements.define('adw-window-title', AdwWindowTitle);
