# 149. A main-loop stall is measured where it happens, and an app's responsiveness budget is a test

- Status: **Accepted** (2026-11-20)
- Date: 2026-11-20
- Deciders: Pascal Garber
- Related: [ADR 0003](0003-package-tiering.md) (tiers and the dependency direction this splits
  on), [ADR 0030](0030-one-corpus-gjs-as-oracle.md) (one corpus, GJS as the oracle),
  [ADR 0123](0123-node-sqlite-runs-on-libsqlite3-through-a-vala-bridge.md) (the synchronous
  SQLite this is most often used to find), [ADR 0133](0133-fork-and-worker-share-one-ipc-channel.md)
  (where off-thread work goes); `packages/gjs/utils`, `packages/gjs/unit`,
  `packages/node/perf_hooks`
- Consumer need: [JumpLink/curlew#501](https://github.com/JumpLink/curlew/issues/501)

## Context

GJS runs JavaScript on the GTK main thread. A synchronous slice over ~16 ms drops a frame; over
50 ms a person feels it as a stall. The causes in our apps are known and recurring: synchronous
SQLite (`node:sqlite`'s `DatabaseSync` over the Vala bridge of ADR 0123), parsing a large JSON
blob, synchronous `fs`, key derivation, decoding a full-size image, and building a list eagerly
instead of handing GTK a `GListModel`. Curlew, Steuererklärung, Beifahrer and Reminder all hit
at least two of these.

Nothing in gjsify measures it. An app ships a stall, a person reports "it freezes when I open a
folder", and the diagnosis starts from scratch — no number, no name for the slice, no test that
would have gone red. The one tool that exists is GJS's own sampling profiler, which is excellent
for depth and useless as a guard: it is a developer running a command, not something CI can
assert.

What the runtime makes possible was measured on this workstation (GJS 1.90.1, GLib 2.90.1,
2026-11-20):

- A `GLib.timeout_add(GLib.PRIORITY_HIGH, 10, …)` source measures its own lateness precisely. Idle
  lateness is **0.0–0.4 ms**; with a deliberate 120 ms busy block inside one tick, the next tick
  reports **110.0 ms** late — the block minus the interval, exactly as the model predicts.
- `GLib.get_monotonic_time()` costs **~0.1 µs** per call (100 000 calls in 10.4 ms), so a span
  that brackets an action is free relative to the action.
- `new Error().stack` costs **~0.8 µs** (10 000 in 8.0 ms) and yields real frames, so a stack is
  affordable where it is useful.
- `GLib.log_structured()` takes arbitrary fields, so a stall record is a journal entry with
  machine-readable fields and not a `print()` line to be grepped.
- `imports.system` exposes exactly `addressOf addressOfGObject breakpoint clearDateCaches
  dumpHeap dumpMemoryInfo exit gc programArgs programInvocationName programPath refcount
  version`. There is **no API to capture another frame's stack and no sampling hook**.
- `Gdk.FrameClock` offers `get_current_timings`, `get_frame_counter`, `get_fps`,
  `get_refresh_info`; `Gdk.FrameTimings` offers `get_frame_time`, `get_presentation_time`,
  `get_predicted_presentation_time`, `get_refresh_interval`, `get_complete`.

The last point sets the ceiling on attribution, and it is the thing an implementation must not
pretend away: **a JS-side watchdog can never capture the stack of the code that blocked it.** It
only runs again once that code has returned, so its own stack is the timeout callback. It can say
*that* the loop stopped, *for how long*, and *which span was open* — never *which function*. That
is what the profiler is for, and the two are complements, not alternatives.

On Node the same question has a native answer, `perf_hooks.monitorEventLoopDelay`.
`@gjsify/perf_hooks` declares `gjs: polyfill` at tier 1 and its `monitorEventLoopDelay` is a
**stub returning zeros** — a test asserting responsiveness against it passes on an app that
freezes.

## Decision

1. **The lag source is a tier-1 primitive in `@gjsify/utils`; everything above it is a new
   tier-3 package.** `@gjsify/utils` already owns the main loop (`main-loop.ts`), the measurement
   is the ~40 lines proven above, and ADR 0003 forbids a tier-1 package depending on a tier-3
   one. So `@gjsify/utils/main-loop` gains `startLagMonitor({intervalMs, thresholdMs})` returning
   lateness samples, and nothing else. `@gjsify/perf_hooks` then implements its GJS
   `monitorEventLoopDelay` on it, which removes a zero-returning stub from tier 1 and costs no new
   npm name.
2. **`@gjsify/responsiveness` holds the policy half**: spans, attribution, the stall record, the
   counters API and the scenario harness. Tier 3 per ADR 0003 rule 3, in `packages/gjs/`,
   `runtimes: {gjs: polyfill, node: polyfill, browser: none, nativescript: none}` — the same API
   must run under plain Node so a scenario test is writable on both runtimes (ADR 0030). It
   depends on `@gjsify/utils` and `@gjsify/unit` (tier 3 → tier 1, the allowed direction);
   neither depends on it, and an app takes it as a `devDependency` unless it ships the watchdog in
   production builds.
3. **The new name costs a manual bootstrap, and that is accepted rather than designed around.**
   npm Trusted Publishing cannot create a package, so `@gjsify/responsiveness` needs one publish
   with an OTP from the maintainer before CI can publish it (`docs/publishing.md`). The honest
   alternative was folding everything into `@gjsify/utils` at tier 1, which has zero bootstrap
   cost and is rejected: a stability promise over an API whose shape is a first guess is the
   expensive mistake, and the split in § 1 already takes the part that is *not* a guess into
   tier 1. The ledger entry in `status/pending-npm-bootstrap.json` lands with the PR that adds
   the package — the ledger refuses a name this repo does not yet contain — and the bootstrap is
   queued from there.
4. **How a stall is measured.** A `GLib.PRIORITY_HIGH` timeout at a 10 ms interval records
   `lateness = elapsed − interval` per tick. `lateness > thresholdMs` is a stall of that length.
   `PRIORITY_HIGH` (−100) is above GTK's own frame work, so the source is not itself starved by a
   busy redraw. Where a `Gtk.Window` is passed in, the watchdog also reads its `Gdk.FrameClock`:
   `get_current_timings()` with `get_presentation_time()` against `get_predicted_presentation_time()`
   gives missed frames, and `get_fps()` gives the rate. Frame data is **additional evidence, never
   the trigger** — a window that is not mapped has no timings, and an app without a window still
   stalls.
5. **Attribution is spans, and the limit is stated in the API docs.**
   `mark(label)` returns a handle whose `end()` closes it; `span(label, fn)` wraps a call. Open
   spans are a stack, and a stall names the innermost open span plus its depth. A span's own
   duration is reported too, so a slow action that yields correctly is still visible. A stack is
   captured **at span open**, not at stall detection, because the latter has the wrong stack; at
   0.8 µs that is affordable, and it is opt-in (`GJSIFY_STALL_STACKS=1`) because a span in a loop
   should not pay for it. When no span is open the record says so — that is a real finding, not a
   gap, and it points at the profiler.
6. **Output is one structured log record plus in-process counters.** `GLib.log_structured()` in
   the `gjsify-responsiveness` domain at `LEVEL_WARNING` with `GJSIFY_STALL_MS`,
   `GJSIFY_STALL_SPAN`, `GJSIFY_STALL_DEPTH` and the optional stack, so `journalctl` filters on a
   field; `console.warn` where no GLib exists. `getStallCounters()` returns
   `{stalls, worstMs, totalMs, bySpan}` for tests, and `resetStallCounters()` scopes a scenario.
   Counters are the test contract; the log line is the field contract.
7. **Off by default, zero cost when off, one env var to arm it.** `GJSIFY_STALL_MS=<number>` arms
   the watchdog at that threshold; **50** is the documented default to use, 16 for frame work.
   Unset, the package installs no source, adds no timer and leaves `mark()`/`span()` as functions
   that return a shared inert handle — one env read per process. It stays off by default because
   armed it wakes the process 100 times a second, which is exactly the battery behaviour a GTK app
   is otherwise careful to avoid. An app may arm it programmatically for a bug-report mode.
8. **On Node, the same API over `perf_hooks.monitorEventLoopDelay`.** Node's native histogram is
   the lag source; spans, counters and the log record are identical. A scenario test therefore runs
   on both runtimes, with GJS as the oracle (ADR 0030) because GTK only exists there.
9. **A scenario test is an `@gjsify/unit` test with a budget.** `await scenario('open folder',
   {budgetMs, runs, warmup}, fn)` drives the action, takes the **median** of `runs` (default 5,
   1 warmup discarded), and asserts two things: `median <= budgetMs` and `stalls === 0`. The
   threshold is **calibrated in-process**, not hardcoded: the harness measures the idle noise floor
   for 200 ms first and arms at `max(50, 3 × p99 noise)`, so a loaded CI runner raises its own bar
   instead of inventing flake. `GJSIFY_PERF_SOFT=1` downgrades the **duration** assertion to a
   warning on known-slow runners; the stall assertion stays hard, because after calibration a
   stall means a synchronous slice in our code. GTK scenarios gate on `@gjsify/unit`'s existing
   `'Display'` capability and run under `xvfb-run`, as the GL suites in `main.yml` already do. The
   harness never calls `it.skip`; a budget known to be unmet is `it.failing(…, reason)`, per
   `tests/AGENTS.md`.

## Consequences

- An app gets a number and a name for a freeze instead of a bug report, and a regression that
  reintroduces one goes red in CI rather than in a release.
- `@gjsify/perf_hooks` stops answering zero under GJS. Any test written against the stub was
  measuring nothing; there is no compatibility to preserve.
- A new npm name blocks on a maintainer action with an OTP. Until it is bootstrapped the package
  is pinned by its consumers only as a `devDependency`, which npm installs clean, and the ledger
  entry is what keeps the action visible.
- Attribution stops at the span. An app that wraps nothing learns only that it stalled, which is
  the correct incentive and still better than today.
- Armed, the watchdog costs 100 wakeups/s. It is a debugging and test mode, not a production
  default, and the docs say so rather than relying on the number being small.
- A budget test on a shared runner is a measurement of that runner. Calibration and the median
  make it usable; soft mode admits the rest.

## Profiling with Sysprof

Measured on GJS 1.90.1, 2026-11-20 — the watchdog says *when*, the profiler says *which function*,
and a diagnosis usually needs both:

- `gjs --profile=FILE` enables the sampling profiler and writes a Sysprof capture; with no value
  the file is `gjs-$PID.syscap` in the working directory.
- `GJS_ENABLE_PROFILER=1` does the same for a process that is not launched as `gjs …` directly —
  an installed app, a Flatpak, anything under `gjsify run`. Verified: the process logs
  `Profiler started` / `Profiler stopped` and leaves a `.syscap` behind.
- The capture is Sysprof's own format (`libgjs` links `libsysprof-capture`); open it in Sysprof,
  which shows the JS stacks sampled during the run. A stall shows as the function that holds the
  samples.
- The profiler is only in a GJS built with Sysprof support, which Fedora's is. An app that reports
  neither start nor stop line was built without it.

## Guidance: the rules this measures against

`@gjsify/responsiveness`'s README carries these, and the watchdog exists to catch a breach:

- No synchronous I/O on the UI thread: no `DatabaseSync` query, no `readFileSync`, no sync
  `Gio` call in a handler. Reach for the async spelling or move the work off the thread.
- Lists are a lazy `GListModel` behind `Gtk.ListView`/`GtkColumnView`, built on demand. Building
  10 000 rows eagerly is a stall no scheduling trick fixes.
- Images decode asynchronously and at display size, never full-size on the main thread.
- Input-driven work is debounced; a keystroke does not start a query.
- Work that cannot be made async is chunked at `GLib.PRIORITY_DEFAULT_IDLE` with a yield between
  slices, so the loop turns.
- Crypto and parsing over a few hundred KB belong in a worker or a forked child
  (ADR 0133's channel), not inline.

## Follow-ups, explicitly not decided here

- **Whether gjsify needs an off-thread or async SQLite path.** ADR 0123's bridge is synchronous by
  Node's own `DatabaseSync` contract, and the alternatives — a worker holding the connection,
  SQLite's async API, a Vala-side thread — differ in cost and in what they break. This ADR does
  not choose; it produces the measurement that would justify one. Tracked once accepted.
- The same for image decode and JSON over a threshold.
- Whether the watchdog belongs in a shipped bug-report mode, which is an app decision until two
  apps want the same shape.

## Implementation

1. `startLagMonitor()` in `@gjsify/utils/main-loop`, with tests on both runtimes; the busy-block
   fixture above is the GJS test.
2. `@gjsify/perf_hooks`'s GJS `monitorEventLoopDelay` moves onto it, replacing the stub.
3. `@gjsify/responsiveness` lands with spans, counters, the structured record and the `scenario`
   harness, listed in `status/pending-npm-bootstrap.json` until the name exists on npm.
4. Curlew writes the first scenario for [JumpLink/curlew#501](https://github.com/JumpLink/curlew/issues/501);
   its findings decide the SQLite follow-up.
