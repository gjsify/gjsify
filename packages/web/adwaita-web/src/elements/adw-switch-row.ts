// <adw-switch-row> — Row with a label and toggle switch.
// Attributes: title, active (boolean)
// Events: notify::active (CustomEvent, mirrors GJS GObject signal naming)
// Adapted from Adwaita Web UI Framework (https://github.com/mclellac/adwaita-web).
// Copyright (c) 2025 csm. MIT License.
// Modifications: Reimplemented as Web Component for @gjsify/adwaita-web.

export class AdwSwitchRow extends HTMLElement {
    private _checkbox!: HTMLInputElement;
    private _initialized = false;

    static get observedAttributes() { return ['active']; }

    get active(): boolean {
        return this.hasAttribute('active');
    }

    set active(value: boolean) {
        if (value) this.setAttribute('active', '');
        else this.removeAttribute('active');
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        const title = this.getAttribute('title') || '';
        const checked = this.hasAttribute('active');

        // Title
        const titleEl = document.createElement('span');
        titleEl.className = 'adw-row-title';
        titleEl.textContent = title;

        // Switch label with hidden checkbox + slider
        const label = document.createElement('label');
        label.className = 'adw-switch';

        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = checked;

        const slider = document.createElement('span');
        slider.className = 'adw-switch-slider';

        label.appendChild(input);
        label.appendChild(slider);

        this.appendChild(titleEl);
        this.appendChild(label);

        this._checkbox = input;
        this._checkbox.addEventListener('change', () => {
            this.toggleAttribute('active', this._checkbox.checked);
            this.dispatchEvent(new CustomEvent('notify::active', {
                bubbles: true,
                detail: { active: this._checkbox.checked },
            }));
        });
    }

    attributeChangedCallback(name: string, _old: string | null, value: string | null) {
        if (name === 'active' && this._checkbox) {
            this._checkbox.checked = value !== null;
        }
    }
}

customElements.define('adw-switch-row', AdwSwitchRow);
