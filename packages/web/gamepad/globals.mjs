/**
 * Re-exports native Gamepad API globals for browser builds.
 *
 * Universal in modern browsers (Chrome 35+, Firefox 29+, Safari 10.1+);
 * the libmanette GJS backend stays GJS-only.
 *
 * The dynamic resolver in `@gjsify/resolve-npm/runtime-aliases.mjs` routes
 * `@gjsify/gamepad` here when `package.json#gjsify.runtimes.browser === "native"`
 * — and the same rule routes it here for `nativescript`. That makes this file the
 * NON-GJS entry for the package root, so every root export a consumer may import
 * has to be answerable from here or the routed bundle dies with `MISSING_EXPORT`.
 *
 * NOT used on Node — Node has no Gamepad global (`gjsify.runtimes.node` is
 * `"partial"`, which is not rewritten: the real GJS body runs through
 * `@gjsify/node-gi`).
 */

export const Gamepad = globalThis.Gamepad;
export const GamepadButton = globalThis.GamepadButton;
export const GamepadEvent = globalThis.GamepadEvent;
export const GamepadHapticActuator = globalThis.GamepadHapticActuator;

/**
 * Whether this host has a gamepad backend at all — the same question the GJS
 * entry answers about `gi://Manette`, answered here about the runtime's own
 * Gamepad API, which on these targets IS the implementation.
 *
 * Kept REAL rather than stubbed or omitted: the answer is platform-independent in
 * the sense AGENTS.md means (§ Slot routing — "Exports whose answer IS
 * platform-independent stay REAL", as `hasOcspSupport()` → `false` does on
 * `@gjsify/tls`'s browser entry). Omitting it broke the README's own recommended
 * usage at BUILD time on `--app browser` and `--app nativescript`; a thrower
 * would break it at run time. `true` in a browser; `false` on NativeScript, which
 * ships no Gamepad API — both are the honest answer for that host.
 *
 * `async` to match the root entry's `Promise<boolean>` signature, where the
 * answer needs a dynamic `import('gi://Manette')`; here it is already known.
 */
export async function hasGamepadBackend() {
    return typeof globalThis.navigator?.getGamepads === 'function';
}
