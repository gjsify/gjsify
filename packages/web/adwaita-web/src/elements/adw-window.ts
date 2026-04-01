// <adw-window> — Adwaita application window frame.
// Provides rounded corners, shadow, and flex column layout.

export class AdwWindow extends HTMLElement {
    connectedCallback() {
        // Light DOM: children remain in place, element itself is the styled container.
        // Set dimensions from attributes if provided.
        const w = this.getAttribute('width');
        const h = this.getAttribute('height');
        if (w) this.style.width = `${w}px`;
        if (h) this.style.height = `${h}px`;
    }
}

customElements.define('adw-window', AdwWindow);
