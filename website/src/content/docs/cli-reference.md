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
| `--shebang` | bool | `false` | Prepend `#!/usr/bin/env -S gjs -m` to the outfile and chmod it `0o755`. Only with `--app gjs` and a single `--outfile`. |
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
| `--external` | name[] | `[]` | Module specifiers that should NOT be bundled — they remain as runtime imports. Repeatable; comma-separated values are split. Merged with the platform's built-in externals. |
| `--define` | `KEY=VALUE`[] | `[]` | esbuild `--define` pass-through. VALUE is a JS expression — string literals must be JSON-quoted (`--define VERSION='"1.2.3"'`). Repeatable. Merged with built-in defines like `global: 'globalThis'`. |
| `--alias` | `FROM=TO`[] | `[]` | Layered on top of the built-in alias map. Useful for stubbing heavy deps (`--alias typedoc=@gjsify/empty`). Repeatable. |

For `--app gjs`, the target is `firefox128` (SpiderMonkey 128) and `gi://*`, `cairo`, `system` and `gettext` are externalised. For `--app node`, the target is `node24`.

</details>

#### Bundling third-party CLIs that read their own `package.json` at load time

Tools like `typedoc` and `prettier` read their own `package.json` via `Path.join(fileURLToPath(import.meta.url), '../../../package.json')` during top-level evaluation. When bundled, `import.meta.url` resolves to the bundle file, not the original main, so the lookup escapes the package and crashes. Combine `--external` (so Node's runtime resolver finds the package in `node_modules`) with `--define` for any build-time version constants the bundled code expects:

```bash
gjsify build src/cli.entry.ts --app node --outfile dist/cli.mjs \
  --define '__MY_VERSION__="1.0.0"' \
  --external typedoc,prettier,@inquirer/prompts,inquirer
```

`--external` is the right answer on Node. On GJS, `gjsify run` does not yet have a node_modules-style runtime resolver, so externalised packages fail with `ImportError: Module not found`. Bundling them is the only option on GJS today; the alternative is upstream switching to a `--define`-injected version constant.

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

**WebRTC (GStreamer webrtcbin, GJS-only)**

| Identifier(s) | Register subpath |
|---|---|
| `RTCPeerConnection`, `RTCSessionDescription`, `RTCIceCandidate`, `RTCPeerConnectionIceEvent` | `@gjsify/webrtc/register/peer-connection` |
| `RTCDataChannel`, `RTCDataChannelEvent` | `@gjsify/webrtc/register/data-channel` |
| `RTCError`, `RTCErrorEvent` | `@gjsify/webrtc/register/error` |
| `MediaStream`, `MediaStreamTrack`, `RTCTrackEvent` | `@gjsify/webrtc/register/media` |
| `MediaDevices` (`navigator.mediaDevices`) | `@gjsify/webrtc/register/media-devices` |

**WebAssembly Promise APIs**

| Identifier(s) | Register subpath |
|---|---|
| `WebAssembly` (`WebAssembly.compile`, `WebAssembly.instantiate`, `WebAssembly.validate`, `WebAssembly.compileStreaming`, `WebAssembly.instantiateStreaming`) | `webassembly/register/promise` |

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

## `gjsify dlx`

Run the GJS bundle of an npm-published package without persisting it in your project. Pattern follows `npx` / `yarn dlx` / `pnpm dlx`, but `dlx` here is strictly a **GJS-bundle runner**: it always invokes `gjs -m <bundle>` after resolving the package's GJS entry. Packages without a GJS entry fail loudly.

```bash
gjsify dlx @gjsify/example-dom-canvas2d-fireworks
gjsify dlx @scope/pkg@1.2.3                    # version-pinned
gjsify dlx @scope/pkg my-bin -- --opt value    # pick a bin from gjsify.bin, forward args
gjsify dlx ./local/path                        # local dir (no install, no cache)
```

| Option | Description |
|---|---|
| `<spec>` | Package spec (`name`, `name@version`, `@scope/name@spec`, or local path). |
| `[binOrArg]` | Bin name when `gjsify.bin` has multiple entries; otherwise treated as the first arg forwarded to the bundle. |
| `[extraArgs..]` | Extra args forwarded to `gjs -m <bundle>`. |
| `--cache-max-age <minutes>` | Cache TTL. Defaults to 7 days. Use `0` to bypass cache. |
| `--registry <url>` | npm registry override (writes a temp `.npmrc` in the cache dir). |
| `--verbose` | Pass `--loglevel verbose` to npm. |

Cache layout: `$XDG_CACHE_HOME/gjsify/dlx/<sha256>/`. Cache-key is sha-256 over the sorted package specs and registries. Atomic symlink swap on first install means parallel `dlx` invocations of the same spec are safe.

### `package.json` `gjsify` field

`dlx` (and the future `gjsify install` / `gjsify showcase`) read the package's GJS entry from a top-level `gjsify` object:

```jsonc
{
  "name": "@gjsify/example-dom-canvas2d-fireworks",
  "main": "dist/node.js",        // optional Node entry
  "exports": { "./browser": "..." },
  "gjsify": {
    "main": "dist/gjs.js",       // GJS entry — used by `gjsify dlx <pkg>`
    "bin": {                     // optional: multiple GJS entries
      "fireworks": "dist/gjs.js"
    },
    "prebuilds": "prebuilds"     // existing convention for native prebuilds
  }
}
```

Resolution order:

1. user-supplied bin name + `gjsify.bin[name]` → that path
2. single-entry `gjsify.bin` → the only path (auto-pick)
3. `gjsify.main` → that path
4. **fallback:** top-level `package.json#main` → that path (advisory warning to add `gjsify.main`)
5. otherwise: hard-fail with a fix hint

Multi-bin packages without a chosen bin fail with `dlx: package "X" defines multiple GJS bins — pass one of: a, b`.

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
| `gstreamer-webrtc-1.0`, `gstreamer-sdp-1.0`, `libnice` | `@gjsify/webrtc` |
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

## `gjsify gresource`

Compile a GResource XML descriptor into a binary `.gresource` bundle. Thin wrapper around `glib-compile-resources` — useful when you want to package UI templates and assets into the app bundle without pulling in meson/autotools.

```bash
npx @gjsify/cli gresource data/org.example.App.data.gresource.xml \
  --sourcedir data \
  --target dist/org.example.App.data.gresource
```

| Option | Default | Description |
|---|---|---|
| `<xml>` | — | Path to the `.gresource.xml` descriptor (required) |
| `--sourcedir` | `dirname(<xml>)` | Directory containing the resource files referenced by `<xml>` |
| `--target`, `-t` | `<xml-without-.xml>` next to `<xml>` | Output `.gresource` file |
| `--verbose` | `false` | Print the underlying `glib-compile-resources` invocation |

Requires `glib-compile-resources` (package: `glib2-devel` on Fedora, `libglib2.0-dev-bin` on Debian/Ubuntu).

See it in action: [`adwaita-package-builder` showcase](https://github.com/gjsify/gjsify/tree/main/showcases/dom/adwaita-package-builder) embeds `style.css` this way.

## `gjsify gettext`

Compile gettext `.po` files for GNOME apps. Wraps `msgfmt` with the common output shapes — per-language locale tree (`.mo`), metainfo template substitution (`.xml`), and two less-common formats (`.desktop`, `.json`).

```bash
# Compile to runtime .mo locale tree
npx @gjsify/cli gettext translations dist/locale --domain org.example.App

# Substitute a metainfo template via msgfmt --xml --template
npx @gjsify/cli gettext translations dist/metainfo \
  --domain org.example.App \
  --format xml \
  --metainfo data/metainfo/org.example.App.metainfo.xml.in
```

| Option | Default | Description |
|---|---|---|
| `<poDir>` | — | Directory containing `<lang>.po` files (required) |
| `<outDir>` | — | Output directory (locale tree for `--format=mo`, plain dir otherwise) (required) |
| `--domain` | — | Text domain / application ID (required) |
| `--format` | `mo` | One of `mo`, `xml`, `desktop`, `json` |
| `--metainfo` | — | For `--format=xml`: path to the template (`.metainfo.xml.in`) used as `msgfmt --template` |
| `--filename` | `<domain>.<ext>` | Override the output filename |
| `--remove-xml-comments` | `true` | For `--format=xml`: strip XML comments from the compiled output |
| `--verbose` | `false` | Print each `msgfmt` invocation |

Requires `msgfmt` (package: `gettext`).

See it in action: [`adwaita-package-builder` showcase](https://github.com/gjsify/gjsify/tree/main/showcases/dom/adwaita-package-builder) uses both `--format mo` (runtime `.mo` tree) and `--format xml --metainfo` (AppStream substitution).

Before running, `gjsify showcase` calls `gjsify check` to verify system dependencies.
