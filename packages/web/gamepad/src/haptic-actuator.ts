// Gamepad Web API — GamepadHapticActuator, one per device source
// Reference: https://w3c.github.io/gamepad/#dom-gamepadhapticactuator
// libmanette: Device.rumble(strong_magnitude, weak_magnitude, milliseconds)
// GjsifyGamepad (SDL3): Device.rumble(low, high, ms) + Device.rumble_triggers(left, right, ms)

import type Manette from '@girs/manette-0.2';
import type { GjsifyGamepadDevice } from './sdl-namespace.js';
import type {
    GamepadHapticActuator,
    GamepadHapticEffectType,
    GamepadEffectParameters,
    GamepadHapticsResult,
} from './gamepad.js';

/** W3C magnitude 0..1 → a uint16 motor intensity, which both backends take. */
function toMotor(magnitude: number | undefined): number {
    return Math.round(Math.min(1, Math.max(0, magnitude ?? 1.0)) * 65535);
}

/**
 * Wraps libmanette's rumble support as a W3C GamepadHapticActuator.
 *
 * libmanette supports dual-rumble with strong/weak magnitude control
 * via `Device.rumble(strong_magnitude, weak_magnitude, milliseconds)`.
 * Magnitudes are in the range 0–65535 (uint16).
 */
export class ManetteHapticActuator implements GamepadHapticActuator {
    readonly effects: readonly GamepadHapticEffectType[];
    private _device: Manette.Device;

    constructor(device: Manette.Device) {
        this._device = device;
        this.effects = device.has_rumble() ? ['dual-rumble'] : [];
    }

    playEffect(type: GamepadHapticEffectType, params?: GamepadEffectParameters): Promise<GamepadHapticsResult> {
        if (type !== 'dual-rumble' || !this._device.has_rumble()) {
            return Promise.resolve('complete');
        }

        const duration = params?.duration ?? 200;
        this._device.rumble(
            toMotor(params?.strongMagnitude),
            toMotor(params?.weakMagnitude),
            Math.min(duration, 32767),
        );
        return Promise.resolve('complete');
    }

    reset(): Promise<GamepadHapticsResult> {
        if (this._device.has_rumble()) {
            this._device.rumble(0, 0, 0);
        }
        return Promise.resolve('complete');
    }
}

/**
 * The SDL3 shim's rumble as a W3C GamepadHapticActuator: `dual-rumble` drives the two
 * body motors, `trigger-rumble` the impulse triggers (Xbox One/Series controllers).
 *
 * It follows {@link ManetteHapticActuator}'s contract on purpose — same defaults (200 ms
 * at full strength when a parameter is left out), resolved at once with `'complete'` —
 * so a page behaves the same whichever backend its host has.
 */
export class SdlHapticActuator implements GamepadHapticActuator {
    readonly effects: readonly GamepadHapticEffectType[];

    constructor(private readonly _device: GjsifyGamepadDevice) {
        const effects: GamepadHapticEffectType[] = [];
        if (_device.has_rumble()) effects.push('dual-rumble');
        if (_device.has_trigger_rumble()) effects.push('trigger-rumble');
        this.effects = effects;
    }

    playEffect(type: GamepadHapticEffectType, params?: GamepadEffectParameters): Promise<GamepadHapticsResult> {
        const duration = Math.max(0, Math.round(params?.duration ?? 200));
        if (type === 'dual-rumble' && this.effects.includes('dual-rumble')) {
            this._device.rumble(toMotor(params?.strongMagnitude), toMotor(params?.weakMagnitude), duration);
        } else if (type === 'trigger-rumble' && this.effects.includes('trigger-rumble')) {
            this._device.rumble_triggers(toMotor(params?.leftTrigger), toMotor(params?.rightTrigger), duration);
        }
        return Promise.resolve('complete');
    }

    reset(): Promise<GamepadHapticsResult> {
        if (this.effects.includes('dual-rumble')) this._device.rumble(0, 0, 0);
        if (this.effects.includes('trigger-rumble')) this._device.rumble_triggers(0, 0, 0);
        return Promise.resolve('complete');
    }
}
