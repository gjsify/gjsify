// Gamepad Web API — global registration for GJS
// Patches navigator.getGamepads and registers GamepadEvent on globalThis.
// Side-effect module: import '@gjsify/gamepad/register'

import { GamepadEvent } from './gamepad-event.js';
import { GamepadManager } from './gamepad-manager.js';

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

// Register navigator.getGamepads() — but NEVER over a runtime that has its own.
//
// `runtimes.browser` and `runtimes.nativescript` are both `"native"`: on a
// browser the Gamepad API IS the platform's, and replacing it with the
// libmanette-backed manager would swap a working implementation for one that can
// only ever answer "no controllers" (a `--app browser` build maps `gi://Manette`
// to an empty module by design). The manager is not even constructed there —
// nothing probes, nothing is reported. Same guard the `GamepadEvent`
// registration below has always used.
if (typeof g.navigator!.getGamepads !== 'function') {
    const manager = new GamepadManager();
    g.navigator!.getGamepads = () => manager.getGamepads();
}

// Register GamepadEvent globally
if (typeof g.GamepadEvent === 'undefined') {
    g.GamepadEvent = GamepadEvent;
}
