# Shipping a Worker from a bundle

`new Worker(new URL('./w.ts', import.meta.url))` names a file beside the *source*. A bundle is one
file, so after `gjsify build` that path exists nowhere beside the artifact and the Worker dies with
`Cannot find module …/w.ts` (#2338, part 1). esbuild and Vite turn the expression into a second
entry and rewrite the URL; gjsify now does the same.

## How it works

- **The plugin** (`packages/infra/rolldown-plugin-gjsify/src/plugins/worker-url.ts`) is composed by
  `--app gjs|node|browser` only when `PluginOptions.workers` (a `WorkerEntries` registry) is set.
  It rewrites the literal to `./<stem>.worker<ext>` (the main bundle's extension) and registers the
  resolved source.
- **The CLI** (`buildWorkers` in `packages/infra/cli/src/actions/build.ts`) then builds every
  registered source as its own app build beside the output, with the main build's config. The
  native rolldown engine has no `emitFile`, which is why this half lives in the CLI and not in the
  plugin.
- **Nested workers** are followed: a worker build runs the plugin again and shares the registry,
  which hands each source out once, so a cycle ends.
- Two sources with one stem get a path hash in the name, so neither overwrites the other.

## What counts

`new <Worker>(new URL(<string literal>, import.meta.url), …)` where `<Worker>` is the global
WHATWG `Worker` (`@gjsify/web-worker`), the `Worker` imported from `worker_threads` (also under an
alias), or any `<x>.Worker` member. Only relative literals (`./`, `../`) are rewritten; a computed
specifier, `file:`, `http:` or an absolute path is left byte-identical.

## Gaps

- `--watch` builds do not compose it.
- nativescript and library builds do not compose it; a library keeps its `new URL` for the
  consumer's own bundler.
- A rewritten module loses its source map (`map: null`).
- Parts 2 (`eval: true` with `import()` hangs on gjs) and 3 (the Worker spawns `gjs` from `PATH`)
  of #2338 are separate.
