# @gjsify/sab-native

Optional native Vala bridge providing cross-process shared memory and atomics for `@gjsify/worker_threads` on GJS. Implements `SharedBuffer` via Linux `memfd_create` + `mmap(MAP_SHARED)` with typed accessors and SEQ_CST atomics backed by `__atomic_*` GCC builtins and `SYS_futex` for wait/notify. Also exposes `FdChannel` for passing file descriptors between processes via SCM_RIGHTS over a Unix-domain socket.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

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

Ships as a prebuilt `.so` + `.typelib` for `linux-{x86_64,aarch64,ppc64,s390x,riscv64}`.

## License

MIT
