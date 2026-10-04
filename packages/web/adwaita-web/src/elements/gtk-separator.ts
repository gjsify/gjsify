// <gtk-separator> — a one-pixel rule between two groups of widgets.
//
// ONE property, `orientation`, which is `GtkOrientable`'s: `horizontal` (the default) draws a
// line that runs ACROSS, `vertical` one that runs DOWN. Parsed by the same
// `normalizeBoxOrientation` as `<gtk-box>`, because both read one GtkOrientable property and
// an unknown value means the default in both.
//
// The element carries the orientation twice, as GTK does: the attribute is the property, and
// a `horizontal` / `vertical` CLASS on the host is the CSS state `separator.spacer.horizontal`
// selects on (`_separator.scss`). `.spacer` is libadwaita's style class for a gap that draws
// nothing, so it is the author's to set (`class="spacer"`, a `.blp`'s `styles ["spacer"]`).
//
// A11Y: `role="separator"` with `aria-orientation`, GtkSeparator's own role.
//
// Reference: refs/libadwaita/src/stylesheet/widgets/_misc.scss (separator)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import { normalizeBoxOrientation, type BoxOrientation } from '@gjsify/adwaita-core';

export class GtkSeparator extends HTMLElement {
    static get observedAttributes() {
        return ['orientation'];
    }

    /** `GtkOrientable:orientation` — `horizontal` (the default) or `vertical`. */
    get orientation(): BoxOrientation {
        return normalizeBoxOrientation(this.getAttribute('orientation'));
    }

    set orientation(value: BoxOrientation) {
        this.setAttribute('orientation', value);
    }

    connectedCallback() {
        this.setAttribute('role', 'separator');
        this._render();
    }

    attributeChangedCallback() {
        if (this.isConnected) this._render();
    }

    private _render(): void {
        const orientation = this.orientation;
        this.classList.toggle('horizontal', orientation === 'horizontal');
        this.classList.toggle('vertical', orientation === 'vertical');
        this.setAttribute('aria-orientation', orientation);
    }
}

customElements.define('gtk-separator', GtkSeparator);
