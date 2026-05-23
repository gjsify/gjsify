// Gamepad Web API — global registration for GJS
// Patches navigator.getGamepads and registers GamepadEvent on globalThis.
// Side-effect module: import '@gjsify/gamepad/register'

import { GamepadEvent } from './gamepad-event.js';
import { GamepadManager } from './gamepad-manager.js';

const manager = new GamepadManager();

/** Module-local typed view of the globals this file writes. */
interface _GamepadGlobals {
    navigator?: { getGamepads?: () => (Gamepad | null)[] };
    GamepadEvent?: typeof GamepadEvent;
}

const g = globalThis as unknown as _GamepadGlobals;

// Ensure navigator object exists
if (typeof g.navigator === 'undefined') {
    g.navigator = {};
}

// Register navigator.getGamepads()
g.navigator!.getGamepads = () => manager.getGamepads();

// Register GamepadEvent globally
if (typeof g.GamepadEvent === 'undefined') {
    g.GamepadEvent = GamepadEvent;
}
