// AudioParam — holds a value with scheduling support.
// Phase 1: direct .value + setTargetAtTime (used by Excalibur.js).
// Reference: https://developer.mozilla.org/en-US/docs/Web/API/AudioParam

import GLib from 'gi://GLib?version=2.0';

export class AudioParam {
    readonly defaultValue: number;
    readonly minValue: number;
    readonly maxValue: number;

    /** @internal callback invoked when value changes */
    _onChange: ((value: number) => void) | null = null;

    private _value: number;
    private _rampTimerId: number | null = null;

    constructor(defaultValue = 0, minValue = -3.4028235e38, maxValue = 3.4028235e38) {
        this.defaultValue = defaultValue;
        this.minValue = minValue;
        this.maxValue = maxValue;
        this._value = defaultValue;
    }

    get value(): number {
        return this._value;
    }

    set value(v: number) {
        this._cancelRamp();
        this._value = Math.max(this.minValue, Math.min(this.maxValue, v));
        this._onChange?.(this._value);
    }

    setValueAtTime(value: number, _startTime: number): AudioParam {
        // Phase 1: apply immediately (ignore scheduling)
        this.value = value;
        return this;
    }

    linearRampToValueAtTime(value: number, _endTime: number): AudioParam {
        // Phase 1: apply immediately
        this.value = value;
        return this;
    }

    exponentialRampToValueAtTime(value: number, _endTime: number): AudioParam {
        // Phase 1: apply immediately
        this.value = value;
        return this;
    }

    setTargetAtTime(target: number, _startTime: number, timeConstant: number): AudioParam {
        // Exponential approach used by Excalibur for smooth volume transitions.
        // After each timeConstant interval, value moves ~63.2% closer to target.
        this._cancelRamp();

        if (timeConstant <= 0) {
            this.value = target;
            return this;
        }

        const stepMs = Math.max(10, Math.round(timeConstant * 100)); // ~10 steps per timeConstant
        this._rampTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, stepMs, () => {
            const diff = target - this._value;
            if (Math.abs(diff) < 0.001) {
                this._value = target;
                this._onChange?.(this._value);
                this._rampTimerId = null;
                return GLib.SOURCE_REMOVE;
            }
            // Exponential approach: move 1 - e^(-dt/tc) closer per step
            const factor = 1 - Math.exp(-stepMs / (timeConstant * 1000));
            this._value += diff * factor;
            this._onChange?.(this._value);
            return GLib.SOURCE_CONTINUE;
        }, null);

        return this;
    }

    setValueCurveAtTime(_values: Float32Array, _startTime: number, _duration: number): AudioParam {
        // Phase 1: no-op
        return this;
    }

    cancelScheduledValues(_startTime: number): AudioParam {
        this._cancelRamp();
        return this;
    }

    cancelAndHoldAtTime(_cancelTime: number): AudioParam {
        this._cancelRamp();
        return this;
    }

    private _cancelRamp(): void {
        if (this._rampTimerId !== null) {
            GLib.source_remove(this._rampTimerId);
            this._rampTimerId = null;
        }
    }
}
