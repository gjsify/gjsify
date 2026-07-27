# @gjsify/sab-native

Optional native Vala bridge providing cross-process shared memory and atomics for `@gjsify/worker_threads` on GJS. Implements `SharedBuffer` via Linux `memfd_create` + `mmap(MAP_SHARED)` with typed accessors and SEQ_CST atomics backed by `__atomic_*` GCC builtins and `SYS_futex` for wait/notify. Also exposes `FdChannel` for passing file descriptors between processes via SCM_RIGHTS over a Unix-domain socket.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Platform support

**Cross-process `SharedBuffer` is Linux-only today.** This is a property of the package, not of your installation — see [ADR 0013](../../../docs/adr/0013-sab-native-platform-scope.md) for the full reasoning.

| Platform | Cross-process `SharedBuffer` | Notes |
|---|---|---|
| Linux `x86_64`, `aarch64`, `ppc64`, `s390x`, `riscv64` | ✅ Supported | `memfd_create(2)` + `mmap(MAP_SHARED)`, `SYS_futex` (non-private flavour, so waits match across processes), `SCM_RIGHTS`. Prebuilds ship for all five architectures. |
| macOS | ❌ Not yet | Planned, design fixed: `shm_open` + `ftruncate` + immediate `shm_unlink` for the region, unchanged `SCM_RIGHTS`, and `os_sync_wait_on_address` / `os_sync_wake_by_address_*` with the `…_SHARED` flag for wait/notify. Requires **macOS 14.4+**. Blocked on a macOS prebuild CI job. |
| Windows | ❌ Not supported | Blocked twice over: GJS itself does not run on Windows, and Windows has no cross-process address-keyed wait — `WaitOnAddress`/`WakeByAddressSingle` are process-local by documentation, so `wait32`/`notify32` would need a different contract (named kernel objects). Revisit only via a new ADR. |
| Node.js / browser | ❌ n/a | GJS-only package (`runtimes.node`/`.browser` = `none`). |

### What happens where it is unsupported

There is exactly one gate, and it never crashes:

- `hasNativeSab()` returns `false`. **Always check it first.**
- `SharedBuffer.create()` / `SharedBuffer.fromFd()` throw an `Error` naming the platform scope (not a broken install).
- `nativeSab` and `fdChannel` are `null`.
- `@gjsify/worker_threads` keeps working in full — `Worker`, `postMessage`, `MessageChannel`/`MessagePort` and `transferList` for `ArrayBuffer`/`MessagePort` are all unaffected. Only `SharedBuffer` itself is unavailable, because the `SCM_RIGHTS` side-channel is simply never created.

A stale or partially-loaded typelib is treated as unavailable too, so `hasNativeSab()` can never report `true` for a module that would then fail mid-call.

## Installation

This package is loaded automatically by `@gjsify/worker_threads` when the prebuild is present. Install it explicitly to enable `SharedBuffer` cross-process transfers:

```bash
gjsify install @gjsify/sab-native

# npm or yarn also work:
npm install @gjsify/sab-native
yarn add @gjsify/sab-native
```

## Usage

```typescript
// Loaded automatically by @gjsify/worker_threads.
// Direct use requires checking availability first:
import { hasNativeSab, SharedBuffer, atomics } from '@gjsify/sab-native';

if (hasNativeSab()) {
    // Allocate 4 KB of shared memory
    const buf = SharedBuffer.create(4096);
    console.log('fd:', buf.fd, 'size:', buf.byteLength);

    // Typed read/write
    buf.setInt32LE(0, 42);
    console.log(buf.getInt32LE(0)); // 42

    // Atomic operations (SEQ_CST)
    atomics.store32(buf, 0, 1);
    const prev = atomics.add32(buf, 0, 10);
    console.log('prev:', prev, 'now:', atomics.load32(buf, 0));

    buf.close();
}
```

Ships as a prebuilt `.so` + `.typelib` for `linux-{x64,arm64,ppc64,s390x,riscv64}`.

## License

MIT
