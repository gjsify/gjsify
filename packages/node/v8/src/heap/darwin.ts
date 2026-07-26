// Reference: Node.js lib/v8.js `getHeapStatistics()`, ps(1) (BSD).
// Reimplemented for GJS using GLib — macOS process-memory reader.
//
// macOS has no procfs. The canonical in-process source is Mach's
// `task_info(TASK_BASIC_INFO)` — the same call libuv makes for
// `process.memoryUsage()` — but Mach APIs are unreachable from GJS without a
// native bridge, so `ps(1)` is the only pure-GJS reader available.
//
// DEGRADED CONTRACT vs Linux: `ps` reports only `rss` and `vsz`, so `data`
// (Linux `VmData`) and `peak` (Linux `VmPeak`) stay `0` — `getHeapStatistics()`
// therefore reports `malloced_memory: 0` and `peak_malloced_memory: 0` here.

import GLib from '@girs/glib-2.0';

import type { ProcessMemory } from './types.js';

/**
 * Read this process's `rss` / `vsz` via `ps`.
 *
 * The pid is obtained without any extra binding by asking a short-lived shell
 * for its OWN parent — `g_spawn_command_line_sync()` forks us, so the shell's
 * `$PPID` is this process. Both `ps` columns are in KiB on macOS; `-o rss=`
 * suppresses the header so the output is a bare `<rss> <vsz>` line.
 *
 * Spawning for a memory reading is heavier than Linux's single file read, but
 * `getHeapStatistics()` is a diagnostics call, not a hot path. Returns `null`
 * on any failure so the caller falls back to the all-zero contract.
 */
export function readProcessMemory(): ProcessMemory | null {
    try {
        const [ok, stdout] = GLib.spawn_command_line_sync("sh -c 'ps -o rss=,vsz= -p $PPID'");
        if (!ok || !stdout) return null;
        const text = new TextDecoder().decode(stdout as unknown as Uint8Array).trim();
        const m = /^(\d+)\s+(\d+)$/.exec(text);
        if (!m) return null;
        return {
            virtual: parseInt(m[2], 10) * 1024,
            resident: parseInt(m[1], 10) * 1024,
            data: 0,
            peak: 0,
        };
    } catch {
        return null;
    }
}
