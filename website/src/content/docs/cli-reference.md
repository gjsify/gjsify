---
title: CLI Reference
description: Every gjsify command, with the flags, defaults and examples you actually need.
---

`gjsify` is the only binary a GJSify project needs. It scaffolds, builds, runs, tests, formats, packages and publishes.

Get it with the runtime you already have. The bootstrap script installs a standalone `gjsify` and is itself run by `gjs`, so it works on a machine with no Node on it:

```bash
curl -fsSL https://github.com/gjsify/gjsify/releases/latest/download/install.mjs \
  -o /tmp/g.mjs && gjs -m /tmp/g.mjs && rm /tmp/g.mjs
```

The three package runners fetch the CLI from npm and run it in place:

```bash
npx @gjsify/cli@latest <command>
bunx @gjsify/cli@latest <command>
deno run -A --reload --min-dep-age=0 npm:@gjsify/cli@latest <command>
```

See [Install & Update](/gjsify/guides/install/) for the details.

Keep the `@latest` tag. All three runners reuse a cached copy of an unpinned bin, so a plain `npx @gjsify/cli …` can go on serving a release from months ago, and Deno adds a second rule that refuses anything published in the last 24 hours. Neither one tells you it happened; [Which version do `npx`, `bunx` and `deno run` give you?](/gjsify/guides/install/#which-version-do-npx-bunx-and-deno-run-give-you) has the measurement. Every example below writes plain `gjsify`; swap in whichever launcher you use.

`gjsify --help` lists every command, and its last line tells you which runtime the CLI itself is on, for example `Running on GJS 1.88.1 (SpiderMonkey)` or `Running on Node.js v24.x.y`. Each command prints its own flags with `gjsify <command> --help`, except the two pass-through commands, `run` and `tsc`, which hand `--help` to the target they launch. That host runtime picks the default `--app` target for `gjsify build` and the default `--runtime` for `gjsify run` and `gjsify storybook`.

## Commands at a glance

| Task | Commands |
|---|---|
| Start a project | [`create`](#gjsify-create) |
| Build and run | [`build`](#gjsify-build) · [`dev`](#gjsify-dev) · [`run`](#gjsify-run) · [`test`](#gjsify-test) · [`clear`](#gjsify-clear) · [`copy`](#gjsify-copy) |
| Dependencies | [`install`](#gjsify-install) · [`uninstall`](#gjsify-uninstall) · [`prune`](#gjsify-prune) · [`upgrade`](#gjsify-upgrade) · [`dlx`](#gjsify-dlx) · [`self-update`](#gjsify-self-update) · [`generate-installer`](#gjsify-generate-installer) |
| Monorepos | [`foreach`](#gjsify-foreach) · [`workspace`](#gjsify-workspace) · [`affected`](#gjsify-affected) |
| Code quality | [`check`](#gjsify-check) · [`tsc`](#gjsify-tsc) · [`format`](#gjsify-format) · [`lint`](#gjsify-lint) · [`fix`](#gjsify-fix) · [`barrels`](#gjsify-barrels) |
| GNOME assets | [`gresource`](#gjsify-gresource) · [`gsettings`](#gjsify-gsettings) · [`gettext`](#gjsify-gettext) |
| Environment | [`system-check`](#gjsify-system-check) · [`info`](#gjsify-info) |
| Explore | [`showcase`](#gjsify-showcase) |
| Debug a running app | [`storybook`](#gjsify-storybook) · [`debug`](#gjsify-debug) · [`browse`](#gjsify-browse) |
| Ship it | [`ship`](#gjsify-ship) · [`flatpak`](#gjsify-flatpak) |
| Publish to npm | [`pack`](#gjsify-pack) · [`publish`](#gjsify-publish) · [`whoami`](#gjsify-whoami) · [`login`](#gjsify-login) · [`logout`](#gjsify-logout) · [`trust`](#gjsify-trust) · [`onboard`](#gjsify-onboard) |

## Start a project

### `gjsify create`

Scaffold a new project into a new directory.

```bash
gjsify create my-app --template gtk-minimal
gjsify create my-app --template cli --runtime deno
gjsify create my-app --template cli --package-manager pnpm --install
gjsify create                       # pick template, runtime and manager interactively
```

On a terminal it asks three questions in order (template, runtime, package manager), each narrowing the next. Every one can be answered by a flag instead, which is also how it is driven without a TTY. `npm create @gjsify/app` is the same scaffolder and takes the same flags.

| Option | Default | Description |
|---|---|---|
| `[project-name]` | `my-gjs-app` | Directory to create. |
| `-t`, `--template <name>` | prompted | Which template to scaffold from. Required when stdin is not a TTY. |
| `-r`, `--runtime <rt>` | the host runtime | One of the runtimes the chosen template declares. Decides which package managers are on offer and which start script the next steps name. |
| `-p`, `--package-manager <pm>` | the runtime's first | Must be one the chosen runtime can install for. Required alongside `--install` when there is no TTY, since that default would write your `node_modules` and lockfile. |
| `-f`, `--force` | `false` | Scaffold into a directory that already has files in it. |
| `--install` | `false` | Run an install right after scaffolding. |

An installer has to produce the module layout its runtime resolves against, so the runtime decides which managers are offered: `gjs` → `gjsify`; `node` → `npm`, `yarn`, `pnpm`, `gjsify`; `bun` → `bun`; `deno` → `deno`. Where a runtime offers exactly one, nothing is asked: it is used and announced. Passing `-p` without `-r` settles the runtime too, since a pinned manager already names one (`-p bun` sets the project up for Bun).

The templates:

| Template | What you get |
|---|---|
| `gtk-minimal` | A `Gtk.Window` with a `Gtk.Label`. No Adwaita, no Blueprint. |
| `adw-canvas2d` | Adwaita app rendering through HTML Canvas 2D, Blueprint UI. |
| `adw-webgl` | Adwaita app with WebGL and three.js, Blueprint UI. |
| `adw-game` | Adwaita game shell on Excalibur.js, WebGL with a Canvas2D fallback. |
| `cli` | Command-line tool built on yargs. |
| `web-server-express` | HTTP server on Express. |
| `web-server-hono` | HTTP server on Hono, fetch-style API. |

Every template ships `src/`, a `tsconfig.json` and a `package.json` with `build`, `start`, `dev`, `check` and `clear` scripts. All seven declare `gjs`, `node`, `bun` and `deno` in `gjsify.example.runtimes` and build both bundles (`build:gjs` and `build:node`), so `-r` decides which start script the printed next steps name (`start` for gjs, `start:node`, `start:bun` or `start:deno` for the others), not what the project can do later. The GTK templates list `@gjsify/node-gi` as a dependency, which is what carries `gi://` on the three non-GJS runtimes. Scaffolding is done by [`@gjsify/create-app`](https://www.npmjs.com/package/@gjsify/create-app).

## Build and run

### `gjsify build`

Compile and bundle with [Rolldown](https://rolldown.rs/). Node.js and Web API imports are aliased to their `@gjsify/*` equivalents automatically, so `import { readFileSync } from 'node:fs'` works on GJS with no configuration.

```bash
gjsify build src/index.ts --outfile dist/index.js
gjsify build src/index.ts --outfile dist/index.js --no-minify   # readable output
gjsify build src/index.ts --watch                               # rebuild on change
```

| Option | Values | Default | Description |
|---|---|---|---|
| `[entryPoints..]` | paths | `bundler.input`, else `src/index.ts` | Entry points to bundle. |
| `--app` | `gjs` \| `node` \| `browser` \| `nativescript` | the host runtime's target | Build target. Under GJS you get `gjs`; under Node, Bun or Deno you get `node`. Bun and Deno consume the same `node` bundle, so they have no target of their own. Override here or with `gjsify.app` in `package.json`. |
| `-o`, `--outfile` | path | from `package.json` | Output file (application mode). |
| `-d`, `--outdir` | path | from `package.json` | Output directory (library mode). |
| `--minify` | bool | `true` | Minify the output. Pass `--no-minify` for pretty-printed code. |
| `--globals` | string | `auto` | Which globals to inject. See [Globals](#globals). |
| `--dialect` | `react-native` | none | Build a React Native application for a desktop target. Aliases `react-native` to [`@gjsify/react-native`](/gjsify/frameworks/react-native/) so your files keep the import they already have, and fails the build on a name that layer does not implement, naming the file and the line. Opt-in only, on `--app gjs` and `--app node`; also readable as `gjsify.dialect` in `package.json`. |
| `--exclude-globals` | list | none | Identifiers to drop from the auto-detected set, for false positives out of dead compat code (`--exclude-globals fetch,XMLHttpRequest`). |
| `--shebang` | bool | `false` | Prepend a target-appropriate shebang and `chmod 755` the output: `#!/usr/bin/env -S gjs -m` for `--app gjs`, `#!/usr/bin/env node` for `--app node`. Needs a single `--outfile`. |
| `-w`, `--watch` | bool | `false` | Watch sources and rebuild on change, logging each rebuild with its duration. Ctrl-C stops it cleanly. Rejected with `--library`, and it needs the npm `rolldown` engine, so run it under Node. On GJS use [`gjsify dev`](#gjsify-dev), which needs no watcher API and relaunches the app too. |
| `--verbose` | bool | `false` | Print detected globals and build details. |

<details>
<summary>The rest of the build flags</summary>

| Option | Values | Default | Description |
|---|---|---|---|
| `--format` | `iife` \| `esm` \| `cjs` | auto | Override the output format. |
| `--library` | bool | `false` | Build a reusable library instead of an application. |
| `-r`, `--reflection` | bool | `false` | Enable TypeScript runtime types via Deepkit's type compiler. |
| `--console-shim` | bool | `true` | Inject the GJS console shim, so output has no GLib prefix and ANSI colours work. `--no-console-shim` turns it off. GJS app builds only. |
| `--exclude` | glob[] | `[]` | Glob patterns to exclude from entry points and aliases. |
| `--log-level` | `silent` \| `error` \| `warning` \| `info` \| `debug` \| `verbose` | `warning` | Bundler log level. |
| `--external` | name[] | `[]` | Package names that stay as runtime imports instead of being bundled. Exact names only, no globs. Repeat the flag or pass a comma-separated list. Appended to the built-in externals for the target. `<pkg>/register` subpaths are always inlined for `--app gjs`, whatever you pass here. |
| `--define` | `KEY=VALUE`[] | `[]` | Compile-time constants. `VALUE` is a JS expression, so string literals need quoting: `--define VERSION='"1.2.3"'`. Repeatable. |
| `--alias` | `FROM=TO`[] | `[]` | Extra module aliases on top of the built-in map. Handy for stubbing heavy deps: `--alias typedoc=@gjsify/empty`. Repeatable. |

For `--app gjs` the JS target is `firefox140` (SpiderMonkey 140), and `gi://*`, `cairo`, `system` and `gettext` stay external. For `--app node` the target is `node24`.

**Native N-API addons on GJS.** A `--app gjs` build routes a compiled `.node` addon through [`@gjsify/napi`](/gjsify/projects/napi/)'s `loadAddon`, intercepting the addon's own `bindings` or `node-gyp-build` helper (or a direct `.node` import) and finding the binary with node-gyp-build's probe order. So `import Database from 'better-sqlite3'` works after `gjsify install @gjsify/napi`, with no config. It does nothing when no native addon is in the graph, and it never applies to `--app node`, `browser` or `nativescript`.

</details>

#### Compile JSX and Vue templates

JSX and `.vue` are compiler input, not runtime syntax, so the build needs a plugin that knows which framework you meant. Name one under `gjsify.bundler.plugins` ([below](#name-a-bundler-plugin-instead-of-writing-a-config-file)) and build the entry normally:

```bash
gjsify build src/app.tsx --app gjs --outfile dist/app.gjs.mjs
```

- [`@gjsify/rolldown-plugin-solid`](/gjsify/frameworks/solid/) for SolidJS JSX
- [`@gjsify/rolldown-plugin-vue`](/gjsify/frameworks/vue/) for Vue single-file components

**`--app gjs` refuses a JSX entry that configures no transform**, and that refusal is the point. Left unset, the transformer applies its own default — the automatic React runtime — so the bundle imports `react/jsx-runtime`. GJS resolves no bare specifier, so the build would report the miss as a *warning*, exit 0, and the artifact would abort at load with `ImportError: Module not found: react/jsx-runtime`. On a project that does have React installed it is worse: the bundle builds React elements, which a GTK host does nothing with.

Answer the question one of three ways, and the error message lists all three:

| Answer | How |
|---|---|
| Preserve the JSX for a framework compiler | `"jsx": "preserve"` in tsconfig or `gjsify.bundler.transform.jsx`, plus the plugin above. Pair with tsconfig `"jsxImportSource": "@gjsify/gtk-host"` for the types. |
| Use an automatic runtime you actually have | `"jsx": "react-jsx"` + `"jsxImportSource": "<pkg exporting ./jsx-runtime>"`. **Not** `@gjsify/gtk-host` — its `/jsx-runtime` is a type surface and throws when called. |
| Say the entry holds no JSX | `"jsx": false`, and the transformer reports the JSX itself. |

`--app node` and `--app browser` are unaffected: the React default is a legitimate answer there, and refusing would break builds for a mistake they did not make.

#### Bundle a third-party CLI that reads its own `package.json`

Tools like `typedoc` and `prettier` read their own `package.json` during top-level evaluation, via something like `Path.join(fileURLToPath(import.meta.url), '../../../package.json')`. Once bundled, `import.meta.url` points at your bundle, the lookup escapes the package, and the tool crashes on startup.

On Node, keep those packages external so Node's own resolver finds them in `node_modules`, and supply any build-time constants they expect with `--define`:

```bash
gjsify build src/cli.entry.ts --app node --outfile dist/cli.mjs \
  --define '__MY_VERSION__="1.0.0"' \
  --external typedoc,prettier,@inquirer/prompts,inquirer
```

On GJS this does not work: `gjsify run` has no `node_modules`-style runtime resolver, so an externalised package fails with `ImportError: Module not found`. Bundle them there instead.

### Globals

`--globals auto` is the default. It reads the bundled output and injects only the register modules your code actually needs, so most projects never touch this flag.

| Mode | Usage | What it does |
|---|---|---|
| `auto` | `--globals auto` | Detect everything from the bundled output. |
| `auto,<extras>` | `--globals auto,dom` | Auto plus explicit extras, for globals the detector cannot see. |
| explicit list | `--globals fetch,Buffer` | Exactly these, no detection. |
| `none` | `--globals none` | Inject nothing. |

Three group names expand to sets of identifiers: `node` (Buffer, process, URL and friends), `web` (fetch, streams, crypto, events) and `dom` (document, Image, navigator).

The detector cannot follow value-flow indirection. Excalibur, for instance, stashes `globalThis` in a field and calls methods through it, so nothing named `matchMedia` ever appears in the bundle. Keep auto on and add the extras:

```bash
gjsify build src/gjs/gjs.ts -o dist/gjs.js --globals auto,dom
gjsify build src/index.ts -o dist/index.js --globals auto,matchMedia,FontFace
```

`--verbose` shows what auto found:

```bash
gjsify build src/index.ts -o dist/index.js --verbose
# [gjsify] --globals auto: converged after 2 iteration(s), 11 global(s):
#   AbortSignal, Buffer, HTMLElement, document, fetch, navigator, …
```

The multi-pass machinery behind this is described in [How It Works](/gjsify/how-it-works/#automatic-globals-detection).

### Known identifiers

Anything in this table can appear in `--globals`, and auto detection recognises the same set. The subpaths are granular on purpose: asking for `Buffer` does not drag in `process` or `URL`.

**Node.js core globals**

| Identifier(s) | Register subpath |
|---|---|
| `Buffer` | `@gjsify/node-globals/register/buffer` |
| `process` | `@gjsify/node-globals/register/process` |
| `setTimeout`, `setInterval`, `clearTimeout`, `clearInterval`, `setImmediate`, `clearImmediate` | `@gjsify/node-globals/register/timers` |
| `queueMicrotask` | `@gjsify/node-globals/register/microtask` |
| `structuredClone` | `@gjsify/node-globals/register/structured-clone` |
| `btoa`, `atob` | `@gjsify/node-globals/register/encoding` |
| `URL`, `URLSearchParams` | `@gjsify/node-globals/register/url` |
| `Blob`, `File` | `@gjsify/buffer/register` |

GJS provides `setTimeout` and `setInterval` natively, but their return value is a boxed `GLib.Source` whose finalizer can crash the process. They are listed here so the replacement, which returns numeric ids, is injected wherever timers are used.

**Fetch and XHR**

| Identifier(s) | Register subpath |
|---|---|
| `fetch`, `Headers`, `Request`, `Response` | `fetch/register/fetch` |
| `XMLHttpRequest`, `XMLHttpRequestUpload` | `fetch/register/xhr` |

**Streams**

| Identifier(s) | Register subpath |
|---|---|
| `ReadableStream`, `ReadableStreamBYOBReader`, `ReadableStreamBYOBRequest`, `ReadableByteStreamController`, `ReadableStreamDefaultController`, `ReadableStreamDefaultReader` | `web-streams/register/readable` |
| `WritableStream` | `web-streams/register/writable` |
| `TransformStream` | `web-streams/register/transform` |
| `TextEncoderStream`, `TextDecoderStream` | `web-streams/register/text-streams` |
| `ByteLengthQueuingStrategy`, `CountQueuingStrategy` | `web-streams/register/queuing` |
| `CompressionStream`, `DecompressionStream` | `compression-streams/register` |

**Crypto**

| Identifier(s) | Register subpath |
|---|---|
| `crypto` | `webcrypto/register` |

**Abort, messaging and events**

| Identifier(s) | Register subpath |
|---|---|
| `AbortController`, `AbortSignal` | `abort-controller/register` |
| `MessageChannel`, `MessagePort` | `message-channel/register` |
| `Event`, `EventTarget` | `dom-events/register/event-target` |
| `CustomEvent`, `MessageEvent`, `ErrorEvent`, `CloseEvent`, `ProgressEvent` | `dom-events/register/custom-events` |
| `UIEvent`, `MouseEvent`, `PointerEvent`, `KeyboardEvent`, `WheelEvent`, `FocusEvent` | `dom-events/register/ui-events` |
| `EventSource` | `eventsource/register` |
| `WebSocket` | `websocket/register` |
| `DOMException` | `dom-exception/register` |

**Performance and FormData**

| Identifier(s) | Register subpath |
|---|---|
| `performance`, `PerformanceObserver` | `@gjsify/web-globals/register/performance` |
| `FormData` | `@gjsify/web-globals/register/formdata` |

**WebAssembly promise APIs**

| Identifier(s) | Register subpath |
|---|---|
| `WebAssembly` (`compile`, `instantiate`, `validate`, `compileStreaming`, `instantiateStreaming`) | `webassembly/register/promise` |

**DOM parsing, audio and gamepads (GJS only)**

| Identifier(s) | Register subpath |
|---|---|
| `DOMParser` | `@gjsify/domparser/register` |
| `AudioContext`, `webkitAudioContext`, `Audio`, `HTMLAudioElement` | `@gjsify/webaudio/register` |
| `GamepadEvent` | `@gjsify/gamepad/register` |

**WebRTC, on GStreamer webrtcbin (GJS only)**

| Identifier(s) | Register subpath |
|---|---|
| `RTCPeerConnection`, `RTCSessionDescription`, `RTCIceCandidate`, `RTCPeerConnectionIceEvent` | `@gjsify/webrtc/register/peer-connection` |
| `RTCDataChannel`, `RTCDataChannelEvent` | `@gjsify/webrtc/register/data-channel` |
| `RTCError`, `RTCErrorEvent` | `@gjsify/webrtc/register/error` |
| `MediaStream`, `MediaStreamTrack`, `RTCTrackEvent` | `@gjsify/webrtc/register/media` |
| `MediaDevices` (`navigator.mediaDevices`) | `@gjsify/webrtc/register/media-devices` |

**DOM and browser compatibility (GTK backed)**

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

**Canvas 2D, iframe and WebGL (GTK, WebKit and GLArea backed)**

These are deliberately not part of the coarse `dom` group. Injecting one requires its package (and WebKitGTK for the iframe) to be installed, so auto detection pulls them in only when the identifier really appears in the bundle.

| Identifier(s) | Register subpath |
|---|---|
| `ImageData`, `Path2D` | `@gjsify/canvas2d/register` |
| `HTMLIFrameElement` | `@gjsify/iframe/register` |
| `WebGLRenderingContext`, `WebGL2RenderingContext` | `@gjsify/webgl/register` |

Identifiers outside this table are ignored. If you still hit `ReferenceError: X is not defined`, add `X` as an extra: `--globals auto,X`.

The two GTK-backed groups are the ones an `--app node` build can also ask for. A plain `--globals auto` node build injects nothing, because Node, Bun and Deno bring their own `fetch`, streams, crypto and events. Name a group or an identifier explicitly and it injects the same register modules the `--app gjs` target would, reaching GTK through [`@gjsify/node-gi`](/gjsify/projects/node-gi/). That is what the GTK templates' `build:node` script does:

```bash
gjsify build src/index.ts --app node --outfile dist/index.node.mjs --globals auto,dom
```

### `gjsify dev`

Watch the project, rebuild on change and relaunch the app. All seven templates wire their `dev` script to it.

```bash
gjsify dev                       # watch, rebuild and relaunch on the host runtime
gjsify dev --runtime node        # build and launch the `--app node` bundle instead
gjsify dev src/main.ts --watch-dir src
gjsify dev --build-only          # rebuild on every change, never launch
```

| Argument / Option | Description |
|---|---|
| `[entry]` | Entry point to build. Default: the one the build script names, e.g. `src/index.ts` out of `build:gjs`. |
| `--runtime <gjs\|node\|bun\|deno>` | Runtime to build for and launch on. Default: the host runtime. `node`, `bun` and `deno` all build the same `--app node` bundle. |
| `--script <name>` | The `package.json` script the build flags are read from. Default: `build:gjs`, or `build:node` for `node`/`bun`/`deno`. |
| `--globals <value>` | Override the build script's `--globals` value. |
| `--outfile <path>` | Override the build script's `--outfile` path. |
| `--watch-dir <dir>` | Directory watched recursively. Default: the directory of the entry point. |
| `--debounce <ms>` | Quiet window after a change before the rebuild starts. Default: `200`. |
| `--build-only` | Rebuild on every change but never launch the app. |

**What gets built is not declared twice.** `gjsify dev` reads your own `build:gjs` / `build:node` script and layers its flags on top, so the dev loop and `gjsify run build` cannot drift into producing different bundles. Override one flag at a time with `--globals` or `--outfile`, pass a different entry as the positional argument, or point `--script` at another script to follow a different build entirely.

**Why this is not `gjsify build --watch`.** That flag drives rolldown's watcher API, which only the npm engine exposes — on a Node-free GJS host it is not available at all. `gjsify dev` asks for no watcher API: it watches with `fs.watch` and rebuilds by re-entering the ordinary build command, so the same loop runs on gjs, node, bun and deno.

### `gjsify run`

Run a script from `package.json`, or launch a built bundle.

```bash
gjsify run start                    # the `start` script from ./package.json
gjsify run build -w cli             # the `build` script in the `cli` workspace
gjsify run dist/index.js            # a built bundle
gjsify run ./server.mjs -- --port 8080
```

| Argument / Option | Description |
|---|---|
| `<target>` | A script name from the current `package.json`, or a path to a built bundle. |
| `[args..]` | Extra arguments forwarded to the script or to the runtime. Use `--` before flags you do not want gjsify to parse. |
| `-w`, `--workspace <name>` | Run `<target>` as a script in the named workspace, like `npm run <script> -w <name>`. Matches the package name, the workspace-relative path, or the directory basename. |
| `--runtime <gjs\|node\|bun\|deno>` | Launch a bundle **file** on this runtime. Forces file mode. |
| `--node-script` | Treat `<target>` as an unbundled Node-style script that imports `node:` builtins, and run it on the host runtime. Under GJS the file is bundled `--app gjs` on the fly first, which is what lets a repo script run on a machine with no Node. Cannot be combined with `--runtime` or `--workspace`. |

A script name in `package.json` wins over a same-named file on disk, so `gjsify run build` still runs your `build` script even when a `build/` directory exists. To force file mode, write a path (`./build`) or pass `--runtime`.

For a bundle file, `gjsify run` also sets `GI_TYPELIB_PATH` plus the host's library-search variable (`LD_LIBRARY_PATH` on Linux, `DYLD_LIBRARY_PATH` on macOS, `PATH` on Windows) so native prebuilds load.

#### Run a bundle on gjs, node, bun or deno

Without `--runtime`, a bundle file follows the host runtime the CLI is on, with one exception: a `--app gjs` bundle (it keeps `gi://` imports and a `gjs` shebang) always runs on `gjs`, because it has no node-gi shim. `gjs` runs it via `gjs -m`. `node`, `bun` and `deno` all run the **same** `--app node` bundle, since Node-API is their common ABI. `@gjsify/node-gi` is only needed when the bundle actually uses `gi://`.

```bash
gjsify build src/app.ts --app gjs  --outfile dist/app.gjs.mjs
gjsify build src/app.ts --app node --outfile dist/app.node.mjs

gjsify run --runtime gjs  dist/app.gjs.mjs    # gjs -m
gjsify run --runtime node dist/app.node.mjs   # node
gjsify run --runtime bun  dist/app.node.mjs   # bun, same node bundle
gjsify run --runtime deno dist/app.node.mjs   # deno run -A --node-modules-dir=manual
```

If the package declares [`gjsify.example.runtimes`](#per-example-runtime-declaration), the requested runtime is checked against it, so an unsupported runtime fails with a clear message instead of a bundle crash.

<details>
<summary>Running a bundle without gjsify run</summary>

`gjsify run` is a convenience wrapper. With no native prebuilds you can call `gjs` yourself:

```bash
gjs -m dist/index.js
```

With native prebuilds, export the environment first:

```bash
eval $(gjsify info --export)
gjs -m dist/index.js
```

</details>

### `gjsify test`

Build and run the package's `src/test.mts` aggregator on GJS and Node, then aggregate the results.

```bash
gjsify test                     # both runtimes
gjsify test --runtime gjs       # one runtime
gjsify test --no-build          # reuse existing bundles
gjsify test --rebuild           # rebuild even if bundles look fresh
```

| Option | Default | Description |
|---|---|---|
| `--runtime <gjs\|node\|all>` | `all` | Which runtimes to build and run. |
| `--entry <path>` | `gjsify.test.entry`, else `src/test.mts` | Test entry. |
| `--outdir <path>` | `gjsify.test.outdir`, else `dist/` | Where `test.{gjs,node}.mjs` is written. |
| `--rebuild` | `false` | Always rebuild, even when the outputs look up to date. |
| `--build` | `true` | Build before running. `--no-build` skips it when bundles already exist. |
| `--verbose` | `false` | Print the resolved entry and outdir plus per-step timing. |

`gjs` and `node` are the only two runtimes this command drives: it builds the `--app gjs` and `--app node` bundles and runs each on its own runtime. Bun and Deno consume the same `--app node` bundle, so you can point them at it yourself with [`gjsify run --runtime`](#gjsify-run), but `gjsify test` does not drive them.

A runtime you did not ask for explicitly is skipped when its binary is not on `PATH`, with a line saying so. Set defaults in `package.json`:

```json
{
  "gjsify": {
    "test": {
      "entry": "src/test.mts",
      "outdir": "dist",
      "runtimes": ["gjs", "node"]
    }
  }
}
```

The entry usually aggregates [`@gjsify/unit`](https://www.npmjs.com/package/@gjsify/unit) suites:

```ts
// src/test.mts
import { run } from '@gjsify/unit';
import myFeature from './my-feature.spec.js';
import other from './other.spec.js';
run({ myFeature, other });
```

You get one summary line, `[gjsify test] ✅ gjs (412ms)  ✅ node (88ms)`, and a non-zero exit whenever any build or run fails.

### `gjsify clear`

Delete build output. A portable `rm -rf` for your `clear` scripts, so they work on every host.

```bash
gjsify clear dist lib tsconfig.tsbuildinfo
gjsify clear "dist/*.mjs" --dry-run
```

| Option | Default | Description |
|---|---|---|
| `[paths..]` | `[]` | Paths to delete, relative to the current package. A missing path is fine, not an error. `*` and `?` work in the last segment. |
| `--dry-run` | `false` | Print what would be deleted and touch nothing. |
| `-v`, `--verbose` | `false` | Print each path as it goes. |

### `gjsify copy`

Copy files and directories into the build output. A portable `mkdir -p` plus `cp -r`.

```bash
gjsify copy src/style.css dist/
gjsify copy "data/*.ui" data/icons dist/data/
```

| Option | Default | Description |
|---|---|---|
| `[paths..]` | `[]` | One or more sources followed by the destination. |
| `--dry-run` | `false` | Print what would be copied and touch nothing. |
| `-v`, `--verbose` | `false` | Print each path as it goes. |

The destination is treated as a directory when it ends in `/`, when you pass several sources, or when a source has a wildcard. Otherwise it is the exact target path. Missing parent directories are created. `*` and `?` work in the last segment of a source.

## Configure it in `package.json`

Anything you would pass repeatedly on the command line can live in the `gjsify` field of `package.json`, or in `.gjsifyrc.js` / `gjsify.config.mjs`. CLI flags always win.

| Key | What it sets |
|---|---|
| `app` | Default `--app` target for this project. |
| `bundler` | Rolldown options passed through. Most projects only set `output.file`, `output.dir` or [`plugins`](#name-a-bundler-plugin-instead-of-writing-a-config-file). |
| `globals` | Default `--globals` value. |
| `excludeGlobals` | Identifiers to drop from the auto-detected set. |
| `exclude` | Glob patterns to exclude from entry points and aliases. |
| `consoleShim` | Inject the GJS console shim. Default `true`, and read by `--app gjs` builds only. |
| `shebang` | `true` for the built target's own line (`#!/usr/bin/env -S gjs -m` for `--app gjs`, `#!/usr/bin/env node` for `--app node`), `false` for none, or your own string. |
| `aliases` | Extra module aliases, the config form of `--alias`. |
| `loaders` | Extension to loader kind, for files Rolldown does not classify. |
| `defineFromPackageJson` | Compile-time constants read out of `package.json`. |
| `defineFromEnv` | Compile-time constants read out of `process.env` at config-load time. |
| `nodeScript` | `globals` / `excludeGlobals` overrides for the ad-hoc bundle `gjsify run --node-script` builds. |
| `library`, `typescript` | Library-mode `package.json` fields and TypeScript options (`reflection: true` turns on Deepkit). |
| `main`, `bin` | The GJS entry (and named GJS bins) that `gjsify dlx` and `gjsify ship` read. |
| `prebuilds` | Directory holding native prebuilds. |
| `test` | Defaults for [`gjsify test`](#gjsify-test). |
| `example` | Declared runtimes for [`gjsify run --runtime`](#gjsify-run) and [`gjsify showcase`](#gjsify-showcase). |
| `storybook` | Defaults for [`gjsify storybook`](#gjsify-storybook). |
| `browse`, `devtools` | Defaults for [`gjsify browse`](#gjsify-browse) and [`gjsify debug`](#gjsify-debug). |
| `flatpak` | Config for the [`gjsify flatpak`](#gjsify-flatpak) commands. |
| `ship` | Config for [`gjsify ship`](#gjsify-ship). Metadata falls back to `flatpak`. |

### Where `define` goes

`define` belongs under `bundler.transform.define`, not at the top level of `bundler`. Rolldown reads only the nested one. If you write `bundler.define`, GJSify moves it for you and warns at build time; move it yourself to silence the warning.

```jsonc
// works, but warns on every build
{ "gjsify": { "bundler": { "define": { "__APP_ID__": "\"org.example.App\"" } } } }

// canonical
{ "gjsify": { "bundler": { "transform": { "define": { "__APP_ID__": "\"org.example.App\"" } } } } }
```

To pull a constant out of `package.json` or the environment instead, use the dedicated keys:

```jsonc
{
  "gjsify": {
    "defineFromPackageJson": { "__PACKAGE_VERSION__": { "field": "version" } },
    "defineFromEnv": { "__PREFIX__": { "env": "PREFIX", "default": "/usr" } }
  }
}
```

An unset variable with no `default` becomes the literal `undefined`, so you can guard with `typeof __PREFIX__ === 'undefined'`.

### Name a bundler plugin instead of writing a config file

`bundler.plugins` takes a list of plugin *entries*, so a project that needs one extra transform keeps its whole build in `package.json`:

```jsonc
{
  "gjsify": {
    "bundler": {
      "plugins": [
        { "name": "@gjsify/rolldown-plugin-solid" },
        { "name": "./build/my-plugin.mjs", "export": "myPlugin", "options": { "verbose": true } }
      ]
    }
  }
}
```

| Field | Default | What it does |
|---|---|---|
| `name` | required | A package name, or a path relative to the project. Resolution is anchored at the project root, so the project's own `node_modules` wins over the CLI's. |
| `export` | `default` | Which export to call. It has to be a function returning a Rolldown plugin. |
| `options` | `{}` | Passed to that function. |

`plugins` is an array, and every entry is an object with those fields — a bare `"@gjsify/rolldown-plugin-solid"` string is not the same thing and is not accepted.

A named plugin must be a real dependency of the package that configures it — `dependencies`, `devDependencies` or `optionalDependencies`, any of the three. In a monorepo an undeclared one resolves anyway through the hoisted root `node_modules` and then stops resolving the moment the package is installed from npm, which is a declaration that is true in the tree and false everywhere else. `gjsify` conformance fails on it rather than letting it ship.

Plugins run in the order listed.

Under `--app gjs` the CLI bundles the plugin to one self-contained ESM file before importing it, because GJS's own ESM loader does not follow `package.json#exports` subpath maps. So the plugin's whole dependency tree has to load under GJS, not only its entry.

### Loading unusual file types

Rolldown does not classify unknown extensions, so without a loader it tries to parse them as JavaScript and fails. Map them yourself:

```jsonc
{
  "gjsify": {
    "loaders": {
      ".glsl": "text",
      ".ui":   "text",
      ".asm":  "text",
      ".png":  "dataurl"
    }
  }
}
```

| Kind | Output | Use it for |
|---|---|---|
| `text` | `export default "<file contents>"` | GLSL shaders, GtkBuilder `.ui` XML, assembly source. |
| `dataurl` | `export default "data:<mime>;base64,<b64>"` | Images for Excalibur's `ImageSource`, or any API taking a data URL. |

MIME types for `dataurl` are inferred from the extension: `.png`, `.jpg` / `.jpeg`, `.gif`, `.svg`, `.webp`, `.wasm`, and `application/octet-stream` for everything else.

### A shebang that outer build tools can fill in

`shebang` also accepts a string, with `${env:NAME}` and `${env:NAME:-default}` placeholders resolved against `process.env`. That is what you want when Meson or Flatpak exports the interpreter path:

```jsonc
{ "gjsify": { "shebang": "${env:GJS_CONSOLE:-/usr/bin/env -S gjs} -m" } }
```

A leading `#!` is added if you leave it out.

## Manage dependencies

### `gjsify install`

Install npm dependencies. A drop-in for `npm install` and `yarn install`. Its default backend resolves, downloads and unpacks the tree itself, so neither Node nor the npm CLI has to be on the machine.

```bash
gjsify install                  # full project install
gjsify install --immutable      # CI: install strictly from gjsify-lock.json
gjsify install lodash           # add lodash to dependencies
gjsify install -D vitest        # add to devDependencies
gjsify install -g @gjsify/cli   # global install under ~/.local/share/gjsify/global/
```

| Option | Default | Description |
|---|---|---|
| `[packages..]` | `[]` | Package specs. Omit for a full project install. |
| `-g`, `--global` | `false` | Install into `~/.local/share/gjsify/global/` and symlink bins into `~/.local/bin/`. |
| `-D`, `--save-dev` | `false` | Save to `devDependencies`. |
| `--save-peer` | `false` | Save to `peerDependencies`. |
| `-O`, `--save-optional` | `false` | Save to `optionalDependencies`. |
| `--immutable` | `false` | Install strictly from `gjsify-lock.json`, failing if it is missing or stale. Same idea as `yarn --immutable` or `npm ci`. |
| `--refresh-lockfile` | `false` | Re-resolve every dependency to the newest version its range allows and rewrite the lockfile. Without it, versions already pinned are preserved and only new or changed deps are resolved. |
| `--backend <native\|npm>` | `native` | `native` goes through `@gjsify/{semver,npm-registry,tar}`. `npm` shells out to `npm install` as an escape hatch for cases the native backend does not model yet, such as Yarn PnP repos and lifecycle scripts. Wins over `GJSIFY_INSTALL_BACKEND`. |
| `--progress` | `true` on a TTY | TTY-aware progress bar for resolve, download and extract. Off under `--verbose` or `--quiet`. |
| `--quiet` | `false` | Silence the progress bar. |
| `--verbose` | `false` | Per-package install log. |
| `--timeout <ms>` | `1800000` | Overall wall-clock budget. On timeout, in-flight registry fetches abort and the install exits non-zero. `0` disables it. |
| `--os <name>` | this host | Resolve and install for another OS (`darwin`, `win32`, `linux`). The lockfile stays platform independent either way. |
| `--cpu <arch>` | this host | Resolve and install for another CPU architecture (`x64`, `arm64`). |
| `--libc <glibc\|musl>` | probed | Resolve for another libc family. Only meaningful with `--os=linux`. |
| `--force` | `false` | Install a required dependency even when its `os` / `cpu` / `libc` excludes the target, instead of failing with `EBADPLATFORM`. Incompatible optional dependencies stay skipped. |
| `--prune` | `true` | Afterwards, remove packages an earlier install left behind that this host cannot use, see [`gjsify prune`](#gjsify-prune). `--no-prune` disables. Skipped under `--immutable`, and whenever `--os`/`--cpu`/`--libc` is given. |

The resolver follows npm v3 and later semantics, and honours npm-style `overrides` and yarn-style `resolutions` in `package.json`. The lockfile is `gjsify-lock.json`, a path-keyed `packages` map at `lockfileVersion` 4. There is more on how the tree is built in [How It Works](/gjsify/how-it-works/#how-gjsify-install-resolves-a-tree).

### `gjsify uninstall`

The inverse of `gjsify install -g`. Removes the package tree from `~/.local/share/gjsify/global/node_modules/<pkg>/` and any bin shims under `~/.local/bin/` pointing into it.

```bash
gjsify uninstall -g <pkg>
gjsify uninstall -g <pkg> --dry-run
gjsify uninstall -g <pkg1> <pkg2>
```

| Option | Default | Description |
|---|---|---|
| `<packages..>` | required | One or more package names, optionally with a version. |
| `-g`, `--global` | `false` | Required. Only global mode is supported today. |
| `--dry-run` | `false` | Print what would be removed and touch nothing. |
| `--verbose` | `false` | Verbose logging. |

It exits non-zero when nothing matched.

### `gjsify prune`

Remove installed packages this host cannot use: the ones an *earlier* install put there before the platform filter could skip them. See [ADR 0025](https://github.com/gjsify/gjsify/blob/main/docs/adr/0025-prune-the-install-prefix.md).

```bash
gjsify prune -g --dry-run       # what would go, and how much it frees
gjsify prune -g                 # remove it
gjsify prune                    # the same, for this project's node_modules
gjsify prune -g --os=darwin     # what a darwin host could not use
```

The decision is a **pure manifest read**: npm's own `os`, `cpu` and `libc`, through the same check the installer filters with, so a pruned prefix converges on what a fresh install would have placed. A package that declares **no** platform is never touched, however unusable it looks. Inferring that from a package *name* is how a prune starts deleting things it cannot justify.

`install` and `self-update` run the same pass automatically, and `--no-prune` opts out. That pass uses the **measured** host and refuses outright when `--os`, `--cpu` or `--libc` is given, so an install can never delete against a target you typed. On this command those flags are honoured, because asking is not a side effect.

| Option | Default | Description |
|---|---|---|
| `-g`, `--global` | `false` | Prune the user-global prefix instead of this project's `node_modules`. |
| `--dry-run` | `false` | Report what would be removed and touch nothing. |
| `--verbose` | `false` | List every package rather than the first few. |
| `--os <name>` / `--cpu <arch>` / `--libc <name>` | this host | Decide as if the host were this target. |

Removing nothing is a success, since this is idempotent housekeeping. It exits non-zero only when a removal you asked for failed. Sizes are **apparent**, summed from the files, so `du`, which counts allocated blocks, reports a slightly different number.

### `gjsify upgrade`

Check the registry for newer versions of your declared dependencies and update `package.json`. A drop-in for `yarn upgrade-interactive` and `npx npm-check-updates`, and workspace-aware: it walks every `package.json` in the monorepo, groups by dependency and flags inconsistencies.

```bash
gjsify upgrade                          # interactive: pick what to upgrade
gjsify upgrade --latest                 # bump everything, major bumps allowed
gjsify upgrade --minor                  # stay within the current major
gjsify upgrade --patch                  # patches only
gjsify upgrade --latest --dry-run       # print the plan, write nothing
gjsify upgrade --filter '@gjsify,vite'  # narrow by substring
gjsify upgrade --check                  # CI gate for inconsistent ranges
gjsify upgrade --align                  # fix them, offline
```

| Option | Default | Description |
|---|---|---|
| `--latest` | `false` | Non-interactive bulk update, major bumps allowed. |
| `--minor` | `false` | Non-interactive, semver-minor and patch only. |
| `--patch` | `false` | Non-interactive, semver-patch only. |
| `--filter <substring>` | none | Match against package names, case-insensitive. Repeatable, comma-separated values are split. |
| `-p`, `--workspace <pattern>` | all | Restrict to some workspaces. Matched against the package name and the directory path. Repeatable. |
| `--exclude-workspace <pattern>` | none | Skip workspaces, for ones with deliberate dependency drift such as integration tests pinned to a specific upstream. Repeatable. |
| `--align` | `false` | Offline consistency mode: find deps declared at several ranges and align them to the highest. No registry calls. |
| `--check` | `false` | CI gate: exit non-zero when any dep is declared inconsistently across workspaces. Offline. `--align` is the fix. |
| `--dry-run` | `false` | Print the plan without writing. |
| `-y`, `--yes` | `false` | In interactive mode, select everything without prompting. |
| `--cwd <path>` | `process.cwd()` | Project directory. From inside a workspace it walks up to the monorepo root. |
| `--verbose` | `false` | Print resolution details. |

`workspace:`, `file:`, `link:`, `git:`, `git+`, `http(s):`, `npm:`, `*` and `latest` ranges are skipped, since none of them is an external npm dependency. The range prefix is preserved: `^1.2.3` becomes `^2.0.0`, `~0.4.0` becomes `~0.5.0`. The registry URL comes from `~/.npmrc`, then `<cwd>/.npmrc`, with `npm_config_registry` overriding both, and scope-specific registries and auth tokens are honoured.

Output is a colour-coded table (red major, yellow minor, green patch, cyan prerelease). Run `gjsify install` afterwards to fetch the new versions.

`@gjsify/*` packages ship as one release train, so upgrade them together: `gjsify upgrade --latest --filter @gjsify`. See [Versioning & Compatibility](/gjsify/versioning/).

### `gjsify dlx`

Run the GJS bundle of a published package without adding it to your project, like `npx` or `yarn dlx`. It is strictly a GJS-bundle runner: it resolves the package's GJS entry and calls `gjs -m <bundle>`. A package with no GJS entry fails loudly.

```bash
gjsify dlx @gjsify/example-dom-canvas2d-fireworks
gjsify dlx @scope/pkg@1.2.3                    # version-pinned
gjsify dlx @scope/pkg my-bin -- --opt value    # pick a bin, forward args
gjsify dlx ./local/path                        # local dir, no install, no cache
```

| Option | Default | Description |
|---|---|---|
| `<spec>` | required | `name`, `name@version`, `@scope/name@spec`, or a local path. |
| `[binOrArg]` | none | A bin name when `gjsify.bin` has several entries. Otherwise the first argument forwarded to the bundle. To pass a flag here, use `--`: `gjsify dlx <pkg> -- --help`. |
| `[extraArgs..]` | `[]` | Extra args forwarded to `gjs -m <bundle>`. |
| `--cache-max-age <minutes>` | `10080` (7 days) | Cache TTL. `0` bypasses the cache. |
| `--reinstall` | `false` | Bypass the cache for this run. Same as `--cache-max-age=0`. |
| `--frozen` | `false` | Use the project-local `gjsify-lock.json` verbatim, failing if it is missing or stale. No resolver pass. |
| `--registry <url>` | from `.npmrc` | Registry override. |
| `--verbose` | `false` | Verbose logging. |

Downloads are cached under `$XDG_CACHE_HOME/gjsify/dlx/`, keyed by the package specs and registries, and swapped in atomically, so parallel runs of the same spec are safe.

#### How `dlx` finds the GJS entry

`dlx` reads a top-level `gjsify` object from the package's `package.json`:

```jsonc
{
  "name": "@gjsify/example-dom-canvas2d-fireworks",
  "main": "dist/node.js",        // optional Node entry
  "gjsify": {
    "main": "dist/gjs.js",       // the GJS entry dlx runs
    "bin": { "fireworks": "dist/gjs.js" },  // optional: several GJS entries
    "prebuilds": "prebuilds"
  }
}
```

It picks, in order: the bin you named in `gjsify.bin`, the only entry in `gjsify.bin`, `gjsify.main`, then `package.json#main` as a fallback (with a hint to add `gjsify.main`). If none of those exist it fails with a fix hint. A multi-bin package with no bin chosen tells you the names to pick from.

### `gjsify self-update`

Refresh the installed `@gjsify/cli` to the latest release, or to a pinned dist-tag.

```bash
gjsify self-update              # latest
gjsify self-update --check      # compare only, exit 1 if outdated
gjsify self-update --force      # reinstall the same version
gjsify self-update --tag next   # a specific dist-tag or version
```

| Option | Default | Description |
|---|---|---|
| `--check` | `false` | Compare current against target without installing. Exit 0 if up to date, 1 if outdated. |
| `--force` | `false` | Reinstall even when the target already matches. |
| `--tag <tag>` | `latest` | npm dist-tag or a pinned version. |
| `--skip-deps` | `false` | Update only the `@gjsify/cli` bundle, not its runtime dependencies (rolldown, lightningcss, `@gjsify/tsc`, the native `gi://` bridges). Faster, but it can leave those stale relative to the new bundle. |
| `--prune` | `true` | Afterwards, remove packages an earlier install left behind that this host cannot use, see [`gjsify prune`](#gjsify-prune). `--no-prune` disables. |

It reuses the same install backend as `gjsify install -g`, so transitive native prebuilds, the lockfile and bin shims are handled. It only works for CLIs installed under `~/.local/share/gjsify/global/`, which is where the `install.mjs` bootstrap and `gjsify install -g` put them. An `npm install -g` lands elsewhere, and `self-update` says so.

### `gjsify generate-installer`

Scaffold an `install.mjs` for your own GJS-runnable package, so your users get the same `curl … | gjs -m -` install story GJSify has.

```bash
cd my-gjs-app
gjsify generate-installer

gjsify generate-installer \
  --target @my-org/my-app \
  --bin-name my-app \
  --bootstrap-url https://example.com/cli.gjs.mjs \
  --output bin/install.mjs --force
```

| Option | Default | Description |
|---|---|---|
| `[target]` | `package.json#name` | The npm package the installer installs. |
| `--bin-name <name>` | first key of `gjsify.bin` or `bin` | Bin name the installer produces. |
| `--bootstrap-url <url>` | GJSify's `releases/latest/download/cli.gjs.mjs` | Where the bootstrap bundle comes from. |
| `--output <file>` | `install.mjs` | Where to write it. |
| `--force` | `false` | Overwrite an existing file. |

The generated file is a copy of GJSify's own `install.mjs` with three constants substituted. Commit it. The full publication workflow is in [Distributing GJS apps](/gjsify/guides/distributing-gjs-apps/).

## Work in a monorepo

### `gjsify foreach`

Run a script across all, or some, workspaces. A drop-in for `yarn workspaces foreach`.

```bash
gjsify foreach build                          # `build` everywhere
gjsify foreach -p -t build                    # parallel, topological order
gjsify foreach --no-private build             # skip private:true workspaces
gjsify foreach --include '@gjsify/web-*' test # glob filter
gjsify foreach --exec -- npm publish --tag latest
```

| Option | Default | Description |
|---|---|---|
| `[script]` | none | Script to run. With `--exec`, the command to run. |
| `[args..]` | `[]` | Extra arguments forwarded to each invocation. |
| `-A`, `--all` | `false` | Include workspaces marked `private: true`. |
| `-p`, `--parallel` | `false` | Run in parallel, capped by `--jobs`. |
| `-t`, `--topological` | `false` | Wait for each workspace's production dependencies to finish first. |
| `--topological-dev` | `false` | Like `--topological`, but also respects `devDependencies`. Often cyclic, so use it sparingly. |
| `--include <glob>` | all | Include workspaces matching the glob. Repeatable. A pattern that matches nothing is a hard error. |
| `--exclude <glob>` | none | Exclude workspaces matching the glob. Repeatable. |
| `-d`, `--with-dependencies` | `false` | Also select everything the filtered set depends on. `--include` only filters and `--topological` only orders, so neither can say "and the packages these need". Excludes are re-applied afterwards. |
| `--private` | `true` | Include private workspaces. `--no-private` skips them. |
| `-j`, `--jobs <n>` | cpu count | Max concurrent workspaces in `--parallel` mode. |
| `--exec` | `false` | Treat `<script> [args..]` as an arbitrary command. Use `-- <cmd>` so flags reach the command. |
| `--cached` | `GJSIFY_BUILD_CACHE=1` | Content-hash build cache. See [Build cache](#build-cache). Script mode only. |
| `--shard <index>/<total>` | none | Run one deterministic slice of the matched workspaces, for example `--shard 2/4`, to fan a long run across parallel CI jobs. Partitioned by sorted name, so shards are disjoint and their union is the full set. Order-independent, so fine for tests and wrong for ordered builds. |
| `-v`, `--verbose` | `false` | Echo every spawned command. |

### `gjsify workspace`

Run one script in one workspace. A drop-in for `yarn workspace <name> run <script>`.

```bash
gjsify workspace @gjsify/cli build
gjsify workspace @gjsify/fetch test:gjs
gjsify workspace @gjsify/website build -d      # build its deps first
```

| Argument | Description |
|---|---|
| `<name>` | Workspace name, matching `package.json#name`. |
| `<script>` | Script to run. The yarn spelling `workspace <name> run <script>` also works. |
| `[args..]` | Extra arguments forwarded to the script. |

| Option | Default | Description |
|---|---|---|
| `-d`, `-t`, `--with-dependencies`, `--topological` | `false` | Build the workspace's transitive workspace dependencies in topological order first. Deps without the script are skipped. |
| `--include-dev` | `false` | With `-d`, also walk `devDependencies`. |
| `--continue-on-error` | `false` | With `-d`, keep going after a dependency fails. |
| `--cached` | `GJSIFY_BUILD_CACHE=1` | Content-hash build cache. See [Build cache](#build-cache). Also applies to the deps run by `-d`. |
| `-v`, `--verbose` | `false` | Echo every spawned command. |

### Build cache

With `--cached` (or `GJSIFY_BUILD_CACHE=1`; an explicit `--no-cached` wins), `gjsify foreach <script>` and `gjsify workspace <name> <script>` skip workspaces whose inputs are unchanged and restore the stored outputs instead of re-running the script.

```bash
gjsify foreach build -tp --cached          # rebuild only what changed
GJSIFY_BUILD_CACHE=1 gjsify run build      # opt a whole script chain in
```

The cache key is a sha256 over the script name and its arguments, a toolchain salt (the resolved `@gjsify/cli`, `@gjsify/tsc`, `rolldown` and `typescript` versions), the package's own inputs (`src/**`, `package.json`, root `tsconfig*.json`, hashed by content) and the same for its full transitive workspace-dependency closure. Editing a dependency therefore re-runs every dependent.

Entries live in `node_modules/.cache/gjsify/build/<pkg>/<key>/`, at most two keys per package, oldest evicted. Only the conventional output directories (`lib/`, `dist/`, `dist-templates/`) that the script actually modified are stored, and a cache hit replaces exactly those. A package that does not define the script is never written to. It is script mode only, `--exec` is rejected, and any cache error falls back to running the script uncached.

### `gjsify affected`

Print the workspaces a change touches, so CI can test those and skip the rest.

```bash
gjsify affected                                   # text list
gjsify affected --format globs                    # feed into --include
gjsify affected --base "$BASE_SHA" --format github-actions
gjsify foreach test --include $(gjsify affected --format globs)
```

| Option | Default | Description |
|---|---|---|
| `--base <ref>` | `origin/main` | Diff base, resolved with `git rev-parse`. On a pull request, use the base SHA. |
| `--head <ref>` | `HEAD` | Diff head. |
| `--format <shape>` | `text` | `text`, `json`, `globs` or `github-actions`. |
| `--changed-from-stdin` | `false` | Skip `git diff` and read a newline-separated list of repo-relative paths from stdin. |
| `--cwd <path>` | discovered | Workspace root. |

The output is the seed workspaces plus everything that transitively depends on them.

## Check and fix code

### `gjsify check`

Run TypeScript type checks across the workspace. The peer of `format`, `lint` and `fix`.

```bash
gjsify check                              # workspace-wide, parallel
gjsify check --include '@gjsify/process'  # one package
gjsify check --no-parallel --verbose      # sequential, full output
```

| Option | Default | Description |
|---|---|---|
| `--include <glob>` | all | Only run in workspaces matching these globs. Repeatable. |
| `--exclude <glob>` | none | Skip workspaces matching these globs. Repeatable. `@girs/*` is always excluded. |
| `-p`, `--parallel` | `true` | Run checks in parallel. `--no-parallel` for sequential. |
| `-j`, `--jobs <n>` | `os.cpus().length` | Max workers when parallel. |
| `--verbose` | `false` | Log each per-workspace command before spawning. |

In a workspace root it walks every package that defines a `check` script and runs `npm run check` in each. Inside a single package it runs that package's `check` script directly. Exit code is 1 if any check fails. With `--no-parallel` you get the first non-zero code; in parallel mode you get a summary of the failures.

### `gjsify tsc`

Run the TypeScript compiler, with every argument passed straight through. Same job as `npx tsc`.

```bash
gjsify tsc --noEmit
gjsify tsc -p tsconfig.build.json
```

Two engines back it, picked by what is on the machine: the `@gjsify/tsc` bundle spawned as `gjs -m <bundle>` when that bundle resolves and `gjs` is on `PATH`, otherwise upstream npm `typescript` spawned on Node. If neither is there it says so and exits 1, naming both fixes. It is the same thing as the `gjsify-tsc` bin from `@gjsify/tsc`. Most templates wire it into their `check` script.

### `gjsify format`

Format JS and TS through [oxfmt](https://oxc.rs/docs/guide/usage/formatter).

```bash
gjsify format --init             # write recommended .oxlintrc.json + .oxfmtrc.json
gjsify format src/               # format in place, the default
gjsify format --check src/       # CI: exit non-zero on drift, write nothing
gjsify format --no-write src/    # report drift locally without writing
```

| Option | Default | Description |
|---|---|---|
| `[paths..]` | `.` | Files or directories to format. |
| `--write` | `true` | Apply changes in place. `--no-write` reports drift instead. |
| `--check` | `false` | CI mode: report drift and stats, exit non-zero, write nothing. |
| `--config-path <path>` | nearest one | Path to an `.oxfmtrc.json`. By default it walks up from the cwd. |
| `--init` | `false` | Write recommended `.oxlintrc.json` and `.oxfmtrc.json` into the cwd, skipping existing files unless `--force`. |
| `--force` | `false` | With `--init`, overwrite the existing config files. |
| `--verbose` | `false` | Echo the resolved oxfmt launcher and args before spawning. |

A bare `gjsify format` writes. There is no flagless report mode: `--check` is the read-only CI mode and `--no-write` the read-only local one.

Under GJS, formatting runs in-process through the `@gjsify/oxfmt-native` bridge. Everywhere else the `oxfmt` npm launcher is resolved from `node_modules` and spawned with `node`. Set `GJSIFY_OXFMT=npm` to force the launcher, or `GJSIFY_OXFMT=native` to fail instead of falling back when the prebuild is missing. From inside a sub-workspace, resolution walks up to the workspace root, so a single `.oxfmtrc.json` there applies everywhere.

oxfmt itself formats more than JS and TS — JSON, CSS and TOML among them — but the `.oxfmtrc.json` that `--init` writes ignores every one of those, so a GJSify project formats JS and TS only. Drop a pattern from `ignorePatterns` to widen it.

If oxfmt is missing you get `[gjsify oxc] oxfmt not found.` with `gjsify install -D oxfmt` as the hint, and exit 1.

#### What `--init` writes

`.oxfmtrc.json`: 4-space indent, single quotes, semicolons, trailing commas everywhere, arrow parens always, print width 120, bracket spacing on. This matches the GJSify codebase and the GNOME Shell style guide. Generated artifacts are excluded (`dist`, `lib`, `cli.gjs.mjs`, `test.{gjs,node}.mjs`), along with Flatpak build directories, `refs/`, prebuilds and compiled `.metainfo.xml`.

`.oxlintrc.json`: oxlint's `correctness` category as errors, plus `typescript/no-non-null-assertion` off (the `!` operator is needed on `@girs/*` surfaces), `typescript/no-explicit-any` and `typescript/consistent-type-imports` as warnings, `unicorn/prefer-node-protocol` as an error, and `eslint/no-unused-vars` as a warning. Same excludes as the formatter.

### `gjsify lint`

Run [oxlint](https://oxc.rs/docs/guide/usage/linter) diagnostics.

```bash
gjsify lint              # everything
gjsify lint src/         # specific paths
gjsify lint --fix        # apply safe fixes
```

| Option | Default | Description |
|---|---|---|
| `[paths..]` | `.` | Files or directories to lint. |
| `--fix` | `false` | Apply safe lint fixes in place. |
| `--config-path <path>` | nearest one | `.oxlintrc.json` override. |
| `--verbose` | `false` | Echo the resolved oxlint launcher and args. |

oxlint is spawned through its Node launcher so its JavaScript plugin host is available. That host is what runs GJSify's own plugin, `@gjsify/oxlint-plugin-gjsify`, wired in through `jsPlugins` in the workspace `.oxlintrc.json`. Its one rule, `gjsify/register-class-order`, catches static GObject metadata (`GTypeName`, `Properties`, `Signals`, `InternalChildren`, `Template`, `CssName` and their siblings) declared after a `static { GObject.registerClass(…) }` block, where `registerClass` runs before the field is assigned and the metadata is silently ignored, and autofixes it by hoisting the fields above the static block. Name the rule when you need to configure or silence it. [GObject classes](/gjsify/patterns/gobject-classes/) explains the trap and the forms that avoid it.

Use [`gjsify fix`](#gjsify-fix) for format plus safe lint fixes in one pass.

### `gjsify fix`

`oxfmt --write` followed by `oxlint --fix`.

```bash
gjsify fix               # format, then apply safe lint fixes
gjsify fix --no-write    # report only
```

| Option | Default | Description |
|---|---|---|
| `[paths..]` | `.` | Files or directories to process. |
| `--write` | `true` | Apply fixes. `--no-write` reports only. |
| `--config-path <path>` | nearest one | `.oxlintrc.json` / `.oxfmtrc.json` override. |
| `--verbose` | `false` | Echo the resolved oxc launchers and args. |

Not to be confused with [`gjsify check`](#gjsify-check) (TypeScript) or [`gjsify system-check`](#gjsify-system-check) (system libraries).

### `gjsify barrels`

Regenerate `index.ts` barrel files. A drop-in for `barrelsby`.

```bash
gjsify barrels src/widgets src/utils
gjsify barrels src --check          # CI: fail when a barrel is stale
```

| Option | Default | Description |
|---|---|---|
| `[paths..]` | `[]` | Directories to regenerate. |
| `--ext <js\|ts\|none>` | `none` | Extension on the import specifiers. `none` is bundler-mode resolution. |
| `-b`, `--base-dir <dir>` | cwd | Resolve `paths` against this directory. |
| `--exclude <regex>` | `\.test\.`, `\.spec\.`, `\.test-data\.` | File names to skip. Repeatable. |
| `--header <text>` | none | Header comment prepended to every generated file. |
| `--semicolon` | `false` | Emit a trailing `;` on each export line. |
| `--single-quotes` | `true` | Use `'` for import specifiers. `--no-single-quotes` for `"`. |
| `--check` | `false` | Report drift without writing, exit non-zero if any barrel is stale. |
| `--verbose` | `false` | Log each file scanned and written. |

### `gjsify system-check`

Verify that the system libraries a GJSify project needs are installed.

```bash
gjsify system-check
gjsify system-check --json
```

| Option | Default | Description |
|---|---|---|
| `--json` | `false` | Emit the results as JSON. |

It reports an install command for your detected package manager when something is missing, and exits 1 if any required dependency is absent. The required set is fixed rather than read off your project: the GNOME stack a GTK app links against, plus the `gjs` binary. Only the optional rows follow your dependencies. So a `--app node` project that reaches GTK through `@gjsify/node-gi` is still told to install `gjs`, even though it never runs it.

This used to be called `gjsify check`. The bare name now runs the TypeScript checks described above.

<details>
<summary>What it checks</summary>

**Required.** Always checked, and a miss is fatal: `gjs`, `pkg-config`, `meson`, plus `gtk4`, `libadwaita-1`, `libsoup-3.0` and `gobject-introspection-1.0`. On Windows the Microsoft Visual C++ runtime is checked too, because the GTK bundle's DLLs will not load without it.

**Node.js** is reported but never required. The `install.mjs` bootstrap is run by `gjs`, so "not installed" is a legitimate answer here.

**Build toolchain, optional.** `blueprint-compiler` for `.blp` templates — resolved the same way the build resolves it, so a project with no `.blp` never needs it and a Windows host keeping it off `PATH` under MSYS2 is not a miss. `ninja` and `vala` for the Vala bridges, `cargo` for the three Rust-backed engines (`@gjsify/rolldown-native`, `@gjsify/lightningcss-native`, `@gjsify/oxfmt-native`). You only need these if you rebuild a prebuild from source.

**Library dependencies, optional.** Checked only when the matching `@gjsify/*` package is in your project:

| System dependency | Needed by |
|---|---|
| `manette-0.2` | `@gjsify/gamepad` |
| `gstreamer-1.0`, `gstreamer-app-1.0` | `@gjsify/webaudio` |
| `gstreamer-1.0`, `gstreamer-webrtc-1.0` | `@gjsify/webrtc-native` |
| `webkitgtk-6.0` | `@gjsify/iframe` |
| `gdk-pixbuf-2.0` | `@gjsify/dom-elements`, `@gjsify/canvas2d`, `@gjsify/canvas2d-core`, `@gjsify/webgl` |
| `pango`, `pangocairo`, `cairo` | `@gjsify/canvas2d`, `@gjsify/canvas2d-core` |
| `epoxy`, plus the `gwebgl` npm package | `@gjsify/webgl` |
| `json-glib-1.0` | `@gjsify/rolldown-native` |
| `gnutls` | `@gjsify/tls-native` |
| `libnghttp2` | `@gjsify/http2-native` |

</details>

<details>
<summary>JSON output</summary>

```bash
gjsify system-check --json
```

```json
{
  "packageManager": "dnf",
  "deps": [
    {
      "id": "gjs",
      "name": "GJS",
      "found": true,
      "version": "1.88.1",
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

### `gjsify info`

List the native GJSify packages in `node_modules` and print the environment `gjs` needs to load their prebuilds.

```bash
gjsify info dist/index.js
eval $(gjsify info --export)
```

| Argument / Option | Description |
|---|---|
| `[file]` | Bundle path to use in the generated example command. |
| `--export` | Emit only shell `export` statements, ready for `eval`. |

You get `GI_TYPELIB_PATH` plus whichever library-search variable this host's loader reads: `LD_LIBRARY_PATH` on Linux, `DYLD_LIBRARY_PATH` on macOS, `PATH` on Windows. Only the variables that apply here are emitted.

## Build GNOME assets

### `gjsify gresource`

Compile a GResource XML descriptor into a binary `.gresource` bundle, so UI templates and assets ride along with your app without pulling in meson. It wraps `glib-compile-resources`.

```bash
gjsify gresource data/org.example.App.data.gresource.xml \
  --sourcedir data \
  --target dist/org.example.App.data.gresource
```

| Option | Default | Description |
|---|---|---|
| `<xml>` | required | Path to the `.gresource.xml` descriptor. |
| `--sourcedir <dir>` | the descriptor's directory | Where the referenced resource files live. |
| `-t`, `--target <file>` | `<xml>` without `.xml`, next to it | Output `.gresource` file. |
| `--verbose` | `false` | Print the underlying `glib-compile-resources` call. |

Needs `glib-compile-resources` (`glib2-devel` on Fedora, `libglib2.0-dev-bin` on Debian and Ubuntu).

### `gjsify gsettings`

Compile GSettings schemas (`*.gschema.xml`) into a binary `gschemas.compiled`. It wraps `glib-compile-schemas`.

```bash
gjsify gsettings data/schemas
gjsify gsettings data/schemas --targetdir dist/schemas
```

| Option | Default | Description |
|---|---|---|
| `<schemadir>` | required | Directory holding the `*.gschema.xml` files. |
| `-t`, `--targetdir <dir>` | `<schemadir>` | Where to write `gschemas.compiled`. |
| `--strict` | `true` | Abort on any schema warning. `--no-strict` to relax. |
| `--verbose` | `false` | Print the underlying `glib-compile-schemas` call. |

Needs `glib-compile-schemas` (`glib2-devel` on Fedora, `libglib2.0-dev-bin` on Debian and Ubuntu).

### `gjsify gettext`

Compile gettext `.po` files. It wraps `msgfmt` with the output shapes GNOME apps need: a per-language `.mo` locale tree, and metainfo template substitution.

```bash
# Runtime .mo locale tree
gjsify gettext translations dist/locale --domain org.example.App

# Substitute a metainfo template
gjsify gettext translations dist/metainfo \
  --domain org.example.App \
  --format xml \
  --metainfo data/metainfo/org.example.App.metainfo.xml.in
```

| Option | Default | Description |
|---|---|---|
| `<poDir>` | required | Directory holding `<lang>.po` files. |
| `<outDir>` | required | Output directory. A locale tree for `--format mo`, a plain directory otherwise. |
| `--domain <id>` | required | Text domain or application id. |
| `--format <kind>` | `mo` | `mo`, `xml`, `desktop` or `json`. |
| `--metainfo <path>` | none | For `--format xml`, the `.metainfo.xml.in` template used as `msgfmt --template`. |
| `--filename <name>` | `<domain>.<ext>` | Override the output filename. |
| `--remove-xml-comments` | `true` | For `--format xml`, strip XML comments from the output. |
| `--verbose` | `false` | Print each `msgfmt` call. |

Needs `msgfmt` (the `gettext` package).

## Explore

### `gjsify showcase`

List or run the curated showcase applications.

```bash
gjsify showcase                           # list them
gjsify showcase three-geometry-teapot     # run one
gjsify showcase --json                    # machine-readable list
```

| Option | Default | Description |
|---|---|---|
| `[name]` | none | Showcase to run. Omit to list. |
| `--list` | `false` | Force list mode. |
| `--json` | `false` | Output JSON. List mode only. |
| `--runtime <gjs\|node\|bun\|deno>` | `gjs` when gjs is installed, else the host runtime | Which runtime to run the showcase on. |

Before launching a showcase on `gjs`, it verifies the required system libraries are installed and prints the install command for your package manager when any are missing. That check is skipped for `node`, `bun` and `deno`, which never touch the GJS bundle.

#### Run a showcase on Node, Bun or Deno

The default is `gjs` whenever a `gjs` binary is available, because a showcase's canonical artifact is its `--app gjs` bundle. Only on a host without gjs does the default follow the host runtime.

`node`, `bun` and `deno` resolve the showcase's `--app node` bundle and run it there. The runtime is validated against the showcase's [`gjsify.example.runtimes`](#per-example-runtime-declaration) declaration, so a showcase that does not declare the runtime you asked for fails with a clear message rather than crashing. Most do ship one: the Adwaita storybook, the Express server and the Canvas 2D, three.js and Excalibur showcases all declare `gjs`, `node`, `bun` and `deno`.

```bash
gjsify showcase express-webserver                  # gjs
gjsify showcase express-webserver --runtime node   # the --app node bundle, on Node.js
gjsify showcase express-webserver --runtime bun    # same bundle, on Bun
gjsify showcase express-webserver --runtime deno   # same bundle, on Deno
```

#### Per-example runtime declaration

An example or showcase can declare which runtimes it supports, so `--runtime` validates the request up front:

```jsonc
// package.json
"gjsify": {
  "example": {
    "runtimes": ["gjs", "node", "bun", "deno"], // optional; omit to allow any
    "node": "dist/app.node.mjs"                 // optional; otherwise derived
  }
}
```

Leaving `runtimes` out is permissive. The showcases built on `@gjsify/iframe` (WebKit) and `@gjsify/webrtc` (GStreamer WebRTC) declare `["gjs"]`, so `--runtime node` errors cleanly. When `node` is omitted, the node bundle is derived from the GJS entry by convention: `dist/<name>.gjs.js` becomes `dist/<name>.node.mjs`.

## Debug a running app

### `gjsify storybook`

Discover every `*.story.ts` in your project and launch the GTK and Adwaita component browser from [`@gjsify/storybook`](https://www.npmjs.com/package/@gjsify/storybook): a sidebar grouped by category, a live preview, and a generated controls panel. There is no per-project storybook application to maintain.

```bash
gjsify storybook                       # discover src/**/*.story.ts and launch
gjsify storybook --stories packages    # scan somewhere else
gjsify storybook --watch               # rebuild and relaunch on change
```

| Option | Default | Description |
|---|---|---|
| `--stories <dir>` | `src`, or `gjsify.storybook.stories` | Directory scanned recursively for `*.story.ts`. |
| `--app-id <id>` | `gjsify.storybook.applicationId`, else derived from the package name | GApplication id. |
| `--title <text>` | none | Window title. |
| `--globals <value>` | `auto` | Value for `gjsify build --globals`. Use `auto,dom` for canvas or DOM stories. |
| `--runtime <gjs\|node\|bun\|deno>` | the host runtime | Runtime to build for and launch on. `node`, `bun` and `deno` build the same `--app node` bundle and need `@gjsify/node-gi` installed in the project. |
| `--out <path>` | `node_modules/.cache/gjsify-storybook` | Output bundle path. |
| `--watch` | `false` | Rebuild and relaunch when a story file changes. |
| `--build-only` | `false` | Build the bundle without launching it. |

Set defaults under `package.json#gjsify.storybook` (`applicationId`, `title`, `stories`, `globals`, `runtime`). Runtime precedence is the flag, then the config value, then the host default.

With `GJSIFY_DEVTOOLS=1` the storybook host also exposes the devtools control plane on any of the four runtimes, so an agent can drive it with `gjsify debug --profile storybook`. See the [Debugging and remote control guide](/gjsify/guides/devtools/).

### `gjsify debug`

Launch an MCP bridge for a running, devtools-enabled GJSify app, talking to its `org.gjsify.Devtools` D-Bus control plane. An MCP client uses this as its server command: the bridge speaks JSON-RPC on stdio and translates each tool call to D-Bus. It comes from [`@gjsify/devtools-mcp`](https://www.npmjs.com/package/@gjsify/devtools-mcp).

```bash
# In .mcp.json:
#   { "mcpServers": { "my-app": { "command": "gjsify", "args": ["debug", "--bus-name", "org.example.App"] } } }

gjsify debug --bus-name org.example.App               # generic profile
gjsify debug --profile storybook                      # storybook tools
gjsify debug --build-only --out dist/bridge.gjs.mjs   # build once, point .mcp.json at the bundle
```

| Option | Default | Description |
|---|---|---|
| `--bus-name <name>` | `gjsify.devtools.busNameBase`, else the storybook or browser app id | The app's D-Bus base name. |
| `--address <addr>` | `GJSIFY_DEVTOOLS_ADDRESS`, then the address file the app publishes, then the session bus | Peer D-Bus address (`unix:path=…`, `nonce-tcp:…`) instead of the session bus. This is how you reach an app on macOS or Windows, which have no session bus. |
| `--profile <kind>` | auto | `generic`, `storybook`, `browser` or `cdp`. Auto picks `storybook` when `@gjsify/storybook` is a dependency, `browser` for `@gjsify/devtools-browser`, `cdp` for `@gjsify/devtools-cdp`, otherwise `generic`. |
| `--globals <value>` | `auto` | Value for `gjsify build --globals`. |
| `--out <path>` | `node_modules/.cache/gjsify-debug` | Output bundle path. |
| `--build-only` | `false` | Build the bridge bundle without launching it. |

`gjsify debug` logs to stderr only, because stdout is the JSON-RPC channel. The bridge resolves `@gjsify/devtools-mcp` from your project's `node_modules`. There is no `--runtime` here: the bridge bundle is always built `--app gjs` and launched with `gjs`, whichever runtime the CLI itself is on. The app it talks to can be on any of the four, since the two only ever meet over D-Bus. Full workflow: [Debugging and remote control](/gjsify/guides/devtools/).

### `gjsify browse`

Launch the minimal Adwaita web browser from [`@gjsify/devtools-browser`](https://www.npmjs.com/package/@gjsify/devtools-browser), optionally at a URL. With `--devtools` it exposes the same `org.gjsify.Devtools` control plane, so an agent can navigate, screenshot the rendered page, evaluate JS, inspect elements and read the DOM, network and accessibility trees over MCP. It is built for debugging web apps you built with gjsify.

```bash
gjsify browse                                     # open page:welcome
gjsify browse https://gnome.org                   # open a URL
gjsify browse https://localhost:8080 --devtools   # plus the MCP control plane
gjsify browse https://localhost:8080 --screenshot shot.png
```

| Option | Default | Description |
|---|---|---|
| `[url]` | `page:welcome` | Initial URL: a `page:*` built-in page or an `https://` address. |
| `--app-id <id>` | `gjsify.browse.applicationId`, else derived from the package name | GApplication id. |
| `--title <text>` | none | Window title. |
| `--globals <value>` | `auto,dom` | Value for `gjsify build --globals`. WebKit and the iframe need DOM globals. |
| `--out <path>` | `node_modules/.cache/gjsify-browse` | Output bundle path. |
| `--devtools` | `false` | Enable the MCP devtools control plane (sets `GJSIFY_DEVTOOLS=1`). |
| `--inspector-port <n>` | none | Enable WebKit's remote inspector protocol on this port plus the `Cdp*` methods. Implies `--devtools`. |
| `--screenshot <path>` | none | One-shot: load the URL, capture a WebKit screenshot to this path, exit. Handy in CI. |
| `--build-only` | `false` | Build the bundle without launching it. |

The browser is built on [`@gjsify/iframe`](https://www.npmjs.com/package/@gjsify/iframe), a `WebKit.WebView` postMessage bridge, and it is always built `--app gjs` and launched with `gjs`, whichever runtime the CLI itself is on. With `--inspector-port` it also sets `WEBKIT_INSPECTOR_HTTP_SERVER` and exposes the [`@gjsify/devtools-cdp`](https://www.npmjs.com/package/@gjsify/devtools-cdp) methods (`CdpDiscoverTargets`, `CdpConnect`, `CdpSend`, `CdpDrainEvents`) over the control plane, which is the deep Runtime, DOM, CSS, Network, Console and Debugger protocol. Drive it with `gjsify debug --profile browser`, described in the [Debugging and remote control guide](/gjsify/guides/devtools/).

## Ship it

### `gjsify ship`

Turn a built application into something a stranger can install. The payload is staged once, then wrapped per format.

```bash
gjsify ship                     # build the project, then a .deb and an .rpm
gjsify ship --skip-build        # package what is already built
gjsify ship --target deb        # one format
gjsify ship --target flatpak    # a single-file Flatpak bundle (needs flatpak-builder)
gjsify ship --stage             # produce the payload and stop
gjsify ship --arch arm64        # package for another architecture
```

| Option | Default | Description |
|---|---|---|
| `--target <fmt..>` | `gjsify.ship.targets`, else `deb,rpm` | Formats to build. Comma-separated or repeated. `flatpak` is available and opt-in — it is the one format that needs tooling on the packing host. |
| `--out <dir>` | `gjsify.ship.outDir`, else `ship` | Output root, relative to the project. |
| `--stage` | `false` | Produce the staged payload and stop, packing nothing. |
| `--skip-build` | `false` | Do not run the project's `build` script first. |
| `--arch <arch>` | this host | Target architecture, in `process.arch` spelling. |
| `--verbose` | `false` | Print every staged file and the GI namespaces the bundle imports. |

What lands under `ship/`:

```
ship/stage/            the prefix-relative payload: bin/, lib/<name>/, share/
ship/overlay/<format>/ per-format additions, such as the licence where each format wants it
ship/flatpak/          --target flatpak only: the generated manifest, the build dir, the export repo
ship/out/              the artifacts
```

`ship/out/` is packed by reading `ship/stage/` back, so what you inspect is what ships, and both artifacts carry the identical payload.

#### What it works out for you

- **Runtime dependencies** come from the `gi://` imports in your built bundle, mapped to the package that ships each typelib (`gir1.2-gtk-4.0` on Debian, `gtk4` on Fedora). A namespace the table does not know fails the build and names itself, because an undeclared runtime dependency otherwise fails on a user's machine after the download. Fill the gap with `gjsify.ship.typelibPackages`.
- **Architecture** is `all` or `noarch` unless the payload contains a `.so` or `.node`. A pure-JS GJS app really does install everywhere, and claiming `amd64` would make apt refuse it on a machine it runs on.
- **The launcher** works out its own prefix at runtime, so one payload works under `/usr`, under `/app`, or anywhere else. That is the entire difference between the `.rpm` and the Flatpak: the Flatpak module is `buildsystem: simple` plus `cp -a stage/. /app/`, with no meson and no build system inside the sandbox.
- **`Section:` and `Group:`** follow from `categories`, and the version is normalised so a prerelease (`1.2.0-rc.1`) still sorts before the release in both package managers (`1.2.0~rc.1`).
- **Metadata** falls back to `gjsify.flatpak`, so a project that already ships a Flatpak usually needs no `gjsify.ship` block at all.

No runtime is bundled on Linux: GJS and GTK come from the distribution, so the package depends on `gjs` instead of carrying around 100 MiB of it. Packing the same build twice gives byte-identical files, which is explained in [How It Works](/gjsify/how-it-works/#reproducible-ship-artifacts).

#### Configure it

```jsonc
"gjsify": {
  "ship": {
    "appId": "io.github.you.MyApp",        // else gjsify.flatpak.appId, else package.json#name
    "binaryName": "my-app",                // else the package name, scope stripped
    "bundle": "dist/index.gjs.js",         // else gjsify.main, else package.json#main
    "icon": "data/icons",                  // a file or a directory
    "schemas": "data",                     // *.gschema.xml, named after the app id
    "depends": { "rpm": ["dconf"] },       // appended to the derived set
    "typelibPackages": {                   // fill a gap in the built-in table
      "Nautilus-3.0": { "deb": "gir1.2-nautilus-3.0", "rpm": "nautilus" }
    }
  }
}
```

| Key | Default | What it does |
|---|---|---|
| `appId` | `gjsify.flatpak.appId`, else `package.json#name` | Reverse-DNS id. Names the desktop entry, the AppStream component and the installed icon, so it cannot be guessed. |
| `binaryName` | package name, scope stripped and lowercased | Package name and the `bin/` entry. |
| `version` | `package.json#version` | Upstream version, normalised. |
| `release` | `1` | Package revision within one upstream version. |
| `maintainer` | `package.json#author` | `Maintainer:` and `Packager:`, as `Name <email>`. dpkg refuses a package without one. |
| `targets` | `["deb", "rpm"]` | Formats built when `--target` is not given. `flatpak` is deliberately not in the default: it needs `flatpak-builder`. |
| `outDir` | `ship` | Output root. |
| `bundle` | `gjsify.main`, else `package.json#main` | The built bundle `bin/<name>` executes. Its whole directory is staged into `lib/<name>/`. |
| `icon` | `data/icons` or `data/icons/hicolor` | Icon file or directory. Sizes are read from the path or the filename. |
| `schemas` | `data` | A `*.gschema.xml` file or a directory of them. |
| `licenseFile` | first of `LICENSE`, `LICENSE.md`, `LICENSE.txt`, `COPYING` | Licence file to ship. |
| `section` / `group` | derived from `categories` | deb `Section:` and rpm `Group:`. |
| `minGjsVersion` | `1.86` | Minimum GJS the emitted dependency asks for. |
| `depends` | `{}` | Extra runtime dependencies per format, appended to the derived set. For things that are not typelibs. |
| `typelibPackages` | `{}` | GI namespace to the package shipping its typelib. This is what unblocks an unknown namespace. |
| `extraFiles` | `{}` | Extra payload entries: prefix-relative destination to project-relative source. |
| `execArgs` | `[]` | Arguments the launcher appends before the user's own. |
| `flatpak` | derived | The Flatpak half: `runtime` (`gnome`/`freedesktop`), `runtimeVersion`, `branch` (`stable`), `sdkExtensions`, `appendPath`, `finishArgs`, `cleanup`. |

Metadata keys (`name`, `summary`, `description`, `developer`, `license`, `categories`, `keywords`, `homepageUrl`, `screenshots`, and the rest) are shared with `gjsify.flatpak` and listed under [`flatpak init`](#gjsify-flatpak-init).

#### The GJS floor on Debian

The emitted dependency is `gjs (>= 1.86)`, which is what the bundler targets. No released Debian satisfies it: Debian went from 1.82.3 (trixie) straight to 1.88.1 (forky). `gjsify ship` tells you rather than lowering the floor quietly, because a `.deb` that apt refuses beats one that installs and then dies on a syntax error. Set `gjsify.ship.minGjsVersion` if your bundle genuinely runs on an older GJS.

#### Where each format can be packed

Declared per format, and checked before your `build` script runs rather than after it.

| Format | Packed by | Runs on | Read back with |
|---|---|---|---|
| `deb` | `ship` itself — no `dpkg-deb` | any host, offline | GNU `ar` + `tar`, `dpkg-deb`, `lintian` |
| `rpm` | `ship` itself — no `rpmbuild` | any host, offline | `rpm` |
| `flatpak` | `flatpak-builder` + `flatpak build-bundle` | Linux, tools installed | `flatpak build-import-bundle` + `ostree` |

Ask for a format this host cannot finish and you get a refusal naming the two-phase way across, never a broken file:

```bash
gjsify ship --stage --target flatpak                          # here, any OS, offline
gjsify ship --from-stage ./ship/stage --target flatpak        # there, on Linux
```

A missing tool is a separate message from the wrong OS, because the fixes differ.

The six Flatpak build keys also resolve from a legacy `gjsify.flatpak` block, with one warning line naming what was inherited; they are removed from there in 1.0.0. `gjsify flatpak init` and `flatpak ci` read both spellings too, so moving them does not change the manifest those commands write. The app metadata in `gjsify.flatpak` is shared by design and is not deprecated.

#### Scope today

Linux and `--app gjs`. A project declaring any other `gjsify.app` is refused, because the launcher runs `gjs -m <bundle>`. macOS and Windows artifacts are later stages.

### `gjsify flatpak`

The Flatpak toolchain, for shipping GJS apps and CLIs to Flathub.

| Subcommand | What it does |
|---|---|
| [`flatpak init`](#gjsify-flatpak-init) | Scaffold the Flathub asset set: manifest JSON, MetaInfo XML, `.desktop` (apps only), `flathub.json`. |
| [`flatpak check`](#gjsify-flatpak-check) | Run `appstreamcli validate --strict` and `flatpak-builder-lint` locally. |
| [`flatpak build`](#gjsify-flatpak-build) | Wrap `flatpak-builder` with sensible defaults. |
| [`flatpak deps`](#gjsify-flatpak-deps) | Wrap `flatpak-node-generator` to produce the offline npm cache. |
| [`flatpak sources`](#gjsify-flatpak-sources) | Generate an offline `sources` array from any lockfile. |
| [`flatpak ci`](#gjsify-flatpak-ci) | Scaffold `.github/workflows/flatpak.yml`. |
| [`flatpak sync-flathub`](#gjsify-flatpak-sync-flathub) | Point the Flathub tracking-repo manifest at a new tag and commit. |
| [`flatpak diff`](#gjsify-flatpak-diff) | Compare local git state against that manifest and report drift. |
| [`flatpak release`](#gjsify-flatpak-release) | Chain init, check, tag and sync-flathub. |

End-to-end guides: [Ship a GTK app as a Flatpak](/gjsify/guides/flatpak-app/) and [Ship a CLI tool as a Flatpak](/gjsify/guides/flatpak-cli-tool/).

#### `gjsify flatpak init`

Generate the Flathub asset bundle from `package.json#gjsify.flatpak`.

```bash
gjsify flatpak init                 # GTK/Adwaita desktop app
gjsify flatpak init --kind cli      # CLI tool: no .desktop, console-application MetaInfo
```

| Option | Default | Description |
|---|---|---|
| `--app-id <id>` | `gjsify.flatpak.appId`, else `package.json#name` | Reverse-DNS app id. |
| `--kind <app\|cli>` | `app` | `cli` emits console-application MetaInfo and a `flathub.json` with `skip-icons-check: true`, and no `.desktop`. |
| `--cli-only` | `false` | Deprecated alias for `--kind cli`. |
| `--runtime <gnome\|freedesktop>` | `gnome` | Runtime family. Both kinds default to GNOME, because GJS bundles need GLib and GIO at runtime. |
| `--runtime-version <v>` | `50` for gnome, `24.08` for freedesktop | Runtime version. |
| `--manifest <path>` | `<app-id>.json` | Manifest output path. |
| `--metainfo <path>` | `data/<app-id>.metainfo.xml.in` | MetaInfo output path. |
| `--desktop <path>` | `data/<app-id>.desktop.in` | `.desktop` output path. App kind only. |
| `--flathub-json <path>` | `flathub.json` | flathub.json output path. |
| `--command <name>` | `gjsify.flatpak.command`, else the app id | Binary name in `/app/bin`. |
| `--sdk-extension <ext>` | none | Extra SDK extension, for example `org.freedesktop.Sdk.Extension.node24`. Repeatable. |
| `--finish-arg <arg>` | defaults | Extra finish-arg. Repeatable. |
| `--format` | `true` | Run `oxfmt --write` on generated JS/TS when oxfmt is present. The JSON, XML and `.desktop` files are not reformatted. `--no-format` to skip. |
| `--force` | `false` | Overwrite existing outputs. By default they are skipped and logged. |
| `--verbose` | `false` | Print resolved fields before writing. |

Each output is checked for existence on its own, so a hand-tuned `.desktop` does not block re-running `init` to refresh the others. Missing MetaInfo fields are reported with the exact `gjsify.flatpak.<key>` to set: the manifest still writes, and MetaInfo and `.desktop` wait until you fill the gaps.

<details>
<summary>Every gjsify.flatpak metadata key</summary>

| `gjsify.flatpak.<key>` | Required for | Notes |
|---|---|---|
| `appId` | both | Reverse-DNS. |
| `kind` | both | `"app"` (default) or `"cli"`. |
| `name` | optional | Display name for `<name>` and `.desktop` `Name=`. Derived from `package.json#name` by default, so set it when the npm name is not the display name (npm `learn6502` against `"Learn 6502 Assembly"`). |
| `developer.id` / `developer.name` | metainfo | AppStream OARS 1.1 and later require `<developer id="…">`. |
| `developer.email` | optional | Emits `<email>` inside `<developer>`. |
| `developer.nameTranslatable` | optional | Default `false`, which emits `translate="no"`. Set `true` for descriptive names. |
| `summary` | metainfo | 80 characters or fewer, no trailing period. |
| `summaryTranslatorHint` | optional | Emits a `<!-- TRANSLATORS: ... -->` comment before `<summary>`. |
| `description` | metainfo | A string (blank lines split it into `<p>`), or a `DescriptionBlock[]` of `{p, translatorHint?}` paragraphs and `{ul:[...], translatorHint?}` lists. |
| `license.metadata` | metainfo | SPDX id for the metadata itself. Defaults to `CC0-1.0`. |
| `license.project` | metainfo | SPDX id of the software. |
| `homepageUrl` | metainfo | `<url type="homepage">`. |
| `bugtrackerUrl` / `vcsBrowserUrl` / `donationUrl` / `translateUrl` | optional | Extra `<url>` entries. `translateUrl` is your Weblate or Crowdin URL. |
| `iconRemote` | optional | `<icon type="remote">`, useful for a Flathub thumbnail before a local SVG ships. |
| `categories` | metainfo (app), desktop | Freedesktop menu categories. |
| `keywords` | optional | Search keywords. |
| `releases` | metainfo | `[{ version, date, description? }]`. Flathub needs at least one. |
| `screenshots` | optional (app) | `[{ url, caption?, captionTranslatorHint?, environment?, type? }]`. |
| `branding` | optional (app) | `{ accentLight, accentDark }` hex colours. |
| `icon` | optional (app) | Path to a scalable SVG. You get a warning if it is missing. |
| `contentRating` | optional | An OARS keyword string (default `oars-1.1`), or `{ type?, attributes? }` with OARS keys mapped to `none`, `mild`, `moderate` or `intense`. |
| `kudos` | optional | Flathub quality markers such as `ModernToolkit`, `HiDpiIcon`, `TouchscreenSupport`, `UserDocs`. |
| `provides.binaries` | optional | Defaults to `[command]`. |
| `provides.mimetypes` / `provides.dbus` | optional | Extra `<mediatype>` and `<dbus>` entries. |
| `supports.controls` | optional | `["keyboard", "pointing", "touch", "gamepad", "tablet", "console", "vision"]`. |
| `supports.internet` | optional | `"always"`, `"offline-only"` or `"first-run"`. |
| `requires.displayLengthMin` / `recommends.displayLengthMin` | optional | Minimum display length in pixels. Phone portrait is about 360, tablet about 480. |
| `requires.controls` / `recommends.controls` | optional | Hard and soft control requirements. |
| `runtime` / `runtimeVersion` | optional | Runtime family and version. |
| `sdkExtensions` / `appendPath` | optional | Extra SDK extensions and PATH components inside the build sandbox. |
| `command` | optional | The binary in `/app/bin`. Defaults to the app id. |
| `finishArgs` | optional | Sandbox capabilities. Defaults for `kind: "app"` are `--device=dri`, `--share=ipc`, `--socket=fallback-x11`, `--socket=wayland`; `kind: "cli"` gets none. |
| `extraModules` | optional | Extra modules prepended before the generated Meson module. |
| `modules` | optional | Replaces the module array outright, so neither `extraModules` nor the Meson default is emitted. This is what a plain JS CLI wants, since the Meson default does not apply to it. |
| `flathubRepo` | optional | Overrides the `flathub/<app-id>` derivation for repos that do not follow the convention. |

Every translatable string (`summary`, description paragraphs and list items, screenshot captions, release notes) takes a parallel `translatorHint` that becomes a `<!-- TRANSLATORS: ... -->` comment in the generated `.metainfo.xml.in`. `xgettext` and `msgfmt --xml --template` forward those to the `.po` files, so translators see the context. There is a worked example in [Ship a GTK app as a Flatpak](/gjsify/guides/flatpak-app/#rich-appstream-features-i18n-ready).

</details>

#### `gjsify flatpak check`

Run the Flathub linters locally, the same ones Flathub's PR CI runs.

```bash
gjsify flatpak check                              # auto-detect the manifest
gjsify flatpak check eu.jumplink.Learn6502.json   # explicit manifest
gjsify flatpak check --repo repo                  # also lint a built repo
```

| Option | Default | Description |
|---|---|---|
| `[manifest]` | auto | Manifest path. Defaults to `<app-id>.json`, or the single `.json` that looks like a manifest. |
| `--metainfo <path>` | `data/<app-id>.metainfo.xml.in` | MetaInfo to validate. Skipped when missing. |
| `--repo <path>` | none | Also run `flatpak-builder-lint repo <path>`, after a build. |
| `--appstream` | `true` | Run `appstreamcli validate --strict`. `--no-appstream` skips it. |
| `--builder-lint` | `true` | Run `flatpak-builder-lint manifest`. `--no-builder-lint` skips it. |
| `--verbose` | `false` | Stream linter output through. |

Needs `appstreamcli` and `flatpak-builder-lint` on `PATH`. Both ship inside the `org.flatpak.Builder` Flatpak: `flatpak install -y flathub org.flatpak.Builder`. The command prints that hint when a binary is missing. Exit code is non-zero if any linter fails or any binary is absent.

#### `gjsify flatpak build`

Build the Flatpak with `flatpak-builder`, wrapping the usual install, export, bundle and tarball pipeline.

```bash
gjsify flatpak build
gjsify flatpak build --install
gjsify flatpak build --repo repo --bundle my-app.flatpak
```

| Option | Default | Description |
|---|---|---|
| `[manifest]` | first manifest-shaped `.json` in cwd | Manifest path. |
| `--build-dir <dir>` | `flatpak-build` | flatpak-builder working directory. |
| `--install` | `false` | After the build, run `flatpak-builder --user --install`. |
| `--repo <dir>` | none | Export into this OSTree repo. |
| `--bundle <path>` | none | After a `--repo` export, build a single-file bundle here. |
| `--tarball <path>` | none | Create a tarball of the build directory. |
| `--force-clean` | `true` | Pass `--force-clean` to flatpak-builder. |
| `--sandbox` | `true` | Pass `--sandbox`. |
| `--delete-build-dirs` | `true` | Pass `--delete-build-dirs`. |
| `--install-deps-from <remote>` | none | Pass `--install-deps-from`, for example `flathub`. |
| `--verbose` | `false` | Print the underlying invocations. |

#### `gjsify flatpak deps`

Generate the Flatpak offline npm cache from a `yarn.lock` or `package-lock.json`, wrapping `flatpak-node-generator`.

| Option | Default | Description |
|---|---|---|
| `--lockfile <path>` | `yarn.lock` or `package-lock.json` in cwd | Lockfile to read. |
| `--type <yarn\|npm>` | from the filename | Lockfile type. |
| `--out <path>` | `flatpak-node-sources.json` | Output sources file. |
| `--xdg-layout` | `true` | Pass `--xdg-layout`, recommended for Yarn Berry and PnP. |
| `--electron-node-headers` | `false` | Pass `--electron-node-headers`. |
| `--verbose` | `false` | Print the underlying invocation. |

#### `gjsify flatpak sources`

Generate an offline flatpak-builder `sources` array from any lockfile, so a Flathub build needs no network. Unlike `deps`, this one reads `gjsify-lock.json` too and needs no external generator.

```bash
gjsify flatpak sources
gjsify flatpak sources --print-module
```

| Option | Default | Description |
|---|---|---|
| `--lockfile <path>` | first of `gjsify-lock.json`, `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml` in cwd | Lockfile to read. |
| `--type <gjsify\|npm\|yarn\|pnpm>` | from the filename | Lockfile format. |
| `--out <path>` | `gjsify-sources.json` | Output sources file. |
| `--cache-root <dir>` | `flatpak-gjsify-cache` | Directory the tarballs download into. Point `XDG_CACHE_HOME` here in the build. Tarballs land at `<cache-root>/gjsify/tarballs/v1/<algo>/<shard>/<hex>.tgz`. |
| `--print-module` | `false` | Also print a ready-to-paste manifest module snippet to stderr. |

#### `gjsify flatpak ci`

Scaffold `.github/workflows/flatpak.yml` around the flathub-infra container and the `flatpak-builder` action.

| Option | Default | Description |
|---|---|---|
| `--manifest <path>` | `<app-id>.json` | Manifest the workflow points at. |
| `--bundle <name>` | `<app-id>.flatpak` | Bundle filename the action produces. |
| `--runtime-image <image>` | derived from `gjsify.flatpak.runtime` and `runtimeVersion` | Container image override, for example `ghcr.io/flathub-infra/flatpak-github-actions:gnome-50`. |
| `--branches <name..>` | `main` | Branches the workflow runs on push for. |
| `--out <path>` | `.github/workflows/flatpak.yml` | Output path. |
| `--cache-key <key>` | `flatpak-builder-${{ github.sha }}` | Override the action cache key. |
| `--force` | `false` | Overwrite an existing workflow file. |
| `--verbose` | `false` | Print resolved fields. |

#### `gjsify flatpak sync-flathub`

Flathub publishes each app from its own repo, whose manifest pins your upstream tag and commit. After cutting a release, this updates that pin and opens the PR.

```bash
gjsify flatpak sync-flathub                                  # latest local tag
gjsify flatpak sync-flathub --version v0.6.6 --commit 1a2b3c4d
gjsify flatpak sync-flathub --version v0.6.6 --dry-run       # show the plan
gjsify flatpak sync-flathub --version v0.6.6 --no-pr         # clone, commit, push, no PR
```

| Option | Default | Description |
|---|---|---|
| `--version <tag>` | `git describe --tags --abbrev=0` | Git tag to sync to. |
| `--app-id <id>` | `gjsify.flatpak.appId` | Used to locate the manifest in the tracking repo. |
| `--flathub-repo <owner/name>` | `gjsify.flatpak.flathubRepo`, else `flathub/<app-id>` | Tracking repo. |
| `--commit <sha>` | `git rev-list -n 1 <version>` | Commit to pin. |
| `--branch <name>` | `update-to-<version>` | Branch in the tracking repo. |
| `--source-index <n>` | first `type: git` source | Which `modules[0].sources[]` entry to update. |
| `--pr` | `true` | Open a PR with `gh pr create` after commit and push. `--no-pr` stops after the push. |
| `--dry-run` | `false` | Report the resolution, branch and commit, touching no files. |
| `--verbose` | `false` | Echo every `git` and `gh` invocation. |

It clones or updates `flathub/<app-id>` under `$XDG_CACHE_HOME/gjsify/flathub-sync/`, edits `modules[0].sources[<i>]` to set `tag` and `commit`, adds an `x-checker-data` block if missing so Flathub's update bot can pick up future releases, and preserves the manifest's original indentation and key order. Needs `git` always, and `gh` unless you pass `--no-pr`. Re-running with the same `--version` does nothing when the manifest is already pinned.

#### `gjsify flatpak diff`

Compare local git state against the Flathub tracking-repo manifest before you publish.

```bash
gjsify flatpak diff
gjsify flatpak diff --version v0.6.6
gjsify flatpak diff --against ./flathub/<app-id>.json   # offline
gjsify flatpak diff --detail
```

| Option | Default | Description |
|---|---|---|
| `--version <tag>` | `git describe --tags --abbrev=0` | Local version to compare. |
| `--app-id <id>` | `gjsify.flatpak.appId` | Reverse-DNS app id. |
| `--flathub-repo <owner/name>` | `gjsify.flatpak.flathubRepo`, else `flathub/<app-id>` | Tracking repo to fetch from. |
| `--against <path>` | none | Read a local manifest instead of fetching. |
| `--detail` | `false` | Also print the full Flathub source entry. |
| `--source-index <n>` | first `type: git` source | Which `modules[0].sources[]` entry to inspect. |
| `--verbose` | `false` | Echo the fetch URL and resolved values. |

Exit 0 when the tags match, exit 1 on drift, with the exact `gjsify flatpak sync-flathub` command that fixes it.

#### `gjsify flatpak release`

Cut a release end to end: `flatpak init` to regenerate assets, `flatpak check` to lint, `git tag` and push, then `flatpak sync-flathub` to open the Flathub PR.

```bash
gjsify flatpak release v0.6.6
gjsify flatpak release v0.6.6 --dry-run     # show the plan
gjsify flatpak release v0.6.6 --skip-tag    # the tag already exists
```

| Option | Default | Description |
|---|---|---|
| `<version>` | required | Release tag, for example `v0.6.6`. |
| `--skip-init` | `false` | Skip the `flatpak init --force` regeneration. |
| `--skip-check` | `false` | Skip the linter step. |
| `--skip-tag` | `false` | Skip `git tag` and the push. |
| `--push-tag` | `true` | Push the tag after creating it. |
| `--flathub-repo <owner/name>` | none | Override forwarded to `sync-flathub`. |
| `--dry-run` | `false` | Print each step without running any of them. |
| `--verbose` | `false` | Echo every sub-command. |

`init` and `check` run before the tag is created, so a failure leaves you with no tag rather than a half-released one.

## Publish to npm

### `gjsify pack`

Produce an npm-compatible `.tgz` for a workspace. A drop-in for `npm pack`. `workspace:^`, `workspace:~` and `workspace:*` dependencies are always rewritten to resolved version ranges, so the tarball is portable.

```bash
gjsify pack                                # the current workspace
gjsify pack packages/infra/cli             # a specific one
gjsify pack --pack-destination dist        # write it somewhere else
gjsify pack --json                         # npm-pack-compatible metadata
```

| Option | Default | Description |
|---|---|---|
| `[path]` | cwd | Workspace to pack. |
| `--pack-destination <dir>` | the workspace | Where to write the tarball. |
| `--json` | `false` | Emit pack metadata as JSON on stdout. |
| `--dry-run` | `false` | Compute everything, write no `.tgz`. |
| `--ignore-scripts` | `false` | Skip the `prepack` lifecycle script. Use it when an outer workflow already ran the scripts. |

It honours the `files` allowlist plus `.npmignore` and `.gitignore` with npm's precedence, and always includes `package.json`, `README*`, `LICENSE*`, `NOTICE*`, and the `main` and `bin` entries even when `files` leaves them out.

### `gjsify publish`

Pack and upload a workspace. A drop-in for `npm publish`, using [`gjsify pack`](#gjsify-pack), so the `workspace:^` rewrite happens for you.

```bash
gjsify publish                                  # the current workspace
gjsify publish packages/infra/cli --tag latest
gjsify publish --access public                  # first publish of a scoped package
gjsify publish --access public --otp 123456     # with a 2FA code
gjsify publish --tolerate-republish             # treat "already published" as success
gjsify publish --dry-run                        # pack only
```

| Option | Default | Description |
|---|---|---|
| `[path]` | cwd | Workspace to publish. |
| `--tag <tag>` | `latest` | Dist-tag. |
| `--access <kind>` | none | `public` or `restricted`. Required for the first publish of a scoped package. |
| `--otp <code>` | none | npm 2FA code, sent as the `npm-otp` header. If the registry answers `401 OTP-required` and you did not pass one, an interactive terminal prompts once and retries; a non-TTY exits non-zero with an actionable message. |
| `--tolerate-republish` | `false` | Treat "version already published" as success, covering both the classic 409 and the OIDC-path 403. |
| `--tolerate-untrusted-new` | `false` | Exit 0 when OIDC token exchange says "package not found" and no fallback token is configured, which is a never-published scoped package whose Trusted Publisher is not set up yet. Without it, one un-bootstrapped package breaks a whole serialized `gjsify foreach publish`. |
| `--trusted` | auto | Authenticate through npm Trusted Publishing, exchanging the GitHub Actions id-token for a short-lived npm token. Auto-detected when `ACTIONS_ID_TOKEN_REQUEST_URL` and `_TOKEN` are set and the resolved npmrc has no `_authToken`. Needs `permissions: id-token: write` in the workflow and a Trusted Publisher on npmjs.com. |
| `--check-trusted` | `false` | Do the OIDC exchange, report success or failure, and exit without publishing. Useful as a bulk verifier via `gjsify foreach publish --check-trusted`. |
| `--provenance` | `false` | Recorded in the payload. No signing happens yet. |
| `--dry-run` | `false` | Pack only, do not upload. |
| `--json` | `false` | Emit publish metadata as JSON. |

Auth reads `process.env.NPM_CONFIG_USERCONFIG` first (where `actions/setup-node` writes the auth-token npmrc), falling back to `~/.npmrc`.

Publish every workspace in one go with [`gjsify foreach`](#gjsify-foreach):

```bash
gjsify foreach --no-private --exec -- gjsify publish --tag latest --access public
```

### `gjsify whoami`

Print the npm username behind your current token, with a clear message when the token is dead, missing, or the registry is unreachable.

```bash
gjsify whoami
gjsify whoami --json
```

| Option | Default | Description |
|---|---|---|
| `--registry <url>` | scope-aware `.npmrc` lookup, else `https://registry.npmjs.org/` | Registry to probe. |
| `--json` | `false` | Emit `{username, registry}`, or `{error, registry}`, as one line. |

### `gjsify login`

Log in to an npm registry and write the token to `~/.npmrc`.

```bash
gjsify login
gjsify login --scope @my-org
gjsify login --username me --otp 123456
```

| Option | Default | Description |
|---|---|---|
| `--registry <url>` | `https://registry.npmjs.org/`, or the scope's registry | Registry to log in to. |
| `--scope <name>` | none | Associate the login with a scope, resolving that scope's registry from `.npmrc`. |
| `--username <name>` | prompted | Username. |
| `--otp <code>` | prompted on demand | 2FA code. |
| `--json` | `false` | Emit `{username, registry}` on success. |

It prompts for the password with the input hidden. This is npm's legacy credentials flow; the web OAuth flow is not supported.

### `gjsify logout`

Revoke the token on the registry (best effort) and remove it from `~/.npmrc`.

```bash
gjsify logout
gjsify logout --scope @my-org
```

| Option | Default | Description |
|---|---|---|
| `--registry <url>` | `https://registry.npmjs.org/`, or the scope's registry | Registry to log out of. |
| `--scope <name>` | none | Log out of a scope's registry, resolved from `.npmrc`. |
| `--json` | `false` | Emit `{registry, revoked, removed}`. |

### `gjsify trust`

Configure npm Trusted Publishers (OIDC through GitHub Actions) for your publishable workspace packages, so `release.yml` can publish without a long-lived token. No `npm` binary needed, and it skips packages that are already configured.

```bash
gjsify trust                        # every publishable workspace
gjsify trust '@gjsify/web-*'        # a subset
gjsify trust --list                 # report state, change nothing
gjsify trust --dry-run
```

| Option | Default | Description |
|---|---|---|
| `[packages..]` | all publishable | Package-name globs limiting the sweep. |
| `--repository <owner/repo>` | inferred from `origin` | GitHub repo the Trusted Publisher is scoped to. |
| `--workflow <file>` | `release.yml` | Workflow allowed to publish. Basename only. |
| `--environment <env>` | none | GitHub Actions environment the workflow must run in. |
| `--registry <url>` | scope-aware `.npmrc` lookup | Registry override. |
| `--otp <code>` | prompted on demand | 2FA code, sent as `npm-otp`. |
| `--dry-run` | `false` | List what would be configured. |
| `--force` | `false` | Re-POST the config even for already-trusted packages. |
| `--list` | `false` | Only report each package's current trust state. |
| `--private` | `false` | Include private workspaces. They are not publishable, so this is off by default. |

### `gjsify onboard`

Make sure every publishable package in a monorepo is both published on npm and has a Trusted Publisher configured, doing only the missing work. It folds the whole manual first-publish and trust bootstrap into one idempotent sweep.

Nothing about it is specific to a gjsify project. It works on any npm or yarn workspace out of the box, and `--packages` extends it to a monorepo that has no workspace manifest at all — a repo whose package directories simply sit next to each other.

```bash
gjsify onboard                       # publish and trust whatever is missing
gjsify onboard --dry-run             # report the plan
gjsify onboard --packages '*'        # a monorepo with no root package.json
gjsify onboard --exclude '@acme/*'   # filter the set by package name
gjsify onboard --otp 123456          # seed the shared 2FA code
gjsify onboard --json                # machine-readable summary as the last stdout line
gjsify onboard --yes                 # non-interactive
```

| Option | Default | Description |
|---|---|---|
| `--packages <glob>` | root manifest `workspaces` | Directory glob naming package folders, resolved against the repo root. Repeatable. Merged with the root manifest's own globs when it has any. A pattern that matches no directory is a hard error. |
| `--include <glob>` | all | Include packages by name. Repeatable. |
| `--exclude <glob>` | none | Exclude packages by name. Repeatable. |
| `--repository <owner/repo>` | inferred from `origin` | GitHub repo the Trusted Publisher is scoped to. |
| `--workflow <file>` | `release.yml` | Workflow allowed to publish via OIDC. Basename only. |
| `--environment <env>` | none | GitHub Actions environment the workflow must run in. |
| `--access <a>` | `public` | npm access for a package this sweep publishes for the first time. An already-published package keeps the access it has. |
| `--build` / `--no-build` | `--build` | Run a to-be-published package's `build` script first. Turn it off for a repo whose packages are generated artifacts. |
| `--registry <url>` | scope-aware `.npmrc` lookup | Registry override. |
| `--otp <code>` | prompted once on demand | The initial shared 2FA code. |
| `--concurrency <n>` | `4` | How many packages to read state for in parallel. Kept small so one token does not burst npm; the first read is always serial, to prompt for the shared code once. |
| `-v, --verbose` | `false` | List every package in the plan, not just the rows that need work. The counts always cover all of them. |
| `--dry-run` | `false` | Report the plan without changing anything. |
| `--json` | `false` | Emit a summary object as the final stdout line. |
| `--yes` | `false` | Never prompt. Fail clearly if a login or an OTP is needed and not supplied. |

What it does, in order: check the token is live (running the [`login`](#gjsify-login) flow only if it is not), enumerate the publishable packages, read each package's Trusted Publisher state concurrently, then act only on the gaps. One 2FA code is reused across every publish and trust operation, so a sweep of many packages usually asks you for a code once. Re-running when everything is already published and trusted does nothing and exits 0.

The sweep reports progress through both phases: the state-read phase ticks (`read 600/703 — 590 to
do, 10 already done`) and every write is numbered (`[123/662] trusted @acme/x`). Nothing else
writes to the terminal while a 2FA prompt is open — such messages are held and flushed once you
have answered, so a notice from a concurrent worker cannot land inside the digits you are typing.

One 2FA code covers the whole sweep, and it is asked for **once at a time** — concurrent probes
share the prompt rather than each opening their own. npm codes expire on their ~30-second window,
so a long sweep may ask again later; each such expiry costs exactly one prompt.

Trusted-Publisher **writes** run at `--write-concurrency` (default 4); **publishes** stay serial,
because publish order is a correctness property. Raising the write concurrency buys fewer 2FA
prompts rather than raw speed — measured against a 703-package repo, npm rate-limits the sweep at
serial pace already, so the registry sets the ceiling, not the loop. What serial cost was codes:
one lives about 30 seconds, so the sweep crossed a code boundary roughly every 38 packages.

An HTTP 429 is waited out, not reported. npm throttles a long sweep, and because it is cumulative
it lands on the *tail* of the list — which reads as "these packages are special" when the truth is
that the sweep asked too fast. A 429 **anywhere pauses everywhere**: retrying one throttled request in isolation leaves the rest
of the sweep provoking the very limit that retry is waiting out, which is how a real run spent its
retry budget and reported `trust failed (HTTP 429)`. Reads and writes share one cool-down, so the
sweep self-paces down to whatever npm will serve. The wait is a TIME budget (5 minutes per request), not an
attempt count: a fixed number of doubling retries is only ~30 seconds of patience, npm's window is
longer than that, and a real 703-package sweep consequently failed its last 73 writes inside a
single cooldown. Only throttling that outlasts the budget is reported — in the plan AND in the
closing summary, since a write is throttled long after the plan has scrolled away and `73 failed`
on its own reads as 73 broken packages.

npm advertises no budget ahead of time — there are no `X-RateLimit-*` headers on ordinary
responses — so the first 429 of a run prints what the registry actually said, including when it
said nothing and the delay is the CLI's own. Re-running is safe: the sweep is idempotent and
skips whatever already landed.

A package whose own `package.json` names a **different** `repository` than the one being
configured is refused, with the foreign repo and the count. A workspace of a repo is not the same
claim as a package published from it: `gjsify/ts-for-gir` has 703 generated `@girs/*` workspaces
that publish from `gjsify/types`, and a Trusted Publisher scoped to the wrong repository points
that package's OIDC exchange at a workflow that never publishes it. Narrow the set with
`--exclude` / `--include`, or point `--repository` at the repo that does publish them. A package
that declares no repository is not evidence of a mismatch, and passes.

The first line of output names the repo root and every enumeration source with its count — `root=/src/types | packages(*)=703`. That is worth reading before you let a sweep write to npm: the package list is the whole blast radius, and a total on its own cannot tell the right tree from a plausible wrong one. `--json` carries the same three fields (`root`, `sources`, `discovered`) in its summary object.
