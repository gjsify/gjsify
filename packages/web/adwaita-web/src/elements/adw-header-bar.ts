// <adw-header-bar> — Adwaita header bar with centered title and start/end button slots.
// Adapted from Adwaita Web UI Framework (https://github.com/mclellac/adwaita-web).
// Copyright (c) 2025 csm. MIT License.
// Modifications: Reimplemented as Web Component for @gjsify/adwaita-web.

export class AdwHeaderBar extends HTMLElement {
    private _initialized = false;
    private _startEl: HTMLDivElement | null = null;
    private _endEl: HTMLDivElement | null = null;

    /** The start (left) section container — append buttons/widgets here. */
    get startSection(): HTMLDivElement | null { return this._startEl; }

    /** The end (right) section container — append buttons/widgets here. */
    get endSection(): HTMLDivElement | null { return this._endEl; }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        const title = this.getAttribute('title') || '';

        // Capture any pre-existing slotted children before clearing
        const startChildren = Array.from(this.querySelectorAll(':scope > [slot="start"]'));
        const endChildren = Array.from(this.querySelectorAll(':scope > [slot="end"]'));

        // Start section
        this._startEl = document.createElement('div');
        this._startEl.className = 'adw-header-bar-start';
        for (const child of startChildren) this._startEl.appendChild(child);

        // Center section with title
        const center = document.createElement('div');
        center.className = 'adw-header-bar-center';
        const titleEl = document.createElement('span');
        titleEl.className = 'adw-header-bar-title';
        titleEl.textContent = title;
        center.appendChild(titleEl);

        // End section
        this._endEl = document.createElement('div');
        this._endEl.className = 'adw-header-bar-end';
        for (const child of endChildren) this._endEl.appendChild(child);

        // Replace all children atomically
        this.replaceChildren(this._startEl, center, this._endEl);
    }
}

customElements.define('adw-header-bar', AdwHeaderBar);
