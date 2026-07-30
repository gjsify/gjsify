import type GLib from '@girs/glib-2.0';

/**
 * Convert GLib.Bytes to Uint8Array.
 *
 * Uses `GLib.Bytes.prototype.toArray()` — the GJS core override
 * (`refs/gjs/modules/core/overrides/GLib.js`), which `@gjsify/node-gi` mirrors
 * on its boxed-GBytes proxy — instead of the legacy
 * `imports.byteArray.fromGBytes()` (AGENTS.md § The legacy imports.* object is
 * NOT an API).
 */
export function gbytesToUint8Array(bytes: GLib.Bytes): Uint8Array {
    return bytes.toArray();
}
