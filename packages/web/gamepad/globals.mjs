/**
 * Re-exports the native Gamepad API globals for browser + NativeScript builds; the
 * libmanette GJS backend stays GJS-only.
 *
 * `@gjsify/resolve-npm/runtime-aliases.mjs` routes `@gjsify/gamepad` here whenever
 * `gjsify.runtimes.<target> === "native"`, which makes this the NON-GJS entry for the
 * package root: every root export a consumer may import must be answerable from here or
 * the routed bundle dies with `MISSING_EXPORT`. NOT used on Node, whose slot is
 * `"partial"` and is not rewritten — the real GJS body runs through `@gjsify/node-gi`.
 */

export const Gamepad = globalThis.Gamepad;
export const GamepadButton = globalThis.GamepadButton;
export const GamepadEvent = globalThis.GamepadEvent;
export const GamepadHapticActuator = globalThis.GamepadHapticActuator;

/**
 * Whether this host has a gamepad backend at all — the GJS entry's question about
 * `gi://Manette`, answered here about the runtime's own Gamepad API, which on these
 * targets IS the implementation.
 *
 * REAL rather than stubbed or omitted (AGENTS.md § Slot routing: "Exports whose answer IS
 * platform-independent stay REAL"): omitting it broke the README's recommended usage at
 * BUILD time on `--app browser`/`--app nativescript`, and a thrower would break it at run
 * time. `true` in a browser, `false` on NativeScript, which ships no Gamepad API.
 *
 * `async` to match the root entry's `Promise<boolean>`, where the answer needs a dynamic
 * `import('gi://Manette')`.
 */
export async function hasGamepadBackend() {
    return typeof globalThis.navigator?.getGamepads === 'function';
}
