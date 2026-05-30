/**
 * Re-exports native Gamepad API globals for browser builds.
 *
 * Universal in modern browsers (Chrome 35+, Firefox 29+, Safari 10.1+);
 * the libmanette GJS backend stays GJS-only.
 *
 * The dynamic resolver in `@gjsify/resolve-npm/runtime-aliases.mjs` routes
 * `@gjsify/gamepad` here when `package.json#gjsify.runtimes.browser === "native"`.
 *
 * NOT used on Node — Node has no Gamepad global.
 */

export const Gamepad = globalThis.Gamepad;
export const GamepadButton = globalThis.GamepadButton;
export const GamepadEvent = globalThis.GamepadEvent;
export const GamepadHapticActuator = globalThis.GamepadHapticActuator;
