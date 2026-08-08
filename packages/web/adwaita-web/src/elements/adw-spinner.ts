// <adw-spinner> — A continuously-spinning loading indicator.
// Attributes: size (px; the measured minimum, 16, when absent or unusable).
//
// The ring geometry is `Adw.Spinner`'s, not a guess: the diameter and the stroke
// come from `@gjsify/adwaita-core`'s `spinnerGeometry`, which is
// `AdwSpinnerPaintable`'s `radius = min(floor(min(w, h) / 2), 32)` with
// `lineWidth = diameter / 8`. This element used to default to 24px and stroke
// `max(2, round(size / 12))`, which draws 2px where Adwaita draws 3px at 24, 4px
// against 6px at 48 and 5px against 8px at 64 — the ring was visibly thinner than
// GTK's at every size above the minimum.
//
// Reference: refs/libadwaita/src/adw-spinner.c (MIN_SIZE, adw_spinner_measure)
// Reference: refs/libadwaita/src/adw-spinner-paintable.c (MAX_RADIUS, calculate_line_width)
// Reference: refs/adwaita-web/adwaita-web/scss/_spinner.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import { resolveSpinnerSize, spinnerGeometry } from '@gjsify/adwaita-core';

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
        // The element IS the ring, so it takes the DRAWN diameter rather than the
        // requested box: a request below 16 is not representable (GTK never
        // allocates below a widget's minimum) and one above 64 draws a 64px ring,
        // which is Adwaita's documented "never larger than 64×64".
        const size = resolveSpinnerSize(this.getAttribute('size'));
        const { diameter, lineWidth } = spinnerGeometry(size, size);
        this.style.width = `${diameter}px`;
        this.style.height = `${diameter}px`;
        this.style.borderWidth = `${lineWidth}px`;
    }
}

customElements.define('adw-spinner', AdwSpinner);
