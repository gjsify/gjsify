# 133. `child_process.fork` and `Worker` share one IPC channel, extracted from `worker_threads` into its own package

- Status: **Proposed** (2026-11-03)
- Date: 2026-11-03
- Deciders: Pascal Garber
- Related: [ADR 0132](0132-ai-capabilities-share-one-shape.md) § 8 (process isolation for GPU
  engines, the need that surfaced this); `packages/node/worker_threads`,
  `packages/node/child_process`, `packages/node/process`, `packages/web/web-worker`

## Context

`@gjsify/child_process` has `exec`, `execFile` and `spawn`, but no `fork`. A Node package that
forks, or merely imports `fork`, does not link in a GJS bundle. Stamped hit exactly this:
`node-llama-cpp` imports `fork` at module level, so Stamped carries a `child_process` alias that
picks Node's builtin or the GJS polyfill at run time and throws for whatever is missing
(`packages/semantic/src/child-process.ts`, "gjsify gap, unfixed: `fork`"). ADR 0132 § 8 wants GPU
engines isolated in a child process, which is the same gap from the other side.

The hard half already exists, in the wrong place. `@gjsify/worker_threads` spawns a `gjs` child
through `Gio.Subprocess` and gives it a channel:

- a newline-framed message protocol over the child's stdin/stdout (`worker.ts`,
  `worker-bootstrap.ts`);
- a structured-clone wire codec with holes, typed arrays and `DataCloneError`
  (`structured-clone-wire.ts`);
- cross-process `MessagePort` routing (`subprocess-port-transport.ts`);
- a `SOCK_SEQPACKET` side channel on fd 3 that ships `SharedBuffer` fds with `SCM_RIGHTS`
  (`@gjsify/sab-native`);
- keep-alive through `acquireMainLoop` / `releaseMainLoop`, and an exit rule that watches the
  child's listeners.

None of that is worker-specific; it is "a parent and a child `gjs` exchanging messages". As long as
it lives inside `worker_threads`, `fork` would have to copy it, and the copy would drift. The codec
already exists twice: once in TypeScript for the parent and once as a string inside
`BOOTSTRAP_CODE` for the child, which runs as raw `gjs` before any bundle is involved.

Node's contract for `fork` is narrower than a worker's and well defined: the parent passes the
channel as an inherited fd and announces it in `NODE_CHANNEL_FD` and
`NODE_CHANNEL_SERIALIZATION_MODE`; in the child, `process.send()`, `process.on('message')`,
`process.connected`, `process.disconnect()` and the `'disconnect'` event appear when that
variable is set. `serialization: 'json'` frames each message as one JSON text plus `\n`;
`'advanced'` uses the V8 serializer. A `stdio` array containing `'ipc'` gives `spawn` the same
channel.

## Decision

1. **A new package, `@gjsify/ipc-channel`, holds the channel**, moved out of `worker_threads` and
   not rewritten: newline framing over a `Gio` stream pair, the structured-clone codec, the
   `SCM_RIGHTS` fd side channel, cross-process `MessagePort` routing and the main-loop keep-alive.
   It knows nothing about workers or `fork`; it connects two ends and moves messages.
2. **The codec has one source.** The child-side copy inside `BOOTSTRAP_CODE` goes away. Whether
   the worker bootstrap imports the package's built module by file URL or the string is generated
   from the same source at build time is settled in the implementing PR. Either way a parity test
   runs the parent codec against the child codec, so the next divergence fails CI instead of
   corrupting a message.
3. **`child_process.fork(modulePath, args, options)` is implemented on that package**, and so is
   `spawn` with `'ipc'` in its `stdio` array. The channel is a `socketpair` end inherited by the
   child and announced through `NODE_CHANNEL_FD`, the way Node does it, not stdin/stdout: a forked
   child keeps its own stdio. The default `execPath` is the running host (`hostExecPath()` from
   `@gjsify/utils/core`), so a GJS parent forks a GJS child.
4. **The child side lives in `@gjsify/process`.** When `NODE_CHANNEL_FD` is set at start-up,
   `process` opens the channel and gains `send`, `connected`, `disconnect` and the `'message'` /
   `'disconnect'` events. The channel holds the main loop only while a `'message'` or a
   `'disconnect'` listener exists, which is Node's ref behaviour (measured on Node 24: either one
   keeps a child alive, neither lets it exit). The first hold is taken while `process` itself
   evaluates, at `main_depth()` 0; a hold first taken from a microtask of a GJS entry module runs
   inside GJS's own spin of the main context, is counted but arms no loop, and the child exits.
5. **Two serializations, chosen by their partner.** `'json'` is Node's exact wire (one JSON text
   and `\n`), so a GJS parent can fork a Node child and a Node parent a GJS child. `'advanced'`
   maps to the structured-clone codec of decision 2 and is **GJS-to-GJS only**: the V8 serializer
   format is not reproduced, and a mismatch is reported when the channel opens instead of producing
   garbage. Transferable `SharedBuffer`s, `MessagePort`s and `ArrayBuffer`s cross only in
   `'advanced'`.
6. **`Worker` keeps its stdin/stdout transport** and moves onto the package unchanged in
   behaviour. Its tests are the gate for the move, as `@gjsify/webrtc`'s were for ADR 0127's
   capture extraction. Moving the worker to a socket fd as well would free the child's stdout. It
   is a possible follow-up, not part of this decision.
7. **Not in scope:** `sendHandle` (passing sockets and servers across `send()`), `cluster`, and
   `fork` on targets without `Gio.Subprocess`. `send()` with a handle throws
   `ERR_FEATURE_UNAVAILABLE_ON_PLATFORM` rather than dropping it.
8. **Tier and order.** `@gjsify/ipc-channel` starts at the tier of `worker_threads`, because
   `worker_threads` will depend on it and ADR 0003 points dependencies at the same or a lower
   tier. Work order: (1) extract the package, worker
   tests green and unchanged, (2) `fork` with `'json'`, Node-interop tests both ways, (3)
   `'advanced'` and transfers, (4) Stamped drops its `child_process` shim, which is the acceptance
   test for the consumer that reported the gap.

## Consequences

- `node:child_process` reaches Node's surface for `fork`, and libraries that fork (or only import
  `fork`, like `node-llama-cpp`) link and run on GJS.
- One codec instead of two. The parity test makes the remaining parent/child split visible
  instead of implicit.
- `worker_threads` gains a dependency, and its README changes where the wire is documented. Its
  public surface does not change.
- `@gjsify/process` gains start-up work, but only when `NODE_CHANNEL_FD` is set; a process that
  was not forked pays one environment lookup.
- A `'advanced'` channel between GJS and Node is refused, not emulated. Code that needs both
  runtimes as partners uses `'json'`.

## Implementation

1. Track the four steps of decision 8 in `status/open-todos/README.md` once accepted.
2. Update the `child_process` and `worker_threads` rows in `packages/node/AGENTS.md` in the same
   PR that lands each step.
3. Verify `NODE_CHANNEL_FD` / `NODE_CHANNEL_SERIALIZATION_MODE` handling and the `'json'` framing
   against the Node version the parity tests pin, not against this text.
