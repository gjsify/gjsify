// Gamepad Web API — Gamepad
// Reference: https://w3c.github.io/gamepad/#dom-gamepad

import { GamepadButton } from './gamepad-button.js';

/**
 * Represents a single gamepad device.
 * Instances are snapshots — they are not live-updating.
 * https://w3c.github.io/gamepad/#dom-gamepad
 */
export class Gamepad {
    readonly id: string;
    readonly index: number;
    readonly connected: boolean;
    readonly timestamp: number;
    readonly mapping: GamepadMappingType;
    readonly axes: readonly number[];
    readonly buttons: readonly GamepadButton[];
    readonly vibrationActuator: GamepadHapticActuator | null;

    constructor(init: {
        id: string;
        index: number;
        connected: boolean;
        timestamp: number;
        mapping: GamepadMappingType;
        axes: number[];
        buttons: GamepadButton[];
        vibrationActuator?: GamepadHapticActuator | null;
    }) {
        this.id = init.id;
        this.index = init.index;
        this.connected = init.connected;
        this.timestamp = init.timestamp;
        this.mapping = init.mapping;
        this.axes = Object.freeze([...init.axes]);
        this.buttons = Object.freeze(init.buttons);
        this.vibrationActuator = init.vibrationActuator ?? null;
    }

    get [Symbol.toStringTag]() {
        return 'Gamepad';
    }
}

export type GamepadMappingType = '' | 'standard' | 'xr-standard';

/**
 * Provides access to haptic feedback (rumble) on the gamepad.
 * https://w3c.github.io/gamepad/#dom-gamepadhapticactuator
 */
export interface GamepadHapticActuator {
    readonly effects: readonly GamepadHapticEffectType[];
    playEffect(type: GamepadHapticEffectType, params?: GamepadEffectParameters): Promise<GamepadHapticsResult>;
    reset(): Promise<GamepadHapticsResult>;
}

export type GamepadHapticEffectType = 'dual-rumble' | 'trigger-rumble';
export type GamepadHapticsResult = 'complete' | 'preempted';

export interface GamepadEffectParameters {
    duration?: number;
    startDelay?: number;
    strongMagnitude?: number;
    weakMagnitude?: number;
}
