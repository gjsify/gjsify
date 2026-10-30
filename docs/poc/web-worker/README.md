# PoC: a WHATWG `Worker` on GJS, and Comlink on top of it

Seven reproducers that measure what the existing worker machinery already does and what a
`@gjsify/web-worker` package would still have to add. They answer the questions in
[#2337](https://github.com/gjsify/gjsify/issues/2337) (structured clone across the boundary),
[#2338](https://github.com/gjsify/gjsify/issues/2338) (bundler support for
`new Worker(new URL(…, import.meta.url))`), [#2476](https://github.com/gjsify/gjsify/issues/2476)
(messages posted before the worker is ready) and
[#2358](https://github.com/gjsify/gjsify/issues/2358) (a worker that dies without saying so).

The write-up with every number and the implementation plan:
[docs/reports/2026-10-30-web-worker-and-comlink-on-gjs.md](../../reports/2026-10-30-web-worker-and-comlink-on-gjs.md).

Nothing here ships. These are measurement harnesses, not a package.

## Build and run

```sh
docs/poc/web-worker/scripts/run-all.sh          # everything, GJS first then Node
docs/poc/web-worker/scripts/run-all.sh 01 05    # only those
```

The script builds each parent with `gjsify build … --app gjs`, runs it with `gjsify run`, and
filters the multi-kilobyte `GI_TYPELIB_PATH` line that `gjsify run` echoes. Build output lands in
`out/` and is gitignored.

Comlink 4.4.2 is fetched from the npm registry into `$POC_ROOT`
(default `~/.cache/gjsify-web-worker-poc`) rather than added to the workspace — a devDependency
would outlive the spike. From there the script copies it to the gitignored `src/vendor/comlink.mjs`,
because the worker fixtures are raw `.mjs` and can only import it by relative path.

## What is where

| File | Answers |
|---|---|
| `src/01-wire-roundtrip.mts` | #2337 — 21 values through a real subprocess worker, each in a fresh child |
| `src/02-payload-cost.mts` | #2337 — what the tagged-JSON wire costs for 100/1k/10k rows and for 64 KiB/1 MiB of binary, against plain JSON |
| `src/03-ready-buffer.mts` | #2476 — four shapes of posting before the worker has evaluated |
| `src/04-worker-death.mts` | #2358 — four ways a worker dies, and which of them the parent can detect |
| `src/05-comlink-gjs.mts` | Comlink `wrap`/`expose` on GJS over `@gjsify/worker_threads` |
| `src/06-comlink-node.mjs` | the same eight cases on Node via `comlink/dist/umd/node-adapter` — the control |
| `src/07-bundler/` | #2338 — what `gjsify build` currently does with `new Worker(new URL('./x.ts', import.meta.url))` |

Parents are `.mts` built per target. Worker fixtures in `src/fixtures/` are raw dual-runtime
`.mjs` that pick their worker context at runtime (`globalThis.__gjsify_worker_context` on GJS,
`node:worker_threads` on Node), the same shape as
`packages/node/worker_threads/src/fixtures/echo-worker.mjs`.

## Three things that are easy to get wrong here

**One fresh worker per case.** A value the child cannot decode kills the child, and a cascade
would hide every finding after the first. 01 spawns a worker per case and 02 one per binary size,
which is why 01 takes seconds rather than milliseconds.

**A failure has to say what it saw.** Comparing a round-tripped value and printing
`want "object", saw "object"` is a line nobody can act on. Each case in 01 carries its own
`explain()` that names the actual difference — `came back as +0`, `hole at index 1 filled with
null`, `RangeError false (came back as Error, .name = RangeError)`.

**Parent and child do not have the same globals.** The `--app gjs` parent is a bundle with
`btoa`, `structuredClone`, `URL` and `MessageChannel` injected by `--globals auto`; the child is a
bare `gjs` with none of them. Any measurement that only exercises the parent half of the codec
will miss what the child cannot do — which is exactly how the `atob` dependency that these
reproducers found had survived.
