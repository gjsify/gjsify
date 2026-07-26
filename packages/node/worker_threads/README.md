# @gjsify/worker_threads

GJS implementation of the Node.js `worker_threads` module.

GJS has no worker *threads* — one SpiderMonkey runtime per process — so a `Worker` here is a `Gio.Subprocess` running the same GJS binary. Everything else is built to match Node's surface on top of that: `MessageChannel` / `MessagePort` / `BroadcastChannel` with structured clone, `Worker` with file-based resolution and `workerData`, and `transferList` support for `ArrayBuffer` (in-process, zero-copy), `MessagePort` (in-process hand-off plus cross-process subprocess IPC) and `SharedBuffer`.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/worker_threads

# npm or yarn also work (e.g. adding it to an existing project):
npm install @gjsify/worker_threads
yarn add @gjsify/worker_threads
```

## Usage

```typescript
import { isMainThread, Worker, MessageChannel } from '@gjsify/worker_threads';

if (isMainThread) {
  const worker = new Worker(new URL('./worker.mjs', import.meta.url));
  worker.on('message', (msg) => console.log('from worker:', msg));
  worker.postMessage({ hello: 'world' });
}
```

## Shared memory — `SharedBuffer` and its platform scope

Stock GJS has no usable `SharedArrayBuffer`: SpiderMonkey gates the constructor behind a COOP/COEP-equivalent opt-in that GJS does not flip, and even if it did, SAB backing stores live in the per-runtime heap — which a subprocess `Worker` does not share. The substitute is **`SharedBuffer`** from the optional [`@gjsify/sab-native`](../sab-native/README.md) bridge, transferred to a worker by passing it through `workerData` or `postMessage`.

**Cross-process `SharedBuffer` is Linux-only today.** See [ADR 0013](../../../docs/adr/0013-sab-native-platform-scope.md) for the reasoning.

| Platform | Cross-process `SharedBuffer` |
|---|---|
| Linux (`x86_64`, `aarch64`, `ppc64`, `s390x`, `riscv64`) | ✅ Supported — `memfd_create(2)` + `mmap(MAP_SHARED)`, `SYS_futex` for `wait`/`notify`, `SCM_RIGHTS` to hand the descriptor to the child |
| macOS | ❌ Not yet — planned via `shm_open` + `os_sync_wait_on_address` (macOS 14.4+), blocked on a macOS prebuild |
| Windows | ❌ Not supported — GJS does not run on Windows, and Windows has no cross-process address-keyed wait primitive |

### What happens without it

Nothing crashes, and **the rest of `worker_threads` is unaffected**. When `@gjsify/sab-native` is not installed or has no prebuild for the current platform:

- `Worker`, `postMessage`, `workerData`, `MessageChannel`, `MessagePort`, `BroadcastChannel` and `transferList` for `ArrayBuffer`/`MessagePort` all work exactly as before — the `SCM_RIGHTS` side-channel is simply never created.
- Only `SharedBuffer` is unavailable. You cannot construct one (`SharedBuffer.create()` throws an error naming the platform scope), so no `SharedBuffer` can reach `postMessage` in the first place.
- If a `SharedBuffer` placeholder somehow reaches a worker whose typelib is missing, the worker bootstrap throws `SharedBuffer placeholder arrived but @gjsify/sab-native typelib not loaded` rather than failing obscurely.

Always gate `SharedBuffer` use on the availability predicate:

```typescript
import { hasNativeSab, SharedBuffer } from '@gjsify/sab-native';
import { Worker } from '@gjsify/worker_threads';

if (hasNativeSab()) {
  const shared = SharedBuffer.create(4096);
  const worker = new Worker(new URL('./worker.mjs', import.meta.url), { workerData: { shared } });
  // …parent and worker now map the same backing store
} else {
  // Fall back to message passing — correct everywhere, just copies.
}
```

## License

MIT
