// Reference: Node.js lib/v8.js (`getHeapStatistics`)
//
// GJS/SpiderMonkey exposes no V8-style heap accounting (there is no
// `HeapStatistics` equivalent on `imports.system`), so the figures V8 would
// report about its own heap are approximated from the OS's view of the whole
// process.
//
// THE READER USED TO LIVE HERE, IN THREE FILES, AND NOW DOES NOT
//
// `heap/{linux,darwin,win32}.ts` held one reader each behind a capability
// dispatch. `@gjsify/process`'s `memoryUsage()` needed exactly the same
// readings and had grown its OWN copy of the Linux half — with no darwin
// branch, which is how `process.memoryUsage().rss` came back `0` on macOS while
// `v8.getHeapStatistics()` on the same host answered correctly. Two copies of
// one fact, and it was the copy without the branch that shipped in the more
// widely used API.
//
// So the readers moved to `@gjsify/utils/core`'s `host-process` module — the
// place ADR 0014 keeps GJS-guarded host questions, beside `host-os` — and both
// packages now ask it. The capability dispatch (procfs present? `ps(1)`
// available?) moved with them unchanged; what is left here is the V8 SHAPE,
// which is this package's actual subject.

import { readProcessMemory, type ProcessMemory } from '@gjsify/utils/core';

export type { ProcessMemory };
export { readProcessMemory };

/** All-zero fallback used when no reader on this platform can produce figures. */
const NO_MEMORY_INFO: ProcessMemory = { virtual: 0, resident: 0, data: 0, peak: 0 };

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
 * reported as `0`; the memory-derived fields come from the shared host reader
 * and are `0` too when no reader is available (Windows, or a Linux host with
 * `/proc` masked). Callers that destructure the result keep working everywhere;
 * callers that need a meaningful number should check for `0`.
 *
 * DEGRADED CONTRACT off procfs: `ps(1)` reports no data-segment or peak
 * columns, so on macOS `malloced_memory` and `peak_malloced_memory` are `0`
 * while `total_heap_size` / `used_heap_size` are real. Reaching them needs
 * Mach's `task_info(TASK_BASIC_INFO)`, which is not callable from GJS without a
 * native bridge.
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
