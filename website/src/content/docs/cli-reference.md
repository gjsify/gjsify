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
| `--globals` | string | `"auto"` | Globals registration mode. `auto` (default) detects needed globals from the bundled output. `auto,<extras>` adds an explicit safety net. `<list>` is a fully explicit comma-separated list. `none` disables. See [Globals](#globals) below |
| `--exclude` | glob[] | `[]` | Glob patterns to exclude from entry points and aliases |
| `--log-level` | `silent` \| `error` \| `warning` \| `info` \| `debug` \| `verbose` | `warning` | esbuild log level |
| `--verbose` | bool | `false` | Enable verbose mode |

For `--app gjs`, the target is `firefox128` (SpiderMonkey 128) and `gi://*`, `cairo`, `system` and `gettext` are externalised. For `--app node`, the target is `node24`.

### Globals

Node.js and Web APIs like `fetch`, `Buffer`, `process`, `URL`, `crypto`, and `AbortController` are not built into GJS — they live in the `@gjsify/*` ecosystem of tree-shakeable packages. The CLI supports four globals modes:

#### `auto` (default)

Detects which globals your code actually needs by analysing the bundled output:

```bash
npx @gjsify/cli build src/index.ts --outfile dist/index.js
# equivalent to: --globals auto
```

The CLI runs an iterative multi-pass build:

1. **Pass 1** bundles your code in memory with no globals injected. `acorn` parses the output and finds free identifiers (`Buffer`, `fetch`) plus host-object member expressions (`globalThis.Buffer`, `global.Buffer`, `window.Buffer`, `self.Buffer`) that match the known-globals table.
2. **Pass N** injects the discovered globals' register modules and rebuilds. The newly injected modules can pull in code that references *more* globals — so the loop repeats until the detected set stabilises (typically 2–3 iterations, capped at 5).
3. The final real build uses the converged set.

Because the detection runs on the **already-tree-shaken** bundle, isomorphic library guards (`typeof document !== 'undefined'`) and other dead code never produce false positives. Granular `register/<feature>` subpaths mean that detecting `process` injects only the process register code, not the entire `node-globals` module.

> Use `--verbose` to see what auto mode detected:
> ```bash
> gjsify build src/index.ts -o dist/index.js --verbose
> # [gjsify] --globals auto: converged after 2 iteration(s), 11 global(s):
> #   AbortSignal, Buffer, HTMLElement, document, fetch, navigator,
> #   performance, process, queueMicrotask, setImmediate, ...
> ```

#### `auto,<extras>`

Auto detection plus an explicit safety net. The detector cannot statically follow value-flow indirection — for example Excalibur stores `globalThis` in `BrowserComponent.nativeComponent` and then calls `nativeComponent.matchMedia(...)`, so neither bare `matchMedia` nor `globalThis.matchMedia` appears in the bundle. Combine `auto` with the relevant identifier or group to inject extras unconditionally:

```bash
# Excalibur game — auto + the full DOM group
gjsify build src/gjs/gjs.ts -o dist/gjs.js --globals auto,dom

# Auto + a single identifier we know auto can't see
gjsify build src/index.ts -o dist/index.js --globals auto,matchMedia,FontFace
```

The extras are seeded into the very first pass so any code reachable only through them is also visible to the analyser.

#### Explicit list

A fully explicit comma-separated list disables auto detection. Use this when you want exact control:

```bash
gjsify build src/index.ts --outfile dist/index.js \
  --globals fetch,Buffer,process,URL,crypto,AbortController
```

You can use one of three pre-defined groups instead of listing identifiers manually:

| Group | Expands to |
|---|---|
| `node` | `Buffer`, `Blob`, `File`, `process`, `setImmediate`, `clearImmediate`, `queueMicrotask`, `structuredClone`, `btoa`, `atob`, `URL`, `URLSearchParams` |
| `web` | `fetch`, `Headers`, `Request`, `Response`, `FormData`, `ReadableStream`, `WritableStream`, `TransformStream`, `TextEncoderStream`, `TextDecoderStream`, `ByteLengthQueuingStrategy`, `CountQueuingStrategy`, `CompressionStream`, `DecompressionStream`, `crypto`, `AbortController`, `AbortSignal`, all DOM event types, `EventSource`, `DOMException`, `performance`, `PerformanceObserver`, `XMLHttpRequest`, `DOMParser`, `AudioContext`, `webkitAudioContext`, `Audio`, `HTMLAudioElement`, `GamepadEvent` |
| `dom` | `document`, `Image`, `HTMLCanvasElement`, `HTMLImageElement`, `HTMLElement`, `MutationObserver`, `ResizeObserver`, `IntersectionObserver`, `FontFace`, `matchMedia`, `location`, `navigator` |

Groups and individual identifiers can be combined freely (`--globals node,web`, `--globals dom,fetch`).

#### `none`

Disables globals injection entirely. Useful when you have set up `globalThis` yourself or are deliberately producing a bundle that should fail at runtime if a global is missing:

```bash
gjsify build src/index.ts --outfile dist/index.js --globals none
```

#### Projects scaffolded via `gjsify create`

Scaffolded projects rely on the default `auto` mode — the build script does not pass `--globals` at all:

```jsonc
"scripts": {
  "build": "gjsify build src/index.ts --outfile dist/index.js",
  "start": "gjsify run dist/index.js"
}
```

If `auto` doesn't detect a global your code needs (rare, but happens with libraries that wrap `globalThis`), edit the script to use `--globals auto,<identifier>` or `--globals auto,<group>`.

#### Known identifiers

Any identifier below can appear in `--globals` (or be detected automatically). On Node.js each register module is an empty no-op (native globals already exist). Granular subpaths mean only the relevant feature gets injected — selecting `Buffer` does NOT also pull in `process` or `URL`.

**Node.js core globals**

| Identifier(s) | Register subpath |
|---|---|
| `Buffer`, `Blob`, `File` | `@gjsify/buffer/register` |
| `process` | `@gjsify/node-globals/register/process` |
| `setImmediate`, `clearImmediate` | `@gjsify/node-globals/register/timers` |
| `queueMicrotask` | `@gjsify/node-globals/register/microtask` |
| `structuredClone` | `@gjsify/node-globals/register/structured-clone` |
| `btoa`, `atob` | `@gjsify/node-globals/register/encoding` |
| `URL`, `URLSearchParams` | `@gjsify/node-globals/register/url` |

**Fetch**

| Identifier(s) | Register subpath |
|---|---|
| `fetch`, `Headers`, `Request`, `Response` | `fetch/register/fetch` |

**Streams**

| Identifier(s) | Register subpath |
|---|---|
| `ReadableStream` | `web-streams/register/readable` |
| `WritableStream` | `web-streams/register/writable` |
| `TransformStream` | `web-streams/register/transform` |
| `TextEncoderStream`, `TextDecoderStream` | `web-streams/register/text-streams` |
| `ByteLengthQueuingStrategy`, `CountQueuingStrategy` | `web-streams/register/queuing` |
| `CompressionStream`, `DecompressionStream` | `compression-streams/register` |

**Crypto**

| Identifier(s) | Register subpath |
|---|---|
| `crypto` | `webcrypto/register` |

**Abort + Events**

| Identifier(s) | Register subpath |
|---|---|
| `AbortController`, `AbortSignal` | `abort-controller/register` |
| `Event`, `EventTarget` | `dom-events/register/event-target` |
| `CustomEvent`, `MessageEvent`, `ErrorEvent`, `CloseEvent`, `ProgressEvent` | `dom-events/register/custom-events` |
| `UIEvent`, `MouseEvent`, `PointerEvent`, `KeyboardEvent`, `WheelEvent`, `FocusEvent` | `dom-events/register/ui-events` |
| `EventSource` | `eventsource/register` |
| `DOMException` | `dom-exception/register` |

**Performance + FormData**

| Identifier(s) | Register subpath |
|---|---|
| `performance`, `PerformanceObserver` | `@gjsify/web-globals/register/performance` |
| `FormData` | `@gjsify/web-globals/register/formdata` |

**XHR / DOMParser / Audio / Gamepad (GJS-only Web APIs)**

| Identifier(s) | Register subpath |
|---|---|
| `XMLHttpRequest` | `@gjsify/xmlhttprequest/register` |
| `DOMParser` | `@gjsify/domparser/register` |
| `AudioContext`, `webkitAudioContext`, `Audio`, `HTMLAudioElement` | `@gjsify/webaudio/register` |
| `GamepadEvent` | `@gjsify/gamepad/register` |

**DOM / browser-compat (GJS/GTK only)**

| Identifier(s) | Register subpath |
|---|---|
| `document`, `HTMLElement` | `@gjsify/dom-elements/register/document` |
| `HTMLCanvasElement` | `@gjsify/dom-elements/register/canvas` |
| `Image`, `HTMLImageElement` | `@gjsify/dom-elements/register/image` |
| `MutationObserver`, `ResizeObserver`, `IntersectionObserver` | `@gjsify/dom-elements/register/observers` |
| `FontFace` | `@gjsify/dom-elements/register/font-face` |
| `matchMedia` | `@gjsify/dom-elements/register/match-media` |
| `location` | `@gjsify/dom-elements/register/location` |
| `navigator` | `@gjsify/dom-elements/register/navigator` |

Unknown identifiers are silently ignored. If a runtime `ReferenceError: X is not defined` still happens after a build with `--globals auto`, the most likely cause is value-flow indirection (the analyser cannot see `obj.X` after `const obj = globalThis`). Add `X` to the `auto` value as an extra: `--globals auto,X`.

> **Alternative — explicit `/register` imports in source.** If you prefer to bypass `--globals` entirely, you can `import '@gjsify/fetch/register'` (or the aliased bare specifier `import 'fetch/register'`) directly in your entry file. Both approaches are equivalent; `--globals auto` is usually more ergonomic because it requires no source changes at all.

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
