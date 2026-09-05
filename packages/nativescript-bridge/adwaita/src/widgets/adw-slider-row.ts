// AdwSliderRow — a Libadwaita-style range/scale row for NativeScript.
//
// A vertical card: a header (title + live value) over a horizontal `Slider`. This
// is the NS counterpart of the GTK storybook's `Gtk.Scale` RANGE card and the
// browser's `input[type=range]` `.sb-range-row`, so a RANGE story control renders
// as a REAL slider (matching native) rather than a `[−] value [+]` stepper.
//
// libadwaita declares no `AdwSliderRow`, so this row is the port's own (declared in
// `NS_WIDGET_ALIGNMENT`) — but its RANGE is not. On GTK a `Gtk.Scale` is a `GtkRange`,
// and a `GtkRange` is handed a `Gtk.Adjustment`, so the value/bounds/step this row steps
// through is the same portable `AdwAdjustment` the spin row takes (ADR 0047). It used to
// carry a fourth copy of the clamp-and-step arithmetic in four private fields; it composes
// `SpinState` now, and the snap a dragged thumb needs is `snapAdjustmentValue` —
// `snap-to-ticks`'s arithmetic, in the module that owns the range.
//
// Visual spec ported from `@gjsify/adwaita-web`'s `.sb-range-row` + the GTK
// `Gtk.Scale` card. Reference: refs/libadwaita/src/stylesheet/widgets/_scale.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { GridLayout, ItemSpec, Label, Slider, StackLayout, type EventData } from '@nativescript/core';
import { SpinState, parseAdjustment, snapAdjustmentValue } from '@gjsify/adwaita-core';
import type { AdwAdjustment, AdwAdjustmentInput } from '@gjsify/adwaita-core';
import { xmlNumber } from './xml-values.js';

/** Event name emitted when {@link AdwSliderRow.value} changes. Mirrors GObject `notify::value`. */
export const NOTIFY_SLIDER_VALUE = 'notify::value';

/** Payload of the `notify::value` event. */
export interface NotifySliderValueEventData extends EventData {
    /** The new numeric value (already clamped into the adjustment's range and snapped to a tick). */
    value: number;
}

export class AdwSliderRow extends StackLayout {
    /** The title label (header, left). */
    protected readonly _titleLabel: Label;
    /** The live value label (header, right, dim). */
    protected readonly _valueLabel: Label;
    /** The horizontal slider. */
    protected readonly _slider: Slider;

    /** The headless adjustment: clamp, step and the two signals (ADR 0004, ADR 0047). */
    private readonly _state = new SpinState();
    /** Guards the slider's `valueChange` while we programmatically set its value. */
    private _suppress = false;

    constructor() {
        super();

        this.orientation = 'vertical';
        this.className = 'adw-slider-row';

        const header = new GridLayout();
        header.className = 'adw-slider-header';
        header.addRow(new ItemSpec(1, 'auto'));
        header.addColumn(new ItemSpec(1, 'star'));
        header.addColumn(new ItemSpec(1, 'auto'));

        const titleLabel = new Label();
        titleLabel.className = 'adw-slider-title';
        titleLabel.textWrap = false;
        GridLayout.setColumn(titleLabel, 0);
        header.addChild(titleLabel);

        const valueLabel = new Label();
        valueLabel.className = 'adw-slider-value';
        valueLabel.text = String(this._state.value);
        GridLayout.setColumn(valueLabel, 1);
        header.addChild(valueLabel);

        const range = this._state.adjustment;
        const slider = new Slider();
        slider.className = 'adw-slider';
        slider.minValue = range.lower;
        slider.maxValue = range.upper;
        slider.value = range.value;

        this.addChild(header);
        this.addChild(slider);

        this._titleLabel = titleLabel;
        this._valueLabel = valueLabel;
        this._slider = slider;

        // The label follows every value change; the THUMB only follows a programmatic one,
        // because on an interactive change the thumb is already where the finger left it —
        // writing it back mid-drag is what `_suppress` exists to keep from re-entering.
        this._state.subscribe((change) => {
            this._valueLabel.text = String(change.value);
            if (change.interactive) {
                const data: NotifySliderValueEventData = {
                    eventName: NOTIFY_SLIDER_VALUE,
                    object: this,
                    value: change.value,
                };
                this.notify(data);
            } else {
                this._sync();
            }
        });

        // A moved bound is the slider's own geometry, which is why this row needs the
        // signal the spin row does not: `Gtk.Adjustment::changed` re-sizes the track.
        //
        // AND RE-SNAPS, which clamping alone does not do. A moved bound moves the TICK GRID
        // with it — 25 is on `0, 5, 10, …` and off `1, 6, 11, …` — so a value the old grid
        // allowed can be left between two ticks of the new one. The setters this replaced
        // ended with `this.value = this._value` for exactly that, and losing it is invisible
        // to a suite that writes the range before the value.
        this._state.subscribeChanged((adjustment) => {
            this._slider.minValue = adjustment.lower;
            this._slider.maxValue = adjustment.upper;
            this._state.setValue(snapAdjustmentValue(adjustment, this._state.value));
            this._sync();
        });

        slider.addEventListener('valueChange', () => {
            if (this._suppress) return;
            const snapped = snapAdjustmentValue(this._state.adjustment, this._slider.value);
            if (snapped !== this._slider.value) {
                // Re-snap the thumb to the tick grid without re-emitting.
                this._suppress = true;
                this._slider.value = snapped;
                this._suppress = false;
            }
            this._state.setValueInteractive(snapped);
        });
    }

    /** Push the current value to the slider + label without emitting. */
    private _sync(): void {
        this._suppress = true;
        this._slider.value = this._state.value;
        this._suppress = false;
        this._valueLabel.text = String(this._state.value);
    }

    /** The group title shown in the header (left). */
    get title(): string {
        return this._titleLabel.text ?? '';
    }

    set title(value: string) {
        this._titleLabel.text = value ?? '';
    }

    /** The current numeric value (always within the adjustment's range, snapped to a tick). */
    get value(): number {
        return this._state.value;
    }

    set value(raw: number | string) {
        this._state.setValue(snapAdjustmentValue(this._state.adjustment, xmlNumber(raw, this.value)));
    }

    /**
     * The numeric range this row slides through — the `Gtk.Adjustment` a `Gtk.Scale` is
     * handed, under the same key the spin row uses.
     *
     * Reads back whole; writes MERGE, so `adjustment = { upper: 20 }` moves one bound and
     * leaves the rest. From XML it is a JSON object —
     * `adjustment='{"lower":0,"upper":20,"stepIncrement":5}'`.
     */
    get adjustment(): AdwAdjustment {
        return this._state.adjustment;
    }

    set adjustment(v: AdwAdjustmentInput | string) {
        this._state.configure(typeof v === 'string' ? parseAdjustment(v) : v);
    }

    /** The underlying {@link Slider} (e.g. to tweak styling). */
    get slider(): Slider {
        return this._slider;
    }
}
