// AdwSpinRow — a Libadwaita-style numeric spin row for NativeScript.
//
// Extends {@link AdwActionRow} and installs a REAL NativeScript stepper in the
// suffix slot: a `[−] value [+]` triplet (`Button` / `Label` / `Button` in a
// horizontal `StackLayout`). The row has the two properties `Adw.SpinRow` has:
// `value` and `adjustment`. Pressing a button steps by the adjustment's
// `stepIncrement`, clamps into its range and emits a `notify::value` event (GObject
// signal naming).
//
// `min` / `max` / `step` ARE GONE, and the range they spelled is one value now:
// `Adw.SpinRow` has no such properties — it has an `adjustment`, and so does this row
// (ADR 0047). The portable `AdwAdjustment` is `@gjsify/adwaita-core`'s, the same value
// the browser element and the React Native widget take, so one authored range moves
// between the surfaces unchanged.
//
// The adjustment STATE MACHINE (clamping on every mutation, `increment`/`decrement`
// stepping, the `changed`/`value-changed` signal split and the programmatic-vs-
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
import { SpinState, parseAdjustment } from '@gjsify/adwaita-core';
import type { AdwAdjustment, AdwAdjustmentInput } from '@gjsify/adwaita-core';
import { AdwActionRow } from './adw-action-row.js';
import { AdwImageButton } from './adw-image-button.js';
import { xmlNumber } from './xml-values.js';
import { applyConstructProps, type ConstructProps } from './construct-props.js';

// Re-export the headless state machine so consumers can reach it from
// `@gjsify/adwaita-nativescript` unchanged.
export { SpinState } from '@gjsify/adwaita-core';
export type { AdwAdjustment, AdwAdjustmentInput, SpinStateChange, SpinStateListener } from '@gjsify/adwaita-core';

/** Event name emitted when {@link AdwSpinRow.value} changes. Mirrors GObject `notify::value`. */
export const NOTIFY_VALUE = 'notify::value';

/** Payload of the `notify::value` event. */
export interface NotifyValueEventData extends EventData {
    /** The new numeric value (already clamped into the adjustment's range). */
    value: number;
}

export class AdwSpinRow extends AdwActionRow {
    /** The `−` decrement button (circular icon button, value-decrease symbolic). */
    protected readonly _minusButton: AdwImageButton;
    /** The `+` increment button (circular icon button, value-increase symbolic). */
    protected readonly _plusButton: AdwImageButton;
    /** The value display before the stepper buttons. */
    protected readonly _valueLabel: Label;
    /** The headless adjustment: clamp, step and the two signals (ADR 0004, ADR 0047). */
    private readonly _state = new SpinState();

    constructor(props?: ConstructProps<AdwSpinRow>) {
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

        applyConstructProps(this, props);
    }

    /** The current numeric value (always within the adjustment's range). */
    get value(): number {
        return this._state.value;
    }

    set value(v: number | string) {
        this._state.setValue(xmlNumber(v, this._state.value));
    }

    /**
     * The numeric range this row steps through — `Adw.SpinRow:adjustment`.
     *
     * Reads back whole; writes MERGE, so `adjustment = { upper: 20 }` moves one bound and
     * leaves the rest, the value included (re-clamped if the move came under it). From XML
     * it is a JSON object — `adjustment='{"lower":1,"upper":20}'` — which is why the setter
     * takes a string: NativeScript's XML builder assigns attributes verbatim, so a
     * non-string property needs its own door (see `xml-values.ts`).
     */
    get adjustment(): AdwAdjustment {
        return this._state.adjustment;
    }

    set adjustment(v: AdwAdjustmentInput | string) {
        this._state.configure(typeof v === 'string' ? parseAdjustment(v) : v);
    }
}
