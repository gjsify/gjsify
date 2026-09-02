// AdwSpinRow — a Libadwaita-style numeric spin row for NativeScript.
//
// Extends {@link AdwActionRow} and installs a REAL NativeScript stepper in the
// suffix slot: a `[−] value [+]` triplet (`Button` / `Label` / `Button` in a
// horizontal `StackLayout`). `value` / `min` / `max` / `step` mirror
// `Adw.SpinRow`'s adjustment; pressing a button clamps to `[min, max]` and emits a
// `notify::value` event (GObject signal naming).
//
// The numeric adjustment STATE MACHINE (`value`/`min`/`max`/`step` with clamping on
// every mutation, `increment`/`decrement` stepping, and the programmatic-vs-
// interactive notify split) is HEADLESS and lives in `@gjsify/adwaita-core` (ADR
// 0004) as {@link SpinState}; this class composes it and keeps only the NS render
// half: the value `Label` + the ± stepper `AdwImageButton`s + the `notify::value`
// GObject-style signal — all driven by the state object (a programmatic set
// refreshes the label silently, a stepper press re-emits `notify::value`).
//
// Visual spec ported from `@gjsify/adwaita-web`'s `_spin_row.scss`.
// Reference: refs/libadwaita/src/stylesheet/widgets/_spin-button.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { Label, StackLayout } from '@nativescript/core';
import type { EventData } from '@nativescript/core';
import { valueDecreaseSymbolic, valueIncreaseSymbolic } from '@gjsify/adwaita-icons/actions';
import { SpinState } from '@gjsify/adwaita-core';
import { AdwActionRow } from './adw-action-row.js';
import { AdwImageButton } from './adw-image-button.js';
import { xmlNumber } from './xml-values.js';

// Re-export the headless state machine so consumers can reach it from
// `@gjsify/adwaita-nativescript` unchanged.
export { SpinState } from '@gjsify/adwaita-core';
export type { SpinStateChange, SpinStateListener } from '@gjsify/adwaita-core';

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
    /** The headless value/min/max/step clamp-and-step state machine (ADR 0004). */
    private readonly _state = new SpinState();

    constructor() {
        super();

        this.className = 'adw-row adw-action-row adw-spin-row';

        const control = new StackLayout();
        control.orientation = 'horizontal';
        control.className = 'adw-spin-control';

        const valueLabel = new Label();
        valueLabel.className = 'adw-spin-value';
        valueLabel.text = String(this._state.value);

        // REAL Adwaita symbolic icons in circular flat buttons (value-decrease /
        // value-increase), matching Adw.SpinRow's stepper — not `−`/`+` glyphs.
        const minus = new AdwImageButton();
        minus.iconName = valueDecreaseSymbolic;
        minus.className = `${minus.className} adw-spin-button adw-spin-minus`.trim();

        const plus = new AdwImageButton();
        plus.iconName = valueIncreaseSymbolic;
        plus.className = `${plus.className} adw-spin-button adw-spin-plus`.trim();

        // Native order: the value sits BEFORE the stepper buttons (`16  −  +`).
        control.addChild(valueLabel);
        control.addChild(minus);
        control.addChild(plus);
        this.setSuffix(control);

        this._minusButton = minus;
        this._plusButton = plus;
        this._valueLabel = valueLabel;

        // The core state drives the label on every change and the notify::value
        // on an interactive stepper press.
        this._state.subscribe((change) => {
            this._valueLabel.text = String(change.value);
            if (change.interactive) {
                const data: NotifyValueEventData = {
                    eventName: NOTIFY_VALUE,
                    object: this,
                    value: change.value,
                };
                this.notify(data);
            }
        });

        minus.addEventListener('tap', () => this._state.decrement());
        plus.addEventListener('tap', () => this._state.increment());
    }

    /** The current numeric value (always within `[min, max]`). */
    get value(): number {
        return this._state.value;
    }

    set value(v: number | string) {
        this._state.setValue(xmlNumber(v, this._state.value));
    }

    /** Lower bound. Re-clamps the current value if it now falls below. */
    get min(): number {
        return this._state.min;
    }

    set min(v: number | string) {
        this._state.setMin(xmlNumber(v, this._state.min));
    }

    /** Upper bound. Re-clamps the current value if it now falls above. */
    get max(): number {
        return this._state.max;
    }

    set max(v: number | string) {
        this._state.setMax(xmlNumber(v, this._state.max));
    }

    /** Increment/decrement step applied per button press. */
    get step(): number {
        return this._state.step;
    }

    set step(v: number | string) {
        this._state.setStep(xmlNumber(v, this._state.step));
    }
}
