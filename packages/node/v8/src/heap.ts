// Reference: Node.js lib/v8.js (getHeapStatistics)
// Reimplemented for GJS using /proc/self/status (Linux)

import GLib from '@girs/glib-2.0';

function readProcStatus(): Map<string, number> {
  const map = new Map<string, number>();
  try {
    const [ok, contents] = GLib.file_get_contents('/proc/self/status');
    if (!ok || !contents) return map;
    const text = new TextDecoder().decode(contents as unknown as Uint8Array);
    for (const line of text.split('\n')) {
      const m = /^(\w+):\s+(\d+)(\s+kB)?/.exec(line);
      if (m) map.set(m[1], parseInt(m[2]) * (m[3] ? 1024 : 1));
    }
  } catch { /* /proc not available on non-Linux */ }
  return map;
}

export function getHeapStatistics(): {
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
} {
  const proc = readProcStatus();
  return {
    total_heap_size: proc.get('VmSize') ?? 0,
    total_heap_size_executable: 0,
    total_physical_size: proc.get('VmRSS') ?? 0,
    total_available_size: 0,
    used_heap_size: proc.get('VmRSS') ?? 0,
    heap_size_limit: 0,
    malloced_memory: proc.get('VmData') ?? 0,
    peak_malloced_memory: proc.get('VmPeak') ?? 0,
    does_zap_garbage: 0,
    number_of_native_contexts: 0,
    number_of_detached_contexts: 0,
    total_global_handles_size: 0,
    used_global_handles_size: 0,
    external_memory: 0,
  };
}
