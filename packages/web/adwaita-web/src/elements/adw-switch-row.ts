// <adw-switch-row> — Row with a title/subtitle and a trailing toggle switch.
// Attributes: title, subtitle, active (boolean)
// Events: notify::active (CustomEvent, mirrors GJS GObject signal naming)
// Adapted from Adwaita Web UI Framework (https://github.com/mclellac/adwaita-web).
// Copyright (c) 2025 csm. MIT License.
// Modifications: Reimplemented as Web Component for @gjsify/adwaita-web;
//   title/subtitle text column added to match Adw.SwitchRow.

export class AdwSwitchRow extends HTMLElement {
    private _checkbox!: HTMLInputElement;
    private _titleEl!: HTMLSpanElement;
    private _subtitleEl!: HTMLSpanElement;
    private _initialized = false;

    static get observedAttributes() {
        return ['title', 'subtitle', 'active'];
    }

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

        const text = document.createElement('div');
        text.className = 'adw-row-text';
        this._titleEl = document.createElement('span');
        this._titleEl.className = 'adw-row-title';
        this._subtitleEl = document.createElement('span');
        this._subtitleEl.className = 'adw-row-subtitle';
        text.append(this._titleEl, this._subtitleEl);

        const label = document.createElement('label');
        label.className = 'adw-switch';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = this.hasAttribute('active');
        const slider = document.createElement('span');
        slider.className = 'adw-switch-slider';
        label.append(input, slider);

        this.replaceChildren(text, label);

        this._checkbox = input;
        this._checkbox.addEventListener('change', () => {
            this.toggleAttribute('active', this._checkbox.checked);
            this.dispatchEvent(
                new CustomEvent('notify::active', {
                    bubbles: true,
                    detail: { active: this._checkbox.checked },
                }),
            );
        });

        this._renderText();
    }

    attributeChangedCallback(name: string, _old: string | null, value: string | null) {
        if (!this._initialized) return;
        if (name === 'active') this._checkbox.checked = value !== null;
        else this._renderText();
    }

    private _renderText() {
        this._titleEl.textContent = this.getAttribute('title') ?? '';
        const subtitle = this.getAttribute('subtitle') ?? '';
        this._subtitleEl.textContent = subtitle;
        this._subtitleEl.hidden = subtitle.length === 0;
    }
}

customElements.define('adw-switch-row', AdwSwitchRow);
