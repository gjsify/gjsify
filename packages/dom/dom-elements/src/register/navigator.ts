// Registers: navigator stub (base navigator object for GJS)
// Gamepad support (navigator.getGamepads) is provided by @gjsify/gamepad/register

if (typeof (globalThis as Record<string, unknown>).navigator === 'undefined') {
    (globalThis as Record<string, unknown>).navigator = {};
}
