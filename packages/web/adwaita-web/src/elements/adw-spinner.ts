// <adw-spinner> — A continuously-spinning loading indicator.
// Attributes: size (px, default 24).
// Reference: refs/adwaita-web/adwaita-web/scss/_spinner.scss
// Reference: refs/libadwaita (Adw.Spinner)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

export class AdwSpinner extends HTMLElement {
    static get observedAttributes() {
        return ['size'];
    }

    connectedCallback() {
        this._sync();
    }

    attributeChangedCallback() {
        this._sync();
    }

    private _sync() {
        const size = parseFloat(this.getAttribute('size') || '24');
        this.style.width = `${size}px`;
        this.style.height = `${size}px`;
        // Scale the ring thickness with the diameter (libadwaita's arc thickens
        // with size); clamp so tiny spinners stay visible.
        this.style.borderWidth = `${Math.max(2, Math.round(size / 12))}px`;
    }
}

customElements.define('adw-spinner', AdwSpinner);
