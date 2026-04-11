---
title: CLI Reference
description: All gjsify subcommands, flags and typical usage
---

The `@gjsify/cli` package ships the `gjsify` binary. Run it via `npx @gjsify/cli <command>` or add it as a dev dependency.

> **Tip:** `npx @gjsify/cli --help` lists all commands and flags.

## `gjsify create`

Scaffold a new GJSify project.

```bash
npx @gjsify/cli create my-app
```

| Argument | Description | Default |
|---|---|---|
| `[project-name]` | Directory to create | `my-gjs-app` |

Generates `src/index.ts`, a `package.json` with `build`/`start`/`dev` scripts, and a `tsconfig.json`. Internally delegates to [`@gjsify/create-app`](https://www.npmjs.com/package/@gjsify/create-app).

## `gjsify build`

Compile and bundle with [esbuild](https://esbuild.github.io/). Automatically aliases Node.js and Web API imports to `@gjsify/*` equivalents for GJS.

```bash
npx @gjsify/cli build src/index.ts --outfile dist/index.js
```

| Option | Values | Default | Description |
|---|---|---|---|
| `[entryPoints..]` | paths | `src/index.ts` | Positional entry points |
| `--app` | `gjs` \| `node` \| `browser` | `gjs` | Target runtime |
| `--outfile`, `-o` | path | from `package.json` | Output file |
| `--outdir`, `-d` | path | from `package.json` | Output directory (library mode) |
| `--minify` | bool | `false` | Minify the output |
| `--globals` | string | `"auto"` | Globals mode (see below) |
| `--verbose` | bool | `false` | Show detected globals and build details |

<details>
<summary>All build options</summary>

| Option | Values | Default | Description |
|---|---|---|---|
| `--format` | `iife` \| `esm` \| `cjs` | auto | Override output format |
| `--library` | bool | `false` | Build as a reusable library |
| `--reflection`, `-r` | bool | `false` | Enable TypeScript runtime types via Deepkit |
| `--console-shim` | bool | `true` | Inject the GJS console shim. Disable with `--no-console-shim` |
| `--exclude` | glob[] | `[]` | Glob patterns to exclude from entry points and aliases |
| `--log-level` | `silent` \| `error` \| `warning` \| `info` \| `debug` \| `verbose` | `warning` | esbuild log level |

For `--app gjs`, the target is `firefox128` (SpiderMonkey 128) and `gi://*`, `cairo`, `system` and `gettext` are externalised. For `--app node`, the target is `node24`.

</details>

### Globals

The default `--globals auto` detects which globals your code needs from the bundled output. No configuration needed for most projects.

| Mode | Usage | Description |
|---|---|---|
| `auto` | `--globals auto` (default) | Automatic detection from bundled output |
| `auto,<extras>` | `--globals auto,dom` | Auto + explicit extras for hard-to-detect cases |
| explicit list | `--globals fetch,Buffer` | Fully explicit, no auto detection |
| `none` | `--globals none` | Disable globals injection |

Groups: `node` (Buffer, process, URL, …), `web` (fetch, streams, crypto, …), `dom` (document, Image, navigator, …).

<details>
<summary>How auto detection works</summary>

The CLI runs an iterative multi-pass build:

1. **Pass 1** bundles your code in memory (no globals injected). `acorn` parses the output and finds free identifiers (`Buffer`, `fetch`) plus host-object member expressions (`globalThis.Buffer`, `self.Buffer`).
2. **Pass N** injects the discovered globals and rebuilds. Newly injected modules can reference *more* globals — the loop repeats until the set stabilises (typically 2–3 iterations, capped at 5).
3. The final build uses the converged set.

Because detection runs on the **tree-shaken** bundle, isomorphic guards (`typeof document !== 'undefined'`) never produce false positives.

> Use `--verbose` to see what auto mode detected:
> ```bash
> gjsify build src/index.ts -o dist/index.js --verbose
> # [gjsify] --globals auto: converged after 2 iteration(s), 11 global(s):
> #   AbortSignal, Buffer, HTMLElement, document, fetch, navigator, …
> ```

</details>

<details>
<summary>When auto can't see a global</summary>

The analyser cannot follow value-flow indirection — e.g. Excalibur stores `globalThis` in a variable and calls methods through it, hiding the access. Keep auto on and add extras:

```bash
# Auto + the entire DOM group
gjsify build src/gjs/gjs.ts -o dist/gjs.js --globals auto,dom

# Auto + specific identifiers
gjsify build src/index.ts -o dist/index.js --globals auto,matchMedia,FontFace
```

Extras are seeded into pass 1 so any code reachable only through them is also visible.

</details>

<details>
<summary>Known identifiers</summary>

Any identifier below can appear in `--globals` (or be detected automatically). Granular subpaths mean selecting `Buffer` does NOT also pull in `process` or `URL`.

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

**XHR / DOMParser / Audio / Gamepad (GJS-only)**

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

Unknown identifiers are silently ignored. If a `ReferenceError: X is not defined` still happens, add `X` as an extra: `--globals auto,X`.

</details>

## `gjsify run`

Run a built GJS bundle. Automatically sets `LD_LIBRARY_PATH` and `GI_TYPELIB_PATH` for native prebuilds.

```bash
npx @gjsify/cli run dist/index.js
```

| Argument | Description |
|---|---|
| `<file>` | The GJS bundle to run |
| `[args..]` | Extra arguments passed through to `gjs` |

<details>
<summary>Running without gjsify run</summary>

`gjsify run` is a convenience wrapper. Without native prebuilds, you can run `gjs` directly:

```bash
gjs -m dist/index.js
```

With native prebuilds, generate the environment:

```bash
eval $(npx @gjsify/cli info --export)
gjs -m dist/index.js
```

</details>

## `gjsify check`

Verify that required system dependencies are installed.

```bash
npx @gjsify/cli check
```

Reports an install command for your detected package manager when something is missing. Exits with code **1** if any required dependency is missing.

<details>
<summary>Required vs optional dependencies</summary>

**Required** — always checked:
- Build toolchain: `gjs`, `pkg-config`, `meson`, `blueprint-compiler`
- Foundational libraries: `gtk4`, `libadwaita-1`, `libsoup-3.0`, `gobject-introspection-1.0`

**Optional** — only checked if a corresponding `@gjsify/*` package is in your project:

| Optional dep | Required by |
|---|---|
| `libmanette-0.2` | `@gjsify/gamepad` |
| `gstreamer-1.0`, `gstreamer-app-1.0` | `@gjsify/webaudio` |
| `webkitgtk-6.0` | `@gjsify/iframe` |
| `gdk-pixbuf-2.0` | `@gjsify/dom-elements`, `@gjsify/canvas2d` |
| `pango`, `pangocairo`, `cairo` | `@gjsify/canvas2d` |
| `gwebgl` (npm package) | `@gjsify/webgl` |

</details>

<details>
<summary>JSON output</summary>

```bash
npx @gjsify/cli check --json
```

```json
{
  "packageManager": "dnf",
  "deps": [
    {
      "id": "gjs",
      "name": "GJS",
      "found": true,
      "version": "1.86.0",
      "severity": "required"
    },
    {
      "id": "manette",
      "name": "libmanette",
      "found": false,
      "severity": "optional",
      "requiredBy": ["@gjsify/gamepad"]
    }
  ]
}
```

</details>

## `gjsify info`

List native GJSify packages and show the `LD_LIBRARY_PATH` / `GI_TYPELIB_PATH` needed for `gjs`.

```bash
npx @gjsify/cli info dist/index.js
eval $(npx @gjsify/cli info --export)
```

| Argument / Option | Description |
|---|---|
| `[file]` | Bundle path used in the generated example command |
| `--export` | Emit only shell `export` statements, suitable for `eval` |

## `gjsify showcase`

List or run the curated showcase applications bundled with the CLI.

```bash
npx @gjsify/cli showcase                  # list all
npx @gjsify/cli showcase three-geometry-teapot
```

| Option | Default | Description |
|---|---|---|
| `[name]` | — | Showcase name to run. Omit to list available showcases |
| `--list` | `false` | Force list mode |
| `--json` | `false` | Output as JSON (list mode only) |

Before running, `gjsify showcase` calls `gjsify check` to verify system dependencies.
