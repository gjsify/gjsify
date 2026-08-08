// AdwSpinner — a Libadwaita-style busy spinner for NativeScript.
//
// Extends the REAL NativeScript `ActivityIndicator`, defaulting it to `busy` and
// taking its colour from the `adw-spinner` CSS class. Mirrors `Adw.Spinner`:
// a self-animating loading indicator. `spinning` get/set toggles `busy`; `size`
// sets the diameter.
//
// FIDELITY: faithful — `ActivityIndicator` is the platform's native spinner and
// already animates (the one native NS animation that fits the CSS-subset contract,
// since the engine drives it, not CSS keyframes). The colour tints the platform
// indicator where the OS honours it (Android sets the indeterminate drawable tint
// from `color`; iOS uses its standard style).
//
// That colour is the widget's TEXT colour, NOT the accent: the paintable strokes
// with `gtk_widget_get_color()` (adw-spinner-paintable.c:432). This port used
// Adwaita's accent blue for its whole life while adwaita-web used `currentColor`
// and documented the neutrality in a comment — the two ports contradicted each
// other in the open, and no conformance vector covers colour, so nothing looked.
//
// The SIZE is Adwaita's, not an invention: the indicator fills its view, so the
// view is the ring, and `spinnerDiameter` floors it at the measured minimum 16
// and caps it at 64 — the documented "never smaller than 16×16 and never larger
// than 64×64" (adw-spinner.c:27-28). This widget used to default to 32, which is
// in no libadwaita source, and applied `size = 200` unclamped.
//
// Reference: refs/libadwaita/src/adw-spinner.c (MIN_SIZE, adw_spinner_measure)
// Reference: refs/libadwaita/src/adw-spinner-paintable.c (MAX_RADIUS)
// Reference: refs/libadwaita/src/stylesheet/widgets/_spinner.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { ActivityIndicator } from '@nativescript/core';

import { DEFAULT_SPINNER_SIZE, spinnerDiameter } from './chrome.js';

export { DEFAULT_SPINNER_SIZE };

export class AdwSpinner extends ActivityIndicator {
    private _size = DEFAULT_SPINNER_SIZE;

    constructor() {
        super();

        this.className = 'adw-spinner';
        // Adwaita spinners spin as soon as they are shown.
        this.busy = true;
        this._applySize();
    }

    private _applySize(): void {
        this.width = this._size;
        this.height = this._size;
    }

    /** Whether the spinner is animating. Two-way bound to the indicator's `busy`. */
    get spinning(): boolean {
        return this.busy;
    }

    set spinning(value: boolean) {
        this.busy = !!value;
    }

    /**
     * The spinner diameter in DIPs — the DRAWN one, so reading it back after
     * `size = 200` reports 64 and after `size = 8` reports 16. Adwaita's ring is
     * bounded on both ends, and a getter that echoed the request would be
     * describing something that is not on screen.
     */
    get size(): number {
        return this._size;
    }

    set size(value: number) {
        this._size = spinnerDiameter(value);
        this._applySize();
    }
}
