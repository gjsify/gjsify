// <adw-header-bar> — Adwaita header bar with centered title and start/end button slots.
// Adapted from Adwaita Web UI Framework (https://github.com/mclellac/adwaita-web).
// Copyright (c) 2025 csm. MIT License.
// Modifications: Reimplemented as Web Component for @gjsify/adwaita-web.

export class AdwHeaderBar extends HTMLElement {
    private _initialized = false;
    private _startEl: HTMLDivElement | null = null;
    private _centerEl: HTMLDivElement | null = null;
    private _endEl: HTMLDivElement | null = null;

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

        const title = this.getAttribute('title') || '';

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
            const titleEl = document.createElement('span');
            titleEl.className = 'adw-header-bar-title';
            titleEl.textContent = title;
            this._centerEl.appendChild(titleEl);
        }

        // End section
        this._endEl = document.createElement('div');
        this._endEl.className = 'adw-header-bar-end';
        for (const child of endChildren) this._endEl.appendChild(child);

        // Replace all children atomically
        this.replaceChildren(this._startEl, this._centerEl, this._endEl);
    }
}

customElements.define('adw-header-bar', AdwHeaderBar);
