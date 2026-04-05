// <adw-card> — Adwaita card container.
// A simple styled container with Adwaita card appearance (rounded corners,
// layered shadow, theme-aware background).
// Reference: refs/libadwaita/src/stylesheet/widgets/_misc.scss
// Reference: refs/adwaita-web/adwaita-web/scss/_card.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as Web Component for @gjsify/adwaita-web.

export class AdwCard extends HTMLElement {
    connectedCallback() {
        this.classList.add('adw-card');
    }
}

customElements.define('adw-card', AdwCard);
