import type GLib from '@girs/glib-2.0';

declare const imports: { byteArray: { fromGBytes(input: GLib.Bytes): Uint8Array } };

/**
 * Convert GLib.Bytes to Uint8Array using GJS's byteArray module.
 * This wraps the GJS-specific `imports.byteArray.fromGBytes()` API
 * with proper typing to eliminate `as any` casts throughout the codebase.
 */
export function gbytesToUint8Array(bytes: GLib.Bytes): Uint8Array {
  return imports.byteArray.fromGBytes(bytes);
}
