// Gamepad Web API — GamepadHapticActuator backed by libmanette
// Reference: https://w3c.github.io/gamepad/#dom-gamepadhapticactuator
// libmanette: Device.rumble(strong_magnitude, weak_magnitude, milliseconds)

import type Manette from '@girs/manette-0.2';
import type {
    GamepadHapticActuator,
    GamepadHapticEffectType,
    GamepadEffectParameters,
    GamepadHapticsResult,
} from './gamepad.js';

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
        // W3C spec uses 0.0–1.0, libmanette uses 0–65535 (uint16)
        const strong = Math.round((params?.strongMagnitude ?? 1.0) * 65535);
        const weak = Math.round((params?.weakMagnitude ?? 1.0) * 65535);

        this._device.rumble(strong, weak, Math.min(duration, 32767));
        return Promise.resolve('complete');
    }

    reset(): Promise<GamepadHapticsResult> {
        if (this._device.has_rumble()) {
            this._device.rumble(0, 0, 0);
        }
        return Promise.resolve('complete');
    }
}
