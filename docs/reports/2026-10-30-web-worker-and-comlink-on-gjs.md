# A WHATWG `Worker` on GJS, and Comlink on top of it

Research spike, 2026-10-30, gjs 1.88.1 / Node 24.19.0 / gjsify CLI 0.64.12.

**Question.** How should gjsify offer the WHATWG `Worker` (dedicated, module workers) on GJS,
and does Comlink work on top of it — on GJS and on Node?

Reproducers: [`docs/poc/web-worker/`](../poc/web-worker/README.md). Every number below comes from
`docs/poc/web-worker/scripts/run-all.sh` on this machine.

Issues: [#2337](https://github.com/gjsify/gjsify/issues/2337) ·
[#2338](https://github.com/gjsify/gjsify/issues/2338) ·
[#2358](https://github.com/gjsify/gjsify/issues/2358) ·
[#2476](https://github.com/gjsify/gjsify/issues/2476) ·
consumer: [JumpLink/steuererklaerung#193](https://github.com/JumpLink/steuererklaerung/issues/193).

## Recommendation

Build `@gjsify/web-worker` as a thin DOM-shaped adapter over `@gjsify/worker_threads`, and fix
everything below the adapter in `worker_threads` itself. The transport is sound — spawn to ready
is ~40 ms, 10 000 rows round-trip in 49 ms, Comlink's core already works over it on GJS — and
every gap that was measured is a gap in the shared transport, not in the web surface. Putting the
fixes in the adapter would leave `node:worker_threads` consumers (stamped, among others) broken in
exactly the same way.

The one thing the adapter owns that the transport cannot: the `error` event. A spec `Worker`
promises that a dead worker is observable, and three of the four death modes measured here are
silent today.

## What already works

- **Spawn and transport.** Spawn → ready is 40/40/38 ms; a `Worker` from
  `new URL('./x.mjs', import.meta.url)` loads on both runtimes. `#2338.3` is done — the child is
  spawned with the parent's own binary via `/proc/self/exe`, not from PATH.
- **#2476 (messages before ready) is already fixed on main.** 4 of 4 cases pass: a same-tick post
  to a normal worker, a same-tick post to a worker that takes 400 ms to evaluate, a post after one
  macrotask, and ten interleaved posts before and after ready with order preserved. The bootstrap's
  `pendingLines` queue drains after `await import(init.filename)`. **The issue can be closed** —
  and stamped's `READY_ID` handshake (`app/src/gui/query-client.ts`), written against the old
  behaviour, can go once it bumps its gjsify version.
- **Comlink's core works on GJS.** `wrap`/`expose`, property GET, sync and async APPLY, a throw
  arriving as a rejection, and 1 000 rows all pass over `@gjsify/worker_threads` — at 0.17 ms per
  call over 200 sequential calls, against Node's 0.04 ms.

## #2337 — structured clone across the boundary

### What the fix in #2479 changed

The tagged-JSON codec's base64 used `btoa`/`atob`. The parent has them (a `--globals auto` build
injects them); the child is a bare `gjs`, which has neither and no module resolution to reach a
polyfill. So **every typed array, `ArrayBuffer` and typed-array view sent to a file-based worker
died in the child** as `bootstrap message error: atob is not defined` — and the child exited 0, so
the parent saw nothing but a timeout. #2479 replaces both copies of the base64 helpers with an
inline implementation and adds the tests.

| | before | after |
|---|---|---|
| `docs/poc/web-worker/src/01-wire-roundtrip.mts` | 8 pass / 13 fail of 21 | 13 pass / 8 fail of 21 |
| `@gjsify/worker_threads` suite, GJS | 164 tests, 299 assertions | 174 tests, 340 assertions |
| 1 MiB `Uint8Array` round trip | blocked | 95 ms (encode 33 ms, decode 4 ms) |

### What the fix in #2485 changed

The codec's `seen` map threw on any second visit to an object, so a shared reference was
indistinguishable from a cycle, and both died in the child. #2485 replaces it with a **reference
table** — implicit ids by pre-order traversal, so nothing extra goes on the wire — and adds tags
for `undefined`, `-0`, array holes and `DataView`, reconstructs the seven interned `Error` names,
and raises `DataCloneError` at the sender for functions, symbols and other non-cloneables.

| | before | after |
|---|---|---|
| `docs/poc/web-worker/src/01-wire-roundtrip.mts` | 13 pass / 8 fail of 21 | **20 pass / 1 fail of 21** |
| `@gjsify/worker_threads` suite, GJS | 174 tests, 340 assertions | **215 tests, 546 assertions** |
| `@gjsify/worker_threads` suite, Node | not recorded | **210 tests, 535 assertions** |

Both copies of the codec move in lockstep, and a **drift guard** keeps them that way: the
`BOOTSTRAP_CODE` mirror is fenced by `GJSIFY_WIRE_CODEC_BEGIN/END` markers, and
`structured-clone-wire.spec.ts` slices that text out, evaluates it with `new Function`, and runs
the same 20-case matrix against both the TS module and the raw-JS mirror.

One number above moved because the *instrument* was wrong, not the codec: the PoC's echo worker
tagged a `DataView` as `object`, because its `tag()` tested `ArrayBuffer.isView` before it tested
`DataView`. With a working `DataView` branch in the codec the case would have passed on the value
and failed on the tag, so `echo.worker.mjs` got a `DataView` branch and `01-wire-roundtrip.mts`
now expects `DataView(4)`.

### What the fix in this PR changed

The codec was already raising `DataCloneError` correctly; every caller around it threw the result
away. This PR makes a failure to serialise or deserialise observable at the end that can act on it.

| | before | after |
|---|---|---|
| `docs/poc/web-worker/src/01-wire-roundtrip.mts` | 20 pass / 1 fail of 21 | **21 pass / 0 fail of 21** |
| `@gjsify/worker_threads` suite, GJS | 215 tests, 546 assertions | **222 tests, 561 assertions** |
| `@gjsify/worker_threads` suite, Node | 210 tests, 535 assertions | **215 tests, 547 assertions** |

**Sender.** `postMessage` now throws `DataCloneError` synchronously and sends nothing, on `Worker`,
`parentPort` and `MessagePort` alike. `Worker.postMessage` had its whole body inside a
`try { … } catch { /* Worker stdin closed */ }` meant for a closed pipe, so it swallowed the clone
error too — and the fd-send failure that `_serializeWithSabTransfer`'s own comment says should
surface. Only the `write_all` is inside the `try` now. The in-process `MessagePort` emitted
`messageerror` on the **sender**, which is both the wrong end and uncatchable by a caller; it
throws instead, matching Node's `DOMException [DataCloneError]: () => {} could not be cloned.`

**Receiver.** A message that arrives but cannot be decoded now emits `messageerror` and the
channel keeps working. `Worker._readMessages` had read, parse and dispatch under one `catch {}`,
so a decode failure silently **ended the read loop** — no event, and every later message lost too;
read and parse stay stream-level (end the loop), everything after is per-message. In the child,
the same failure threw out of `dispatchLine` into `readNext`'s catch, which reported a *bootstrap
message error* to the parent and shut the worker down: one undecodable message killed it.

The sender-side expectations run on both runtimes, so the Node leg measures them against real
`node:worker_threads` rather than asserting them from the docs. The receiver side needs a line on
the wire that the encoder would never produce, which has no portable Node equivalent — those two
cases are GJS-only (`message-errors.gjs.spec.ts`) and reach for the private `_stdinPipe` in one
direction and a raw fd-1 write from inside the child in the other.

`messageerror` stays on the `worker_threads` EventEmitter surface here. The W3C mapping —
`onmessageerror` and a `MessageEvent` — belongs with the rest of the web surface in step 5.

### What still does not survive

All 21 wire cases pass. Two deliberate deviations remain, both documented in-code:

- **A typed-array view carries its window, not its backing buffer.** Two views onto one
  `ArrayBuffer` arrive as two independent buffers. [§2.7.3](https://html.spec.whatwg.org/multipage/structured-data.html#structuredserializeinternal)
  would preserve the sharing; doing so needs buffer identity on the wire, which is the same
  machinery `transferList` wants and belongs with it.
- **`Error.cause` is not serialized**, and `AggregateError.errors` is not special-cased.

### What the wire costs

Measured with the reference table in place:

| rows | → worker | ← worker | parent encode | plain `JSON.stringify`+`parse` | wire |
|---|---|---|---|---|---|
| 100 | 3 ms | 1 ms | 0 ms (decode 1 ms) | 0 ms | 11 KiB |
| 1 000 | 7 ms | 2 ms | 1 ms (decode 2 ms) | 1 ms | 111 KiB |
| 10 000 | 49 ms | 22 ms | 8 ms (decode 6 ms) | 6 ms | 1 125 KiB |

Binary: 64 KiB round-trips in 7 ms, 1 MiB in 82 ms, both at 1.33× the payload on the wire (base64).

**The reference table costs nothing measurable.** The worry was that registering every object in a
`Map` would show up on large payloads; on 10 000 rows encode went 10 ms → 8 ms and decode 10 ms →
6 ms against the #2479 baseline, and the wire bytes are identical (11 / 111 / 1 125 KiB, unchanged).
Both directions are within run-to-run noise of the old numbers — the ids are implicit in traversal
order, so no bytes were added, and the `Map`/array operations are cheaper than the `Array.isArray`
re-walks they replaced.

Read against stamped's measurement of ~190 ms for 10 000 rows with hand-rolled JSON, the tagged
codec is not the bottleneck: it costs ~1.3× a bare `JSON.stringify`/`parse` pair (8 ms vs 6 ms on
10 000 rows) and the rest is the pipe. **Nothing here argues for a second, faster wire format.**
The 1.33× base64 overhead is the one place a binary framing would pay, and only for payloads that
are mostly bytes.

## #2358 — a worker that dies without saying so

`docs/poc/web-worker/src/04-worker-death.mts`, four ways to die:

| mode | `error` | `exit` | worker still there? | parent can tell? |
|---|---|---|---|---|
| `System.exit(3)` | — | 3 | — | yes, via `exit` |
| `SIGKILL` | — | 1 | — | yes, via `exit` |
| unhandled async rejection | — | — | yes, still answers `pong` | **no** |
| hang (stops answering) | — | — | yes, silent | **no** |

Only the two that actually end the process are observable, and neither emits `error`. An uncaught
*synchronous* throw does emit `error` and exit 1 — that contract exists and is tested
(`file-based-worker.spec.ts`). The gap is everything else.

Fixable at the core, in this order of value:

1. **`exit` without `error`.** Cheap and complete: a non-zero exit with no prior `error` should
   emit one. This alone covers the two detectable rows and is what a spec `Worker` owes.
2. **Unhandled rejections.** GJS has no host hook for a rejection in a native async function, so
   the bootstrap cannot see one. It *can* install a `promise` rejection tracker over the jobs it
   owns (the message-handler call path), which catches the common case: a handler that rejects.
   A rejection in code the bootstrap never awaited stays invisible — state that limit rather than
   claim coverage.
3. **A hang is not detectable from outside** without a liveness protocol. Do not invent one in the
   transport; it is a consumer decision (stamped's 60 s per-request timeout is the right shape).
   `@gjsify/web-worker` should not pretend otherwise.

## Comlink

Eight identical cases on both runtimes. GJS goes through `@gjsify/worker_threads`, Node through
Comlink's own `comlink/dist/umd/node-adapter`.

| case | GJS | Node |
|---|---|---|
| GET a plain property | pass | pass |
| APPLY a sync function | pass | pass |
| APPLY an async function | pass | pass |
| a throw comes back as a rejection | pass | pass |
| structured-clone-hard return value | **pass** (was failing before the codec fix) | pass |
| 1 000 rows | pass | pass |
| `Comlink.proxy()` callback — parent→worker port transfer | **fail**, times out | pass |
| `createEndpoint()` — worker→parent port transfer | **fail**, `MessageChannel is not defined` | pass |
| latency, 200 sequential calls | 0.17 ms/call | 0.04 ms/call |
| 10 000 rows | 21 ms | 11 ms |

Both failures are MessagePort transfer, and both are transport gaps rather than Comlink problems:

- A transferred port arrives in the child **EventEmitter-shaped** (`on`), not DOM-shaped
  (`addEventListener` + an `{data}` event), so Comlink's `expose` on the far end never hears it.
- The child has **no `MessageChannel`** at all — it is a bare `gjs` — so `createEndpoint`, which
  constructs one on the worker side, cannot run.
- Child→parent port transfer has no placeholder path in the cross-process transport (only
  parent→child), and `transferList` chaining (a port inside a port) is unsupported.

What this costs the adapter: the ~15-line `endpointFor` shim that both of the reproducers carry
(EventEmitter `on`/`off` → `addEventListener`/`removeEventListener`, plus the `{data}` wrapper) is
precisely what `@gjsify/web-worker` makes unnecessary. **Comlink needs no patch for its core to
work** — it needs a DOM-shaped endpoint, which is the package's whole job.

Note for the plan: Comlink's `nodeEndpoint` (43 lines) only wraps `postMessage`/`on`/`off`/`start`;
it does not translate transfer lists or MessagePorts either. And Comlink's `expose` has
`default: return;` for unknown message types, so a `{type:'ready'}` probe on the same port is
harmless — useful for a handshake if one is ever needed again.

**JSON-RPC 2.0 is not the better fallback.** Comlink works on GJS today for everything short of
port transfer, at 0.17 ms per call; a JSON-RPC layer would be a second hand-rolled protocol with
the same transport underneath and none of the proxy ergonomics. The honest fallback for a consumer
that needs callbacks *before* step 5 lands is what stamped already has: a serial request/reply
queue with ids. Recommend Comlink, document the port-transfer gap, and close it in the transport.

## #2338 — the bundler

`docs/poc/web-worker/src/07-bundler/` builds a parent containing
`new Worker(new URL('./compute.worker.ts', import.meta.url), { workerData: { probe: true } })`.

Result: the URL **survives verbatim** into the minified bundle and no worker entry is emitted —

```
Qt?.threadId;const $t=new Zt(new URL(`./compute.worker.ts`,import.meta.url),{workerData:{probe:!0}});
```

One file out, 213 778 bytes, and a runtime reference to a `.ts` file that will not exist beside it.
The issue is open and unstarted.

What it takes. The pattern to follow is `plugins/bundle-url-banner.ts` + the `runtimeResolve` gate
on `rewrite-node-modules-paths.ts`: both already treat `import.meta.url` as the bundle's own anchor
under the `format === 'esm'` condition, which is the same condition a worker entry needs.

1. A `transform`-stage plugin recognising `new Worker(new URL(<literal>, import.meta.url))` —
   acorn + acorn-typescript via `utils/scan-named-imports.ts`'s existing setup. Literal first
   argument only; anything computed is left alone with a warning naming the call site, the way
   `platform-resolve.ts` warns rather than fails.
2. Resolve the literal against the importer, add it as a **second entry** built with the same
   `--app` target, and rewrite the `new URL(…)` to the emitted file name. The native
   `@gjsify/rolldown-native` engine has **no `emitFile`**, so this cannot be a plugin alone — it
   has to be an engine-portable post-bundle CLI step, exactly like `applyBrowserHtml`
   (`utils/html-entry.ts`) is for the `--app browser` HTML entry.
3. The app-build single-file invariant (`output.inlineDynamicImports: true`) applies per entry, so
   two entries means two single-file bundles, which is what a worker wants anyway.
4. `--globals auto` must run for the worker entry on its own. Its global surface is *not* the
   parent's — this spike measured the parent having `btoa`/`structuredClone`/`URL`/`MessageChannel`
   and the child having none of them, and that asymmetry is the whole #2337 bug.

## Where each piece belongs

| Concern | `@gjsify/worker_threads` (shared transport) | `@gjsify/web-worker` (new) |
|---|---|---|
| spawn, stdin/stdout framing, `/proc/self/exe` | ✔ already | — |
| structured-clone codec, both copies | ✔ (steps 1–2) | — |
| `postMessage` raising `DataCloneError` | ✔ (step 3) | re-throws as-is |
| pre-ready buffering | ✔ already | — |
| MessagePort transfer, both directions | ✔ (step 4) | — |
| death → `error` event | emits `error` on non-zero exit (step 4) | maps it to an `ErrorEvent` |
| `EventTarget`, `onmessage`/`onerror`/`onmessageerror` | — | ✔ |
| `{ type: 'module' }`, `name`, `terminate()` | — | ✔ |
| DOM-shaped `MessagePort` on both sides | — | ✔ |
| worker entry emission | — | the bundler (step 7) |

`@gjsify/web-worker` copies `@gjsify/message-channel`'s slot routing verbatim — `runtimes`
(`gjs: "polyfill"`, node/browser/nativescript `"native"`), `runtimeSubpaths` pinning `./core` to
`polyfill` everywhere, plus `./register` and `./globals` — so the specifier maps to the native
`Worker` in browsers, Deno and Bun, and to the adapter over `worker_threads` on GJS and Node.
It depends on `@gjsify/dom-events` and `@gjsify/message-channel`, both tier 1.

## Plan, in PR-sized steps

1. **Base64 without `btoa`/`atob`, in both copies of the codec.** `structured-clone-wire.ts` +
   `BOOTSTRAP_CODE`; tests in a new `structured-clone-wire.spec.ts` (padding lengths, all 256 byte
   values, a wire-format assertion against known base64, and a case that deletes the globals) plus
   three subprocess cases in `file-based-worker.spec.ts` that exercise the child's copy.
   **Landed in #2479.**
2. **The remaining clone gaps.** A ref table instead of the throw-on-revisit `seen` map — shared
   references *and* real cycles round-trip, as [§2.7.3](https://html.spec.whatwg.org/multipage/structured-data.html#structuredserializeinternal)
   requires (the sketch here said cycles would still raise; a memo keyed by object identity gives
   both for free, so they do not). Tags for `undefined`, `-0`, array holes and `DataView`, `Error`
   subclasses reconstructed by name, and `DataCloneError` for functions and symbols. Both copies,
   in lockstep, with a drift guard that runs the same matrix against the `BOOTSTRAP_CODE` mirror.
   **Landed in #2485.**
3. **Stop swallowing the error.** `worker.ts:237-265` must let a `DataCloneError` from `encodeWire`
   reach the caller and keep catching only a closed stdin; a decode failure in the child must come
   back as `messageerror` rather than silence. Test: `postMessage` of a function throws
   synchronously on both runtimes. **Landed in this PR.**
4. **MessagePort transfer and death reporting.** DOM-shaped child-side ports, a child→parent port
   placeholder path, and `error` on a non-zero exit that had no prior `error`. Tests: the two
   Comlink cases that fail today, promoted from the spike into the package's suite.
5. **`@gjsify/web-worker`.** `EventTarget`-based `Worker` over `worker_threads`, the routing above,
   `type: 'module'` and a URL from `import.meta.url`, `terminate()`, and the three event handler
   properties. Its own suite on GJS, Node and browser.
6. **Comlink as a consumer test.** The eight cases from `05`/`06` as an e2e against the new
   package, so the port-transfer fixes stay fixed.
7. **#2338 in the bundler.** The recognition pass and the post-bundle entry emission described
   above, with an e2e that asserts a second file exists and that the rewritten URL points at it.

Steps 1–4 are independently useful to `node:worker_threads` consumers and should not wait for 5.

## Not for this repo

Nothing needs filing upstream. Comlink needs no change — a DOM-shaped endpoint is our side of the
contract. GJS's missing unhandled-rejection hook is a real limitation, noted in step 4's scope
rather than worked around.

