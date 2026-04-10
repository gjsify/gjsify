// Registers: navigator stub (base navigator object for GJS)
// Gamepad support (navigator.getGamepads) is provided by @gjsify/gamepad/register

if (typeof (globalThis as any).navigator === 'undefined') {
    (globalThis as any).navigator = {};
}
