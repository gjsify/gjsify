// AdwSpinRow — a Libadwaita-style numeric spin row for NativeScript.
//
// Extends {@link AdwActionRow} and installs a REAL NativeScript stepper in the
// suffix slot: a `[−] value [+]` triplet (`Button` / `Label` / `Button` in a
// horizontal `StackLayout`). `value` / `min` / `max` / `step` mirror
// `Adw.SpinRow`'s adjustment; pressing a button clamps to `[min, max]` and emits a
// `notify::value` event (GObject signal naming).
//
// Visual spec ported from `@gjsify/adwaita-web`'s `_spin_row.scss`.
// Reference: refs/libadwaita/src/stylesheet/widgets/_spin-button.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { Label, StackLayout, type EventData } from '@nativescript/core';
import { valueDecreaseSymbolic, valueIncreaseSymbolic } from '@gjsify/adwaita-icons/actions';
import { AdwActionRow } from './adw-action-row.js';
import { AdwImageButton } from './adw-image-button.js';

/** Event name emitted when {@link AdwSpinRow.value} changes. Mirrors GObject `notify::value`. */
export const NOTIFY_VALUE = 'notify::value';

/** Payload of the `notify::value` event. */
export interface NotifyValueEventData extends EventData {
    /** The new numeric value (already clamped to `[min, max]`). */
    value: number;
}

export class AdwSpinRow extends AdwActionRow {
    /** The `−` decrement button (circular icon button, value-decrease symbolic). */
    protected readonly _minusButton: AdwImageButton;
    /** The `+` increment button (circular icon button, value-increase symbolic). */
    protected readonly _plusButton: AdwImageButton;
    /** The value display before the stepper buttons. */
    protected readonly _valueLabel: Label;

    private _value = 0;
    private _min = 0;
    private _max = 100;
    private _step = 1;

    constructor() {
        super();

        this.className = 'adw-row adw-action-row adw-spin-row';

        const control = new StackLayout();
        control.orientation = 'horizontal';
        control.className = 'adw-spin-control';

        const valueLabel = new Label();
        valueLabel.className = 'adw-spin-value';
        valueLabel.text = String(this._value);

        // REAL Adwaita symbolic icons in circular flat buttons (value-decrease /
        // value-increase), matching Adw.SpinRow's stepper — not `−`/`+` glyphs.
        const minus = new AdwImageButton();
        minus.icon = valueDecreaseSymbolic;
        minus.className = `${minus.className} adw-spin-button adw-spin-minus`.trim();

        const plus = new AdwImageButton();
        plus.icon = valueIncreaseSymbolic;
        plus.className = `${plus.className} adw-spin-button adw-spin-plus`.trim();

        // Native order: the value sits BEFORE the stepper buttons (`16  −  +`).
        control.addChild(valueLabel);
        control.addChild(minus);
        control.addChild(plus);
        this.setSuffix(control);

        this._minusButton = minus;
        this._plusButton = plus;
        this._valueLabel = valueLabel;

        minus.addEventListener('tap', () => this._bump(-this._step));
        plus.addEventListener('tap', () => this._bump(this._step));
    }

    /** Apply a delta, clamp to `[min, max]`, update the label and emit `notify::value`. */
    private _bump(delta: number): void {
        const next = this._clamp(this._value + delta);
        if (next !== this._value) {
            this._value = next;
            this._valueLabel.text = String(next);
            const data: NotifyValueEventData = {
                eventName: NOTIFY_VALUE,
                object: this,
                value: next,
            };
            this.notify(data);
        }
    }

    private _clamp(n: number): number {
        return Math.min(this._max, Math.max(this._min, n));
    }

    /** The current numeric value (always within `[min, max]`). */
    get value(): number {
        return this._value;
    }

    set value(v: number) {
        const next = this._clamp(Number.isFinite(v) ? v : 0);
        if (next !== this._value) {
            this._value = next;
            this._valueLabel.text = String(next);
        }
    }

    /** Lower bound. Re-clamps the current value if it now falls below. */
    get min(): number {
        return this._min;
    }

    set min(v: number) {
        this._min = Number.isFinite(v) ? v : 0;
        this.value = this._value;
    }

    /** Upper bound. Re-clamps the current value if it now falls above. */
    get max(): number {
        return this._max;
    }

    set max(v: number) {
        this._max = Number.isFinite(v) ? v : 0;
        this.value = this._value;
    }

    /** Increment/decrement step applied per button press. */
    get step(): number {
        return this._step;
    }

    set step(v: number) {
        this._step = Number.isFinite(v) && v > 0 ? v : 1;
    }
}
