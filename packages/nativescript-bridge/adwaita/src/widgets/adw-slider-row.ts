// AdwSliderRow — a Libadwaita-style range/scale row for NativeScript.
//
// A vertical card: a header (title + live value) over a horizontal `Slider`. This
// is the NS counterpart of the GTK storybook's `Gtk.Scale` RANGE card and the
// browser's `input[type=range]` `.sb-range-row`, so a RANGE story control renders
// as a REAL slider (matching native) rather than a `[−] value [+]` stepper.
// `value`/`min`/`max`/`step` mirror `Adw.SpinRow`'s adjustment; dragging the slider
// snaps to `step`, updates the value label and emits `notify::value`.
//
// Visual spec ported from `@gjsify/adwaita-web`'s `.sb-range-row` + the GTK
// `Gtk.Scale` card. Reference: refs/libadwaita/src/stylesheet/widgets/_scale.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { GridLayout, ItemSpec, Label, Slider, StackLayout, type EventData } from '@nativescript/core';

/** Event name emitted when {@link AdwSliderRow.value} changes. Mirrors GObject `notify::value`. */
export const NOTIFY_SLIDER_VALUE = 'notify::value';

/** Payload of the `notify::value` event. */
export interface NotifySliderValueEventData extends EventData {
    /** The new numeric value (already clamped to `[min, max]` and snapped to `step`). */
    value: number;
}

export class AdwSliderRow extends StackLayout {
    /** The title label (header, left). */
    protected readonly _titleLabel: Label;
    /** The live value label (header, right, dim). */
    protected readonly _valueLabel: Label;
    /** The horizontal slider. */
    protected readonly _slider: Slider;

    private _value = 0;
    private _min = 0;
    private _max = 100;
    private _step = 1;
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
        valueLabel.text = String(this._value);
        GridLayout.setColumn(valueLabel, 1);
        header.addChild(valueLabel);

        const slider = new Slider();
        slider.className = 'adw-slider';
        slider.minValue = this._min;
        slider.maxValue = this._max;
        slider.value = this._value;

        this.addChild(header);
        this.addChild(slider);

        this._titleLabel = titleLabel;
        this._valueLabel = valueLabel;
        this._slider = slider;

        slider.addEventListener('valueChange', () => {
            if (this._suppress) return;
            const snapped = this._snap(this._slider.value);
            if (snapped !== this._slider.value) {
                // Re-snap the thumb to the step grid without re-emitting.
                this._suppress = true;
                this._slider.value = snapped;
                this._suppress = false;
            }
            if (snapped !== this._value) {
                this._value = snapped;
                this._valueLabel.text = String(snapped);
                const data: NotifySliderValueEventData = {
                    eventName: NOTIFY_SLIDER_VALUE,
                    object: this,
                    value: snapped,
                };
                this.notify(data);
            }
        });
    }

    /** Clamp to `[min, max]` then snap to the nearest `step` from `min`. */
    private _snap(n: number): number {
        const clamped = Math.min(this._max, Math.max(this._min, n));
        const steps = Math.round((clamped - this._min) / this._step);
        return Math.min(this._max, this._min + steps * this._step);
    }

    /** Push the current value to the slider + label without emitting. */
    private _sync(): void {
        this._suppress = true;
        this._slider.value = this._value;
        this._suppress = false;
        this._valueLabel.text = String(this._value);
    }

    /** The group title shown in the header (left). */
    get title(): string {
        return this._titleLabel.text ?? '';
    }

    set title(value: string) {
        this._titleLabel.text = value ?? '';
    }

    /** The current numeric value (always within `[min, max]`, snapped to `step`). */
    get value(): number {
        return this._value;
    }

    set value(v: number) {
        const next = this._snap(Number.isFinite(v) ? v : 0);
        if (next !== this._value) {
            this._value = next;
            this._sync();
        }
    }

    /** Lower bound. Re-clamps the current value if it now falls below. */
    get min(): number {
        return this._min;
    }

    set min(v: number) {
        this._min = Number.isFinite(v) ? v : 0;
        this._slider.minValue = this._min;
        this.value = this._value;
    }

    /** Upper bound. Re-clamps the current value if it now falls above. */
    get max(): number {
        return this._max;
    }

    set max(v: number) {
        this._max = Number.isFinite(v) ? v : 100;
        this._slider.maxValue = this._max;
        this.value = this._value;
    }

    /** Snap granularity applied as the slider is dragged. */
    get step(): number {
        return this._step;
    }

    set step(v: number) {
        this._step = Number.isFinite(v) && v > 0 ? v : 1;
    }

    /** The underlying {@link Slider} (e.g. to tweak styling). */
    get slider(): Slider {
        return this._slider;
    }
}
