import type GLib from '@girs/glib-2.0';

/**
 * Convert GLib.Bytes to Uint8Array.
 *
 * Uses `GLib.Bytes.prototype.toArray()` — the GJS core override
 * (`refs/gjs/modules/core/overrides/GLib.js`), which `@gjsify/node-gi` mirrors
 * on its boxed-GBytes proxy. The legacy `imports.byteArray.fromGBytes()` does
 * the same thing but only exists when the GJS ambient globals are present, so
 * it throws a `ReferenceError` on a `--app node` bundle that was not given the
 * `@gjsify/node-gi/globals` shim.
 */
export function gbytesToUint8Array(bytes: GLib.Bytes): Uint8Array {
    return bytes.toArray();
}
