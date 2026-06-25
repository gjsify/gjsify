// AdwSpinner — a Libadwaita-style busy spinner for NativeScript.
//
// Extends the REAL NativeScript `ActivityIndicator`, defaulting it to `busy` and
// applying the accent tint via the `adw-spinner` CSS class. Mirrors `Adw.Spinner`:
// a self-animating loading indicator. `spinning` get/set toggles `busy`; `size`
// sets the diameter.
//
// FIDELITY: faithful — `ActivityIndicator` is the platform's native spinner and
// already animates (the one native NS animation that fits the CSS-subset contract,
// since the engine drives it, not CSS keyframes). The accent color tints the
// platform indicator where the OS honours it (Android sets the indeterminate
// drawable tint from `color`; iOS uses its standard style).
//
// Reference: refs/libadwaita/src/stylesheet/widgets/_spinner.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { ActivityIndicator } from '@nativescript/core';

/** Default spinner diameter in DIPs. */
export const DEFAULT_SPINNER_SIZE = 32;

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

    /** The spinner diameter in DIPs. */
    get size(): number {
        return this._size;
    }

    set size(value: number) {
        this._size = Number.isFinite(value) && value > 0 ? value : DEFAULT_SPINNER_SIZE;
        this._applySize();
    }
}
