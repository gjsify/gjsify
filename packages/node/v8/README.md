# @gjsify/v8

GJS implementation of the Node.js `v8` module. Provides V8-wire-format
`serialize`/`deserialize` (`Serializer`, `Deserializer`, `DefaultSerializer`,
`DefaultDeserializer`) plus `getHeapStatistics()`.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/v8

# npm or yarn also work (e.g. adding it to an existing project):
npm install @gjsify/v8
yarn add @gjsify/v8
```

## Usage

```typescript
import { getHeapStatistics, serialize, deserialize } from '@gjsify/v8';

console.log(getHeapStatistics());

const buf = serialize({ hello: 'world' });
const obj = deserialize(buf);
```

## `getHeapStatistics()` — what the numbers mean

Node's `v8.getHeapStatistics()` reports V8's own accounting of its heap.
GJS runs on SpiderMonkey, which exposes no equivalent surface (there is nothing
like `HeapStatistics` on `imports.system`), so the memory-derived fields are
approximated from the **operating system's view of the whole process** instead
of the JS heap alone. Fields V8 computes from engine internals we cannot reach
are reported as `0`.

The result always has all 14 Node fields, always numeric — this function never
throws, on any platform.

| Field | Value on GJS |
|---|---|
| `total_heap_size` | process virtual size |
| `total_physical_size` | process resident set size |
| `used_heap_size` | process resident set size |
| `malloced_memory` | process data-segment size (Linux only) |
| `peak_malloced_memory` | peak process virtual size (Linux only) |
| `total_heap_size_executable`, `total_available_size`, `heap_size_limit`, `does_zap_garbage`, `number_of_native_contexts`, `number_of_detached_contexts`, `total_global_handles_size`, `used_global_handles_size`, `external_memory` | `0` — no SpiderMonkey equivalent |

### Platform support

The reader lives in `src/heap/` (`linux.ts` / `darwin.ts` / `win32.ts` behind an
`index.ts`, mirroring `@gjsify/os`). Detection is capability-based — the
filesystem is probed for what is actually there, not a `uname` string parsed.

| Platform | Source | Coverage |
|---|---|---|
| Linux (incl. Android, Flatpak, containers) | `/proc/self/status` — one `g_file_get_contents()`, no subprocess | `VmSize`, `VmRSS`, `VmData`, `VmPeak` |
| macOS | `ps -o rss=,vsz=` — no procfs; Mach's `task_info()` (what libuv uses) needs a native bridge | `rss`, `vsz` only; `malloced_memory` and `peak_malloced_memory` stay `0` |
| Windows | none reachable | all memory fields `0` — see below |
| any other POSIX | none reachable | all memory fields `0` |

**Degraded contract on Windows.** There is no `/proc` and no `ps(1)`. The native
source is `GetProcessMemoryInfo()` (psapi), which GLib does not wrap and GJS
cannot call without a native bridge; shelling out to `wmic` / `tasklist` /
PowerShell would cost hundreds of milliseconds per call and `wmic` is deprecated
and removed from recent Windows builds. `getHeapStatistics()` therefore returns
the **all-zero** shape: every field present and numeric so destructuring callers
keep working, none of them meaningful. This is byte-for-byte the same value the
Linux reader already produced when `/proc` was unreadable, so no consumer sees a
new shape. Callers that need a real number should check for `0`.

### Not implemented

`getHeapSpaceStatistics()` returns `[]`, `getHeapCodeStatistics()` returns
zeros, and `writeHeapSnapshot()` / `setFlagsFromString()` / the profiler and
`promiseHooks` surfaces are stubs — all of them are V8-internal APIs with no
SpiderMonkey counterpart.

## License

MIT
