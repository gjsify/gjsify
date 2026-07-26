// Reference: Node.js lib/v8.js `getHeapStatistics()` (V8 `HeapStatistics`),
//   proc(5) — `/proc/[pid]/status`.
// Reimplemented for GJS using GLib — Linux process-memory reader.

import GLib from '@girs/glib-2.0';

import type { ProcessMemory } from './types.js';

/**
 * Read `VmSize` / `VmRSS` / `VmData` / `VmPeak` out of `/proc/self/status`.
 *
 * procfs is Linux-only but is present on every mainstream distribution and
 * inside Flatpak/OCI containers, so this is the fast path (a single
 * `g_file_get_contents()`, no subprocess). Returns `null` when procfs is not
 * readable so the caller can fall back to the documented all-zero contract.
 */
export function readProcessMemory(): ProcessMemory | null {
    let text: string;
    try {
        const [ok, contents] = GLib.file_get_contents('/proc/self/status');
        if (!ok || !contents) return null;
        text = new TextDecoder().decode(contents as unknown as Uint8Array);
    } catch {
        return null;
    }

    const fields = new Map<string, number>();
    for (const line of text.split('\n')) {
        const m = /^(\w+):\s+(\d+)(\s+kB)?/.exec(line);
        if (m) fields.set(m[1], parseInt(m[2]) * (m[3] ? 1024 : 1));
    }
    if (fields.size === 0) return null;

    return {
        virtual: fields.get('VmSize') ?? 0,
        resident: fields.get('VmRSS') ?? 0,
        data: fields.get('VmData') ?? 0,
        peak: fields.get('VmPeak') ?? 0,
    };
}
