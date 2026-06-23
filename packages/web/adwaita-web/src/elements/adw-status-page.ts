// <adw-status-page> — A centered empty/placeholder state: a large symbolic
// icon, a title, a description and an optional action (slotted child).
// Attributes: icon (symbolic name, with or without -symbolic), title, description.
// Reference: refs/adwaita-web/adwaita-web/scss/_status_page.scss
// Reference: refs/libadwaita/src/stylesheet/widgets/_status-page.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

export class AdwStatusPage extends HTMLElement {
    private _iconEl!: HTMLSpanElement;
    private _titleEl!: HTMLSpanElement;
    private _descEl!: HTMLSpanElement;
    private _childEl!: HTMLDivElement;
    private _initialized = false;

    static get observedAttributes() {
        return ['icon', 'title', 'description'];
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        const children = Array.from(this.childNodes);

        this._iconEl = document.createElement('span');
        this._iconEl.className = 'adw-status-page-icon adw-icon';
        this._iconEl.setAttribute('aria-hidden', 'true');

        this._titleEl = document.createElement('span');
        this._titleEl.className = 'adw-status-page-title';

        this._descEl = document.createElement('span');
        this._descEl.className = 'adw-status-page-description';

        this._childEl = document.createElement('div');
        this._childEl.className = 'adw-status-page-child';
        for (const child of children) this._childEl.appendChild(child);

        this.replaceChildren(this._iconEl, this._titleEl, this._descEl, this._childEl);
        this._render();
    }

    attributeChangedCallback() {
        if (this._initialized) this._render();
    }

    private _render() {
        const icon = (this.getAttribute('icon') ?? '').replace(/-symbolic$/, '');
        // Swap the icon mask class (keep the base + size class).
        this._iconEl.className = `adw-status-page-icon adw-icon${icon ? ` adw-icon--${icon}` : ''}`;
        this._iconEl.hidden = icon.length === 0;

        const title = this.getAttribute('title') ?? '';
        this._titleEl.textContent = title;
        this._titleEl.hidden = title.length === 0;

        const description = this.getAttribute('description') ?? '';
        this._descEl.textContent = description;
        this._descEl.hidden = description.length === 0;

        this._childEl.hidden = this._childEl.childElementCount === 0;
    }
}

customElements.define('adw-status-page', AdwStatusPage);
