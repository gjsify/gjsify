// <adw-header-bar> — Adwaita header bar with centered title.
// Adapted from Adwaita Web UI Framework (https://github.com/mclellac/adwaita-web).
// Copyright (c) 2025 csm. MIT License.
// Modifications: Reimplemented as Web Component for @gjsify/adwaita-web.

export class AdwHeaderBar extends HTMLElement {
    private _initialized = false;

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        const title = this.getAttribute('title') || '';

        // Center section with title
        const center = document.createElement('div');
        center.className = 'adw-header-bar-center';
        const titleEl = document.createElement('span');
        titleEl.className = 'adw-header-bar-title';
        titleEl.textContent = title;
        center.appendChild(titleEl);

        this.appendChild(center);
    }
}

customElements.define('adw-header-bar', AdwHeaderBar);
