// Gamepad Web API — GamepadHapticActuator, one per device source
// Reference: https://w3c.github.io/gamepad/#dom-gamepadhapticactuator
// libmanette: Device.rumble(strong_magnitude, weak_magnitude, milliseconds)
// GjsifyGamepad (SDL3): Device.rumble(low, high, ms) + Device.rumble_triggers(left, right, ms)

import type Manette from '@girs/manette-0.2';
import { DOMException } from '@gjsify/dom-events';

import type {
    GamepadEffectParameters,
    GamepadHapticActuator,
    GamepadHapticEffectType,
    GamepadHapticsResult,
} from './gamepad.js';
import type { GjsifyGamepadDevice } from './sdl-namespace.js';

/**
 * The longest effect (`startDelay + duration`) accepted, in ms — the spec's recommended
 * maximum, and what Chromium enforces. It is also below both backends' own cap (SDL:
 * 0xFFFF ms; libmanette: a signed 16-bit ms count), so a valid effect is never cut short.
 */
export const MAX_HAPTIC_EFFECT_DURATION_MS = 5000;

/** The motor intensities one effect asks for, each a uint16 both backends take. */
interface HapticMotors {
    strong: number;
    weak: number;
    leftTrigger: number;
    rightTrigger: number;
}

/** W3C magnitude 0..1 (already validated) → a uint16 motor intensity. */
function toMotor(magnitude: number): number {
    return Math.round(magnitude * 65535);
}

function isUnitMagnitude(value: number): boolean {
    return Number.isFinite(value) && value >= 0 && value <= 1;
}

function isMilliseconds(value: number): boolean {
    return Number.isFinite(value) && value >= 0;
}

interface PlayingEffect {
    resolve: (result: GamepadHapticsResult) => void;
    timer: ReturnType<typeof setTimeout> | null;
}

/**
 * The W3C `playEffect()` / `reset()` algorithm, shared by every device source so a page
 * behaves the same whichever backend its host has. A subclass only says which effects its
 * device has and how to start and stop the motors.
 *
 * What the spec asks for, and why each step is here rather than left to the device:
 * - parameters default to 0 (the IDL's defaults) and are validated first: a magnitude
 *   outside 0..1 or an effect longer than {@link MAX_HAPTIC_EFFECT_DURATION_MS} rejects
 *   with a `TypeError` instead of being clamped into something the page did not ask for;
 * - an effect the device cannot play rejects with `NotSupportedError` — resolving it
 *   `'complete'` would tell the page it rumbled when nothing moved;
 * - the promise resolves when the effect has PLAYED (`startDelay + duration`), or
 *   `'preempted'` when a later `playEffect()` / `reset()` interrupts it — which is how a
 *   page sequences effects, and why resolving at once would break it.
 */
abstract class RumbleHapticActuator implements GamepadHapticActuator {
    abstract readonly effects: readonly GamepadHapticEffectType[];
    private _playing: PlayingEffect | null = null;

    /** Start the motors for `durationMs`; the device stops them on its own afterwards. */
    protected abstract _start(type: GamepadHapticEffectType, motors: HapticMotors, durationMs: number): void;
    /** Stop every motor now. */
    protected abstract _stop(): void;

    playEffect(type: GamepadHapticEffectType, params: GamepadEffectParameters = {}): Promise<GamepadHapticsResult> {
        const duration = params.duration ?? 0;
        const startDelay = params.startDelay ?? 0;
        const magnitudes = {
            strong: params.strongMagnitude ?? 0,
            weak: params.weakMagnitude ?? 0,
            leftTrigger: params.leftTrigger ?? 0,
            rightTrigger: params.rightTrigger ?? 0,
        };
        if (type !== 'dual-rumble' && type !== 'trigger-rumble') {
            return Promise.reject(new TypeError(`Unknown haptic effect type '${String(type)}'.`));
        }
        if (
            !isMilliseconds(duration) ||
            !isMilliseconds(startDelay) ||
            duration + startDelay > MAX_HAPTIC_EFFECT_DURATION_MS
        ) {
            return Promise.reject(
                new TypeError(`A haptic effect lasts 0..${MAX_HAPTIC_EFFECT_DURATION_MS} ms including its startDelay.`),
            );
        }
        // dual-rumble validates only the body motors; trigger-rumble all four.
        const checked = type === 'dual-rumble' ? [magnitudes.strong, magnitudes.weak] : Object.values(magnitudes);
        if (!checked.every(isUnitMagnitude)) {
            return Promise.reject(new TypeError('Haptic effect magnitudes are 0..1.'));
        }

        this._preempt();
        if (!this.effects.includes(type)) {
            return Promise.reject(
                new DOMException(`This gamepad cannot play a '${type}' effect.`, 'NotSupportedError'),
            );
        }

        const motors: HapticMotors = {
            strong: toMotor(magnitudes.strong),
            weak: toMotor(magnitudes.weak),
            leftTrigger: toMotor(magnitudes.leftTrigger),
            rightTrigger: toMotor(magnitudes.rightTrigger),
        };
        return new Promise<GamepadHapticsResult>((resolve) => {
            const playing: PlayingEffect = { resolve, timer: null };
            this._playing = playing;
            const finish = () => {
                if (this._playing !== playing) return;
                this._playing = null;
                resolve('complete');
            };
            const start = () => {
                if (this._playing !== playing) return;
                if (duration === 0) {
                    finish();
                    return;
                }
                this._start(type, motors, Math.round(duration));
                playing.timer = setTimeout(finish, duration);
            };
            if (startDelay > 0) playing.timer = setTimeout(start, startDelay);
            else start();
        });
    }

    reset(): Promise<GamepadHapticsResult> {
        this._preempt();
        return Promise.resolve('complete');
    }

    /** Stop the effect in flight, if any, and resolve its promise `'preempted'`. */
    private _preempt(): void {
        const playing = this._playing;
        if (!playing) return;
        this._playing = null;
        if (playing.timer !== null) clearTimeout(playing.timer);
        this._stop();
        playing.resolve('preempted');
    }
}

/**
 * libmanette's rumble as a W3C GamepadHapticActuator: `dual-rumble` only, via
 * `Device.rumble(strong_magnitude, weak_magnitude, milliseconds)`.
 */
export class ManetteHapticActuator extends RumbleHapticActuator {
    readonly effects: readonly GamepadHapticEffectType[];

    constructor(private readonly _device: Manette.Device) {
        super();
        this.effects = _device.has_rumble() ? ['dual-rumble'] : [];
    }

    protected _start(_type: GamepadHapticEffectType, motors: HapticMotors, durationMs: number): void {
        this._device.rumble(motors.strong, motors.weak, durationMs);
    }

    protected _stop(): void {
        this._device.rumble(0, 0, 0);
    }
}

/**
 * The SDL3 shim's rumble as a W3C GamepadHapticActuator: `dual-rumble` drives the two
 * body motors; `trigger-rumble` drives the impulse triggers (Xbox One/Series controllers)
 * AND the body motors, since its parameters carry both.
 */
export class SdlHapticActuator extends RumbleHapticActuator {
    readonly effects: readonly GamepadHapticEffectType[];

    constructor(private readonly _device: GjsifyGamepadDevice) {
        super();
        const effects: GamepadHapticEffectType[] = [];
        if (_device.has_rumble()) effects.push('dual-rumble');
        if (_device.has_trigger_rumble()) effects.push('trigger-rumble');
        this.effects = effects;
    }

    protected _start(type: GamepadHapticEffectType, motors: HapticMotors, durationMs: number): void {
        if (type === 'trigger-rumble') {
            this._device.rumble_triggers(motors.leftTrigger, motors.rightTrigger, durationMs);
            // Body motors too, when the controller has them (the spec's trigger-rumble
            // carries strong/weak magnitudes as well).
            if (!this.effects.includes('dual-rumble')) return;
        }
        this._device.rumble(motors.strong, motors.weak, durationMs);
    }

    protected _stop(): void {
        if (this.effects.includes('dual-rumble')) this._device.rumble(0, 0, 0);
        if (this.effects.includes('trigger-rumble')) this._device.rumble_triggers(0, 0, 0);
    }
}
