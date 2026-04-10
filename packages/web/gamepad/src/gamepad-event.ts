// Gamepad Web API — GamepadEvent
// Reference: https://w3c.github.io/gamepad/#dom-gamepadevent

import { Event } from '@gjsify/dom-events';
import type { Gamepad } from './gamepad.js';

export interface GamepadEventInit {
    gamepad: Gamepad;
    bubbles?: boolean;
    cancelable?: boolean;
    composed?: boolean;
}

/**
 * Fired on the Window when a gamepad is connected or disconnected.
 * https://w3c.github.io/gamepad/#dom-gamepadevent
 */
export class GamepadEvent extends Event {
    readonly gamepad: Gamepad;

    constructor(type: string, eventInitDict: GamepadEventInit) {
        super(type, eventInitDict);
        this.gamepad = eventInitDict.gamepad;
    }

    get [Symbol.toStringTag]() {
        return 'GamepadEvent';
    }
}
