// Reference: Node.js lib/v8.js `getHeapStatistics()`.
// Windows process-memory reader — none available.
//
// Windows has no `/proc` and no `ps(1)`. The native source is
// `GetProcessMemoryInfo()` (psapi), which GLib does not wrap and GJS cannot
// call without a native bridge; shelling out to `wmic` / `tasklist` /
// PowerShell would cost hundreds of milliseconds per call and `wmic` is
// deprecated and removed from recent Windows builds.
//
// DEGRADED CONTRACT: `readProcessMemory()` returns `null`, so
// `getHeapStatistics()` reports the documented all-zero shape — every field
// present and numeric (which is what callers destructure), none of them
// meaningful. This is the same value the Linux reader already produced when
// `/proc` was unreadable, so no consumer sees a NEW shape.

import type { ProcessMemory } from './types.js';

export function readProcessMemory(): ProcessMemory | null {
    return null;
}
