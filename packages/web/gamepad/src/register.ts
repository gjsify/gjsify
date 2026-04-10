// Gamepad Web API — global registration for GJS
// Patches navigator.getGamepads and registers GamepadEvent on globalThis.
// Side-effect module: import '@gjsify/gamepad/register'

import { GamepadEvent } from './gamepad-event.js';
import { GamepadManager } from './gamepad-manager.js';

const manager = new GamepadManager();

// Ensure navigator object exists
if (typeof (globalThis as any).navigator === 'undefined') {
    (globalThis as any).navigator = {};
}

// Register navigator.getGamepads()
(globalThis as any).navigator.getGamepads = () => manager.getGamepads();

// Register GamepadEvent globally
if (typeof (globalThis as any).GamepadEvent === 'undefined') {
    (globalThis as any).GamepadEvent = GamepadEvent;
}
