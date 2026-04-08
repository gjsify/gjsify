---
title: CLI Reference
description: All gjsify subcommands, flags and typical usage
---

The `@gjsify/cli` package ships the `gjsify` binary. Run it on demand via `npx @gjsify/cli <command>` or add it as a dev dependency so it is available through your `package.json` scripts.

## `gjsify create`

Scaffold a new GJSify project in a new directory.

```bash
npx @gjsify/cli create my-app
```

| Argument | Description | Default |
|---|---|---|
| `[project-name]` | Directory to create | `my-gjs-app` |

The generated project contains `src/index.ts`, a `package.json` with `build`/`start`/`dev` scripts wired to the GJSify CLI, and a matching `tsconfig.json`. Internally this delegates to [`@gjsify/create-app`](https://www.npmjs.com/package/@gjsify/create-app) — you can also call it directly via `npx @gjsify/create-app my-app`.

## `gjsify build`

Compile and bundle your project with [esbuild](https://esbuild.github.io/). Automatically aliases Node.js and Web API imports to their `@gjsify/*` equivalents when building for GJS.

```bash
npx @gjsify/cli build src/index.ts --outfile dist/index.js
```

| Option | Values | Default | Description |
|---|---|---|---|
| `[entryPoints..]` | paths | `src/index.ts` | Positional entry points |
| `--app` | `gjs` \| `node` \| `browser` | `gjs` | Target runtime |
| `--format` | `iife` \| `esm` \| `cjs` | auto | Override output format |
| `--outfile`, `-o` | path | from `package.json` | App mode output file |
| `--outdir`, `-d` | path | from `package.json` | Library mode output directory |
| `--library` | bool | `false` | Build as a reusable library |
| `--minify` | bool | `false` | Minify the output |
| `--reflection`, `-r` | bool | `false` | Enable TypeScript runtime types via Deepkit |
| `--console-shim` | bool | `true` | Inject the GJS console shim (clean output, ANSI colors). Disable with `--no-console-shim` |
| `--globals` | string | `""` | Comma-separated list of globals to register. See [Globals](#globals) below |
| `--exclude` | glob[] | `[]` | Glob patterns to exclude from entry points and aliases |
| `--log-level` | `silent` \| `error` \| `warning` \| `info` \| `debug` \| `verbose` | `warning` | esbuild log level |
| `--verbose` | bool | `false` | Enable verbose mode |

For `--app gjs`, the target is `firefox128` (SpiderMonkey 128) and `gi://*`, `cairo`, `system` and `gettext` are externalised. For `--app node`, the target is `node24`.

### Globals

Node.js and Web APIs like `fetch`, `Buffer`, `process`, `URL`, `crypto`, and `AbortController` are not built into GJS — they live in the `@gjsify/*` ecosystem of tree-shakeable packages. To make them available as runtime globals, declare them explicitly via `--globals`:

```bash
npx @gjsify/cli build src/index.ts --outfile dist/index.js \
  --globals fetch,Buffer,process,URL,crypto,structuredClone,AbortController
```

Each identifier in the list is mapped to its `@gjsify/<pkg>/register` module and injected at build time. Identifiers the user's code never mentions cost nothing to leave in the list — the corresponding register module is no-op on Node.js and a small self-contained side-effect on GJS.

**Projects scaffolded via `npx @gjsify/cli create` get a sensible default** already wired into the build script:

```jsonc
"scripts": {
  "build": "gjsify build src/index.ts --outfile dist/index.js --globals fetch,Buffer,process,URL,crypto,structuredClone,AbortController",
  "start": "gjsify run dist/index.js"
}
```

Most Node-style apps work out of the box. Add or remove identifiers as your code's needs grow.

> **Why no auto-scan?** Earlier design iterations tried to detect needed globals automatically by parsing your source and transitive dependencies. The heuristic consistently leaked — isomorphic npm packages, dynamic imports, runtime feature detection, and bracket-notation global access (`globalThis['X']`) cannot be reliably distinguished. Explicit declaration in `package.json` is predictable, trivially teachable, and keeps the CLI layer minimal.

#### Known identifiers

Any of these identifiers can appear in `--globals`. Each maps to the `@gjsify/<pkg>/register` module shown on the right.

| Identifier | Register module |
|---|---|
| `Buffer`, `Blob`, `File` | `@gjsify/buffer/register` |
| `process`, `setImmediate`, `clearImmediate`, `queueMicrotask`, `structuredClone`, `btoa`, `atob`, `URL`, `URLSearchParams` | `@gjsify/node-globals/register` |
| `fetch`, `Headers`, `Request`, `Response` | `fetch/register` |
| `FormData`, `performance`, `PerformanceObserver` | `@gjsify/web-globals/register` |
| `ReadableStream`, `WritableStream`, `TransformStream`, `TextEncoderStream`, `TextDecoderStream`, `ByteLengthQueuingStrategy`, `CountQueuingStrategy` | `web-streams/register` |
| `CompressionStream`, `DecompressionStream` | `compression-streams/register` |
| `crypto` | `webcrypto/register` |
| `AbortController`, `AbortSignal` | `abort-controller/register` |
| `Event`, `EventTarget`, `CustomEvent`, `MessageEvent`, `ErrorEvent`, `CloseEvent`, `ProgressEvent`, `UIEvent`, `MouseEvent`, `PointerEvent`, `KeyboardEvent`, `WheelEvent`, `FocusEvent` | `dom-events/register` |
| `EventSource` | `eventsource/register` |
| `DOMException` | `dom-exception/register` |
| `document`, `Image`, `HTMLCanvasElement`, `HTMLImageElement`, `HTMLElement`, `MutationObserver`, `ResizeObserver`, `IntersectionObserver` | `@gjsify/dom-elements/register` |

Unknown identifiers are silently ignored (so your script keeps working even if you typo one). If a runtime `ReferenceError: X is not defined` still happens, check this table, add the missing identifier to `--globals`, and rebuild.

> **Alternative — explicit `/register` imports in source.** If you prefer to keep build flags minimal, you can `import '@gjsify/fetch/register'` (or the aliased bare specifier `import 'fetch/register'`) directly in your entry file instead. Both approaches are equivalent; `--globals` is usually more ergonomic because it keeps the config in one place.

## `gjsify run`

Run a built GJS bundle. Automatically sets `LD_LIBRARY_PATH` and `GI_TYPELIB_PATH` for any native prebuilds in `node_modules` (e.g. `@gjsify/webgl`), so you do not have to wire the environment yourself.

```bash
npx @gjsify/cli run dist/index.js
npx @gjsify/cli run dist/index.js -- --my-app-flag value
```

| Argument | Description |
|---|---|
| `<file>` | The GJS bundle to run |
| `[args..]` | Extra arguments passed through to `gjs` |

Before spawning `gjs`, the command prints the exact invocation it is about to run, including any env vars that were set:

```bash
$ gjsify run dist/index.js
$ LD_LIBRARY_PATH=/…/@gjsify/webgl/prebuilds/linux-x64 GI_TYPELIB_PATH=/…/@gjsify/webgl/prebuilds/linux-x64 gjs -m dist/index.js
```

`gjsify run` is **not required** — it is a convenience wrapper. You can always invoke `gjs` directly. If your project does not pull in any native prebuilds, all you need is:

```bash
gjs -m dist/index.js
```

If your project does use native GJSify packages, copy the env vars from the printed line above, or generate them on demand with [`gjsify info --export`](#gjsify-info):

```bash
eval $(npx @gjsify/cli info --export)
gjs -m dist/index.js
```

## `gjsify check`

Verify that all required system dependencies are installed: GJS, GTK 4, Blueprint Compiler, and friends. Returns a non-zero exit code if anything is missing and prints the install command for your detected package manager.

```bash
npx @gjsify/cli check
npx @gjsify/cli check --json
```

| Option | Default | Description |
|---|---|---|
| `--json` | `false` | Output results as JSON |

## `gjsify info`

List any native GJSify packages detected in `node_modules` and show the exact `LD_LIBRARY_PATH` / `GI_TYPELIB_PATH` needed to run your bundle directly with `gjs`. Useful when you cannot use `gjsify run` (for example when launching through a systemd unit).

```bash
npx @gjsify/cli info dist/index.js
eval $(npx @gjsify/cli info --export)
gjs -m dist/index.js
```

| Argument / Option | Description |
|---|---|
| `[file]` | Bundle path used in the generated example command |
| `--export` | Emit only shell `export` statements, suitable for `eval` |

## `gjsify showcase`

List or run the curated showcase applications bundled with the CLI. Each showcase is a fully polished example — Canvas2D fireworks, Three.js post-processing, an Express web server — and can be launched with a single command.

```bash
npx @gjsify/cli showcase                  # list all
npx @gjsify/cli showcase three-geometry-teapot
```

| Option | Default | Description |
|---|---|---|
| `[name]` | — | Showcase name to run. Omit to list available showcases |
| `--list` | `false` | Force list mode even if a name is provided |
| `--json` | `false` | Output as JSON (list mode only) |

Before running, `gjsify showcase` calls `gjsify check` to make sure all required system dependencies are in place.
