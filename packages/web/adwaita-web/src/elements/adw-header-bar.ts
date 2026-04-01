// <adw-header-bar> — Adwaita header bar with centered title.

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
