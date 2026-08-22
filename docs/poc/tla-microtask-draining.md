# POC — Top-level await + GLib main loop on GJS

**Date**: 2026-06-14
**Runtime under test**: GJS 1.88.0 / SpiderMonkey 140 (the gjsify minimum, AGENTS.md)
**Reproduction**: [`tla-microtask-draining.gjs.mjs`](tla-microtask-draining.gjs.mjs) — run `gjs -m docs/poc/tla-microtask-draining.gjs.mjs`
**GJS source consulted**: `gjs/context.cpp` (`eval_module`, `run_jobs_fallible`), `gjs/mainloop.{h,cpp}` (`MainLoop::spin`), `gjs/promise.cpp` (`PromiseJobDispatcher`)

## TL;DR

A reported "top-level `await` in the entry module suppresses Promise microtask
draining inside GLib main-loop callbacks" was investigated. On the **supported**
runtime (GJS 1.86+/SM140) this does **not** reproduce — microtasks drain
correctly under a pending top-level await. What *is* real and reproducible is a
narrower **process-teardown deadlock**, and the originally observed "MCP stdio
hangs with zero output" turned out to be a **separate `process.stdin`
auto-resume gap** (fixed independently in #509).

| Claim | Verdict on GJS 1.88/SM140 | Evidence |
|---|---|---|
| TLA suppresses microtask draining in main-loop callbacks | **Not reproducible** | scenarios `tla-microtask-drains`, `tla-gio-async-chain` both drain + exit 0 |
| TLA + `ensureMainLoop()` hook + bare `system.exit()` from an async continuation deadlocks | **Reproducible** | scenario `tla-hook-bare-exit-deadlocks` hangs (parent times out) |
| The deadlock is escapable from gjsify | **Yes, already mitigated** | scenario `tla-hook-idle-exit-ok` exits 0; this is what `@gjsify/process`'s `exitProcess()` already does |
| Original "MCP stdio, zero output" stall | **`process.stdin` resume gap, not TLA** | `process.stdin.on('data', …)` reads nothing until `.resume()`; once resumed, data flows *and* microtasks drain even under TLA |

## Why microtasks drain under TLA (the reported bug does not hold)

When you `gjs -m entry.js`, `GjsContextPrivate::eval_module` calls
`JS::ModuleEvaluate`. With a top-level await the evaluation promise is left
**pending**, and GJS adds reactions + a `main_loop_hold()` so the loop keeps
running, then enters a `do { hook?; spin } while (hook)` loop.

The job queue is **not** drained only inside that loop. GJS installs a dedicated
custom GSource for promise jobs — `PromiseJobDispatcher::Source` in
`gjs/promise.cpp` (introduced 2021-09-05, "Implement custom GSource to handle
promise queueing", shipped in GJS 1.72 / GNOME 41):

- attached to the **thread-default `GMainContext`**,
- at priority `10 × G_PRIORITY_HIGH` (**-1000**), above every ordinary source,
- `prepare()` returns `!empty()` — it is ready whenever *any* job is queued,
- `dispatch()` calls `js::RunJobs()` and returns `G_SOURCE_CONTINUE`,
- `enqueuePromiseJob()` calls `m_dispatcher.start()`, attaching/arming the source.

So as long as **any** GLib context iteration happens on the default context —
GJS's internal `MainLoop::spin()` *or* a user `GLib.MainLoop.run()` /
`runAsync()` — the dispatcher source fires and drains the job queue. A pending
module-evaluation promise does not gate it. This is exactly what the harness
confirms: a `Promise.resolve().then(…)` (scenarios 1) and a chained
continuation off a real `Gio.File.load_contents_async` callback (scenario 2)
both run while the entry module's top-level await is still pending.

> The "suppression" symptom likely came from an **older GJS** (pre-1.72, before
> the always-attached dispatcher) and/or was actually the teardown deadlock or
> the stdin gap below presenting as "no output".

## The real defect: TLA + main-loop hook + bare `system.exit()` deadlocks

`imports.system.exit(code)` does **not** terminate the process directly. In
`gjs/context.cpp`:

```cpp
void GjsContextPrivate::exit(uint8_t exit_code) {
    g_assert(!m_should_exit);
    m_should_exit = true;          // just a flag
    m_exit_code = exit_code;
}                                  // + an uncatchable "exit" exception is thrown
```

The real `::exit()` runs later, back in `eval_module`, after it regains control.

gjsify's `ensureMainLoop()` (`@gjsify/utils/main-loop`) registers a main-loop
hook via `GLib.MainLoop.runAsync()` → `setMainLoopHook`. With a hook set,
`eval_module` runs it:

```cpp
do {
    if (ok && m_main_loop_hook) ok = run_main_loop_hook();   // → loop.run() (BLOCKS)
    if (ok && !m_main_loop.spin(this)) exiting = true;
} while (ok && !exiting && m_main_loop_hook);
```

`run_main_loop_hook()` calls the hook, whose body is a **blocking**
`GLib.MainLoop.run()` on the default context. Now:

1. The `PromiseJobDispatcher` fires, drains a job; the job calls
   `system.exit()` → sets `m_should_exit`, throws the uncatchable exit.
2. `run_jobs_fallible` catches it and returns. Control is back inside the GLib
   loop iteration **driven by the hook's `loop.run()`**.
3. `GLib.MainLoop.run()` only returns when someone calls `loop.quit()`.
   `system.exit()` never did — it only set GJS's internal flag.
4. → `loop.run()` never returns → `run_main_loop_hook()` never returns →
   `eval_module` never reaches the real `::exit()`. **The process hangs.**

Without a hook (scenario where GJS uses its own `MainLoop::spin()` instead), the
spin loop re-checks `gjs->should_exit()` every iteration
(`gjs/mainloop.cpp`) and bails — so a bare `system.exit()` exits cleanly. The
deadlock is specific to a registered main-loop hook, i.e. `ensureMainLoop()`.

This matches the existing in-tree notes: the `@gjsify/process` `exitProcess()`
comment ("calling `system.exit()` directly from a microtask continuation while a
`GLib.MainLoop` is parked deadlocks the process") and the oxc exit-code note in
AGENTS.md.

## Mitigation gjsify owns (and already ships for `process.exit`)

Terminate via `idle_add(loop.quit() → system.exit())` instead of a bare
`system.exit()`. `loop.quit()` unblocks the nested hook `loop.run()`, so
`eval_module` regains control and the subsequent `system.exit()` actually
terminates. Scenario `tla-hook-idle-exit-ok` proves this exits 0.

This is exactly what `@gjsify/process`'s `exitProcess()` already does:

```ts
ensureMainLoop();
idleAdd(priorityDefault, () => {
    quitMainLoop();        // loop.quit()
    system.exit!(code);
    return sourceRemove;
});
```

**So any code that exits through `process.exit()` is already safe.** The hole is
only direct `imports.system.exit()` from an async continuation under TLA — which
gjsify cannot intercept. Guidance for entry modules is therefore:

- Prefer the `main().catch(…)` pattern over a top-level `await` for a
  long-running server entry (this is what `examples/node/cli-mcp-server`
  already does, and why it works), **or**
- run an explicit `new GLib.MainLoop(null, false).run()` and tear down via
  `process.exit()` / `quitMainLoop()` — never a bare `imports.system.exit()`
  from an async callback.

## Aside: the original "MCP stdio, zero output" was a stdin-resume gap

A minimal `process.stdin.on('data', …)` echo built with `@gjsify/*` reads
**nothing** from a piped (or file-redirected) stdin — the `ProcessReadStream`
is never resumed. Node auto-resumes a paused stream when a `'data'` listener is
attached; gjsify did not. Calling `process.stdin.resume()` explicitly makes data
flow — and crucially the Promise continuations after each data event **drain
even under a pending top-level await**. The stdin-resume fix landed separately
in #509 (`packages/node/process/src/streams.ts`).

That gap, not microtask suppression, is the most likely cause of the original
"MCP TypeScript SDK stdio processing hangs with zero output".

## Reproduction

```console
$ gjs -m docs/poc/tla-microtask-draining.gjs.mjs
## tla-microtask-drains — PASS (got 0, expected 0)
## tla-gio-async-chain — PASS (got 0, expected 0)
## tla-hook-bare-exit-deadlocks — PASS (got 124, expected 124)
## tla-hook-idle-exit-ok — PASS (got 0, expected 0)
# ALL SCENARIOS BEHAVED AS DOCUMENTED
```

Each scenario runs as an isolated child `gjs` process under a `timeout`, so the
deliberate deadlock in scenario 3 cannot wedge the harness. The harness exits 0
when GJS behaves as documented here and non-zero if any scenario regresses — so
it also flags if a future GJS fixes the teardown deadlock (scenario 3 would flip
to a non-124 exit and need review).

## Related

- `packages/gjs/utils/src/main-loop.ts` — `ensureMainLoop()` / `quitMainLoop()` (hook registration; carries the TLA-deadlock warning)
- `packages/node/process/src/internal/exit.ts` — `exitProcess()` (the idle-scheduled exit that already escapes the deadlock)
- `status/upstream-patch-candidates.md` — the deadlock entry
- #509 (`7a29a0017`) — the separate stdin auto-resume fix
