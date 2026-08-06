// Reference: Node.js lib/v8.js (`getHeapStatistics`)
// Reimplemented for GJS — process-memory readers behind a platform dispatch,
// mirroring the `linux.ts` / `darwin.ts` / `win32.ts`-behind-an-index shape of
// `@gjsify/os`.
//
// GJS/SpiderMonkey exposes no V8-style heap accounting (there is no
// `HeapStatistics` equivalent on `imports.system`), so the figures V8 would
// report about its own heap are approximated from the OS's view of the whole
// process. That approximation is the same on every platform; only the READER
// is platform-specific:
//
//   linux  — `/proc/self/status` (VmSize / VmRSS / VmData / VmPeak)
//   darwin — `ps -o rss=,vsz=` (no procfs; Mach `task_info` needs a native bridge)
//   win32  — none reachable; the all-zero contract below
//
// Detection is capability-based rather than name-based: we ask the filesystem
// what is actually there instead of parsing a `uname` string.
//
// WHY THIS IS NOT `@gjsify/utils/core`'s `readProcessMemory()`
//
// It is the same reading, and `host-process.ts` over there is the module that
// answers it for `@gjsify/process` — so this looks exactly like the duplication
// the anti-pattern rules say to lift. It was lifted, and reverted, because of a
// second rule that wins:
//
//   `@gjsify/v8` declares `runtimes.node: "none"`, and `audit-runtimes --check`
//   DERIVES that slot from the source's GJS-binding signals (`@girs/*` value
//   import, `gi://`, a `.imports?.gi` guard). Routing the reads through
//   `/core` — whose whole point is to be GJS-guarded rather than GJS-bound —
//   left this package looking like pure portable TS, and the checker rightly
//   suggested promoting the slot to `node: "native"`. That is a change to
//   published routing (ADR 0014 sends a `native` slot to `<pkg>/globals`), not
//   a comment, and `Detect runtime-triplet drift` is one of the three checks
//   that block a merge.
//
// So the two readers stay, deliberately, and the contract they share is the one
// thing that must not drift: both report BYTES, both return `null` rather than
// zeros when nothing can read, and both leave `data`/`peak` at `0` off procfs.
// Retiring this copy means first deciding what `@gjsify/v8`'s node slot should
// be — tracked in `status/open-todos.md`.

import GLib from '@girs/glib-2.0';

import * as darwin from './darwin.js';
import * as linux from './linux.js';
import type { ProcessMemory } from './types.js';
import * as win32 from './win32.js';

export type { ProcessMemory };

export type HeapPlatform = 'linux' | 'darwin' | 'win32' | 'unknown';

let _platform: HeapPlatform | null = null;

/**
 * Detect which reader applies, once per process:
 *
 *   - Windows — GLib returns native paths, so `g_get_current_dir()` is
 *     drive-rooted (`C:\…`) instead of `/`-rooted.
 *   - Linux — `/proc/self/status` exists (procfs is Linux-only).
 *   - macOS — no procfs, but the system version plist is always present.
 *   - anything else — no reader; the all-zero contract applies.
 */
export function detectHeapPlatform(): HeapPlatform {
    if (_platform !== null) return _platform;
    if (!GLib.get_current_dir().startsWith('/')) {
        _platform = 'win32';
    } else if (GLib.file_test('/proc/self/status', GLib.FileTest.EXISTS)) {
        _platform = 'linux';
    } else if (GLib.file_test('/System/Library/CoreServices/SystemVersion.plist', GLib.FileTest.EXISTS)) {
        _platform = 'darwin';
    } else {
        _platform = 'unknown';
    }
    return _platform;
}

/** All-zero fallback used when no reader on this platform can produce figures. */
const NO_MEMORY_INFO: ProcessMemory = { virtual: 0, resident: 0, data: 0, peak: 0 };

/** Read the current process's memory figures, or `null` if unavailable here. */
export function readProcessMemory(): ProcessMemory | null {
    switch (detectHeapPlatform()) {
        case 'linux':
            return linux.readProcessMemory();
        case 'darwin':
            return darwin.readProcessMemory();
        case 'win32':
            return win32.readProcessMemory();
        default:
            return null;
    }
}

export interface HeapStatistics {
    total_heap_size: number;
    total_heap_size_executable: number;
    total_physical_size: number;
    total_available_size: number;
    used_heap_size: number;
    heap_size_limit: number;
    malloced_memory: number;
    peak_malloced_memory: number;
    does_zap_garbage: number;
    number_of_native_contexts: number;
    number_of_detached_contexts: number;
    total_global_handles_size: number;
    used_global_handles_size: number;
    external_memory: number;
}

/**
 * Node-shaped `v8.getHeapStatistics()`.
 *
 * Every field is always present and numeric — Node never throws here and
 * neither do we. Fields V8 computes from engine internals we have no access to
 * (`heap_size_limit`, `does_zap_garbage`, the context/handle counters, …) are
 * reported as `0`; the memory-derived fields come from the platform reader
 * above and are `0` too when no reader is available (Windows, or a Linux host
 * with `/proc` masked). Callers that destructure the result keep working
 * everywhere; callers that need a meaningful number should check for `0`.
 */
export function getHeapStatistics(): HeapStatistics {
    const mem = readProcessMemory() ?? NO_MEMORY_INFO;
    return {
        total_heap_size: mem.virtual,
        total_heap_size_executable: 0,
        total_physical_size: mem.resident,
        total_available_size: 0,
        used_heap_size: mem.resident,
        heap_size_limit: 0,
        malloced_memory: mem.data,
        peak_malloced_memory: mem.peak,
        does_zap_garbage: 0,
        number_of_native_contexts: 0,
        number_of_detached_contexts: 0,
        total_global_handles_size: 0,
        used_global_handles_size: 0,
        external_memory: 0,
    };
}
