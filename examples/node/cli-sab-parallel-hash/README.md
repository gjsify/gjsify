# @gjsify/example-node-cli-sab-parallel-hash

4-worker parallel SHA-256 hash over a [`@gjsify/sab-native`](../../../packages/node/sab-native/) `SharedBuffer`, with a cross-process atomics barrier and a single-threaded reference check.

Demonstrates the `@gjsify/sab-native` × `@gjsify/worker_threads` integration end-to-end:

| API | Demonstrated use |
|---|---|
| `SharedBuffer.create(size)` | `memfd_create(2)` + `mmap(MAP_SHARED)` shared region (4 MiB payload + 4 × u32 barrier + 4 × 32-byte digests) |
| `sb.setUint8` / `sb.readBytes` | Typed accessors; reads are zero-copy `GLib.Bytes` slices |
| `atomics.store32` / `atomics.load32` | SEQ_CST cross-process atomics (Linux futex underneath) |
| `Worker.postMessage(value, [sb])` | Transfers the memfd to a child via SCM_RIGHTS over inherited fd 3 |
| `workerData: { sb }` | Initial SharedBuffer hand-off at child spawn time |

## Workload

- Generate a deterministic 4 MiB payload from `(i * 31 + 7) & 0xff` so successive runs produce the same digest.
- Spawn 4 cross-process workers via `node:worker_threads`. Each worker mmaps the same memfd, hashes its 1 MiB slice with `GLib.Checksum.SHA256`, writes the digest into a per-slot 32-byte region, then bumps its barrier slot to signal completion.
- The parent polls the barrier on a 2 ms `setTimeout` cadence to keep the GJS main loop responsive (no blocking `futex_wait` on the single-threaded event loop).
- XOR-fold the four digests and verify the result against a single-threaded reference computed via `node:crypto`.

## Run

```bash
yarn build:gjs
yarn start
```

Output:

```
gjsify · cli-sab-parallel-hash
Runtime: Gjs | Workers: 4 | Payload: 4 MiB

Spawning 4 workers ...

  Worker 0: 1.00 MiB in   12 ms (83.3 MiB/s) → a3b1c4d5e6f78901…
  Worker 1: 1.00 MiB in   13 ms (76.9 MiB/s) → 7d9e2f1c4a3b5687…
  Worker 2: 1.00 MiB in   11 ms (90.9 MiB/s) → 4f6a8b2c1d3e5f70…
  Worker 3: 1.00 MiB in   12 ms (83.3 MiB/s) → e0c34a1b2d5f6789…

  XOR-folded:      deadbeef…
  reference:       deadbeef…

✓ digest matches in-process reference  (wall: 38 ms)
```

## Node

The example exits with a friendly note on Node. `@gjsify/sab-native` is a GJS-only Vala bridge — `memfd_create` / `SCM_RIGHTS` / `futex` are exposed through GObject introspection, with no Node-side equivalent (Node has native `SharedArrayBuffer` + `Atomics` for in-process; cross-process shared memory needs a different binding).

For an in-process Node analogue, use `node:worker_threads` with `SharedArrayBuffer` + `Atomics.store/load` directly. See [`tests/integration/worker-stress/src/sab-parallel-hash.spec.ts`](../../../tests/integration/worker-stress/src/sab-parallel-hash.spec.ts).

## Related

- [`tests/integration/worker-stress/`](../../../tests/integration/worker-stress/) — the stress test this example was lifted from.
- [`@gjsify/sab-native`](../../../packages/node/sab-native/) — the underlying Vala bridge.
- [`@gjsify/worker_threads`](../../../packages/node/worker_threads/) — the surface API that routes `SharedBuffer` through transferList.
