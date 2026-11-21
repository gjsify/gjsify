# @gjsify/responsiveness

Measure main-loop stalls in a GJS app and turn "it freezes when I open a folder" into a number, a
span name and a test. Design: [ADR 0149](../../../docs/adr/0149-a-main-loop-stall-is-measured-where-it-happens.md).

GJS runs JavaScript on the GTK main thread. A synchronous slice over ~16 ms drops a frame; over
50 ms a person feels it.

```ts
import { span } from '@gjsify/responsiveness';

await span('open folder', () => openFolder());
```

## Arming

Off by default and free when off: no timer, and `mark()`/`span()` return a shared inert handle.

```bash
GJSIFY_STALL_MS=50 gjs …        # 50 documented default, 16 for frame work
GJSIFY_STALL_STACKS=1 …         # also capture a stack when a span opens
```

Armed, a `GLib.PRIORITY_HIGH` timer wakes the process 100 times a second. That is a debugging and
test mode, not a production default; install it as a `devDependency` unless you ship a bug-report
mode. Or arm in code: `armStallWatchdog({ thresholdMs, stacks, onStall })`.

## What you get

- **One structured record per stall** — `GLib.log_structured` in the `gjsify-responsiveness`
  domain at warning level with `GJSIFY_STALL_MS`, `GJSIFY_STALL_SPAN`, `GJSIFY_STALL_DEPTH` and
  the optional `GJSIFY_STALL_STACK`: `journalctl GJSIFY_STALL_SPAN='open folder'`. `console.warn`
  where GLib is absent (Node).
- **Counters** — `getStallCounters()` → `{ stalls, worstMs, totalMs, bySpan }`,
  `resetStallCounters()`.
- **Spans** — `mark(label).end()` and `span(label, fn)`; a stall names the innermost open span and
  the depth. No open span is a finding too: it points at the profiler.

### The limit

A JS watchdog runs again only after the blocking code has returned, so it can say *that* the loop
stopped, *for how long* and *which span was open* — never *which function*. For that use the
sampling profiler: `gjs --profile=out.syscap …`, or `GJS_ENABLE_PROFILER=1` for an installed app,
then open the capture in Sysprof.

## Scenario tests

```ts
import { scenario } from '@gjsify/responsiveness/scenario';

await scenario('open folder', { budgetMs: 300, runs: 5, warmup: 1 }, () => openFolder());
```

A scenario is an `@gjsify/unit` test: it calibrates the stall threshold on 200 ms of idle noise
(`max(50, 3 × p99)`), discards the warmup, takes the **median** of `runs`, and asserts
`median <= budgetMs` and `stalls === 0`. `GJSIFY_PERF_SOFT=1` softens only the duration, for known
slow runners; the stall assertion stays hard. Use `measureScenario()` (root entry, headless) for the numbers without the
assertions. GTK scenarios gate on `on('Display', …)` and run under `xvfb-run`.

## Rules this measures against

No synchronous I/O on the UI thread (no `DatabaseSync` query, `readFileSync`, sync `Gio` call in a
handler); lists as a lazy `GListModel` behind `Gtk.ListView`; images decoded asynchronously at
display size; input-driven work debounced; unavoidable synchronous work chunked at
`GLib.PRIORITY_DEFAULT_IDLE`; crypto and parsing over a few hundred KB in a worker or forked child.

## License

MIT
