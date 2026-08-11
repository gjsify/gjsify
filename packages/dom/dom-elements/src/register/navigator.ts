// The bare `navigator` object only; `navigator.getGamepads` comes from @gjsify/gamepad/register.

if (typeof (globalThis as Record<string, unknown>).navigator === 'undefined') {
    (globalThis as Record<string, unknown>).navigator = {};
}
