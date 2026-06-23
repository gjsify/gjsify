// <adw-clamp> — Constrains its child to a maximum width and centers it.
// Attributes: maximum-size (px, default 600), tightening-threshold (unused;
//   accepted for API parity with Adw.Clamp).
// Reference: refs/adwaita-web/adwaita-web/docs/widgets/clamp.md
// Reference: refs/libadwaita (Adw.Clamp)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

export class AdwClamp extends HTMLElement {
    static get observedAttributes() {
        return ['maximum-size'];
    }

    connectedCallback() {
        this._sync();
    }

    attributeChangedCallback() {
        this._sync();
    }

    private _sync() {
        const max = parseFloat(this.getAttribute('maximum-size') || '600');
        this.style.maxWidth = `${max}px`;
    }
}

customElements.define('adw-clamp', AdwClamp);
