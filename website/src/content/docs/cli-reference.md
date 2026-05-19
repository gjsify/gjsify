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

Compile and bundle with [Rolldown](https://rolldown.rs/) (Vite 8's production bundler). Automatically aliases Node.js and Web API imports to `@gjsify/*` equivalents for GJS.

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
| `--log-level` | `silent` \| `error` \| `warning` \| `info` \| `debug` \| `verbose` | `warning` | Bundler log level |
| `--external` | name[] | `[]` | Module specifiers that should NOT be bundled — they remain as runtime imports. Repeatable; comma-separated values are split. Merged with the platform's built-in externals. |
| `--define` | `KEY=VALUE`[] | `[]` | Bundler `define` pass-through. VALUE is a JS expression — string literals must be JSON-quoted (`--define VERSION='"1.2.3"'`). Repeatable. Merged with built-in defines like `global: 'globalThis'`. |
| `--alias` | `FROM=TO`[] | `[]` | Layered on top of the built-in alias map. Useful for stubbing heavy deps (`--alias typedoc=@gjsify/empty`). Repeatable. |

For `--app gjs`, the target is `firefox140` (SpiderMonkey 140) and `gi://*`, `cairo`, `system` and `gettext` are externalised. For `--app node`, the target is `node24`.

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

## `gjsify install`

Install npm dependencies for a project (or globally with `-g`). Drop-in for `npm install` / `yarn install`. Uses a native install backend (`@gjsify/semver` + `@gjsify/npm-registry` + `@gjsify/tar`) — no Node or npm CLI at runtime.

```bash
gjsify install                  # full project install
gjsify install --immutable      # CI mode — install strictly from gjsify-lock.json
gjsify install lodash           # add lodash, save to dependencies
gjsify install -D vitest        # save to devDependencies
gjsify install -g @gjsify/cli   # global install under ~/.local/share/gjsify/global/
```

| Option | Default | Description |
|---|---|---|
| `[packages..]` | — | Optional package specs. Omit for full project install. |
| `-g`, `--global` | `false` | Install into `~/.local/share/gjsify/global/` and symlink bins into `~/.local/bin/`. |
| `-D`, `--save-dev` | `false` | Save to `devDependencies`. |
| `--save-peer` | `false` | Save to `peerDependencies`. |
| `-O`, `--save-optional` | `false` | Save to `optionalDependencies`. |
| `--immutable` | `false` | Refuse to update `gjsify-lock.json`; fail if it's missing or stale. Equivalent to `yarn --immutable` / `npm ci --frozen-lockfile`. |
| `--verbose` | `false` | Per-package install log. |

Resolver mirrors npm v3+ semantics: each `(requester → dep → range)` edge is checked against the ancestor `node_modules` chain; compatible placements are reused, conflicting ones are nested. Supports `npm`-style `overrides` and `yarn`-style `resolutions` in `package.json`. Lockfile schema is v2 (path-keyed `packages` map).

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

## `gjsify foreach`

Run a workspace script across all (or filtered) workspaces. Drop-in for `yarn workspaces foreach`.

```bash
gjsify foreach build                          # run `build` in every workspace
gjsify foreach -p -t build                    # parallel + topological order
gjsify foreach --no-private build             # skip workspaces marked private:true
gjsify foreach --include '@gjsify/web-*' test # glob filter
gjsify foreach --exec -- npm publish --tag latest  # arbitrary command
```

| Option | Default | Description |
|---|---|---|
| `[script]` | — | Script name to run; with `--exec`, the command to run. |
| `[args..]` | — | Extra arguments forwarded to each invocation. |
| `-A`, `--all` | `false` | Include workspaces declared as `private: true`. |
| `-p`, `--parallel` | `false` | Run workspaces in parallel (capped by `--jobs`). |
| `-t`, `--topological` | `false` | Wait for each workspace's prod-deps to finish before starting it. |
| `--topological-dev` | `false` | Like `--topological` but also respects `devDependencies`. |
| `--include <glob>` | — | Repeatable; include workspaces matching the glob. |
| `--exclude <glob>` | — | Repeatable; exclude workspaces matching the glob. |
| `--no-private` | — | Skip private workspaces. |
| `-j`, `--jobs <n>` | cpu count | Max concurrent workspaces in `--parallel` mode. |
| `--exec` | `false` | Treat `<script> [args..]` as an arbitrary command (use `-- <cmd>` to forward flags). |
| `-v`, `--verbose` | `false` | Echo every spawned command. |

## `gjsify workspace`

Run a single script in a single workspace. Drop-in for `yarn workspace <name> run <script>`.

```bash
gjsify workspace @gjsify/cli build
gjsify workspace @gjsify/fetch test:gjs
```

| Argument | Description |
|---|---|
| `<name>` | Workspace name (matches `package.json#name`). |
| `<script>` | Script name to run. |
| `[args..]` | Extra arguments forwarded to the script. |

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

## `gjsify gsettings`

Compile GSettings schema XML files (`*.gschema.xml`) into a binary `gschemas.compiled`. Thin wrapper around `glib-compile-schemas`.

```bash
npx @gjsify/cli gsettings data/schemas
npx @gjsify/cli gsettings data/schemas --targetdir dist/schemas
```

| Option | Default | Description |
|---|---|---|
| `<schemadir>` | — | Directory containing `*.gschema.xml` files (required). |
| `-t`, `--targetdir` | `<schemadir>` | Directory to write `gschemas.compiled` into. |
| `--strict` | `true` | Pass `--strict` to `glib-compile-schemas` (warnings become errors). `--no-strict` to disable. |
| `--verbose` | `false` | Print the underlying `glib-compile-schemas` invocation. |

Requires `glib-compile-schemas` (package: `glib2-devel` on Fedora, `libglib2.0-dev-bin` on Debian/Ubuntu).

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

## `gjsify flatpak`

Subcommand group for shipping GJS apps and CLIs as Flatpaks. Five subcommands:

| Subcommand | Purpose |
|---|---|
| `flatpak init` | Scaffold the full Flathub-ready asset set: manifest JSON + MetaInfo XML + `.desktop` (apps only) + `flathub.json` |
| `flatpak check` | Run `appstreamcli validate --strict` + `flatpak-builder-lint manifest` locally |
| `flatpak build` | Wrap `flatpak-builder` with sensible defaults |
| `flatpak deps` | Wrap `flatpak-node-generator` to produce the offline npm cache |
| `flatpak ci` | Scaffold `.github/workflows/flatpak.yml` matching the Flathub action shape |

End-to-end guides: [Ship a GJS app as a Flatpak](./guides/flatpak-app/) | [Ship a CLI tool as a Flatpak](./guides/flatpak-cli-tool/).

### `gjsify flatpak init`

Generate the full Flathub asset bundle from `package.json#gjsify.flatpak`.

```bash
# Default — GTK/Adwaita desktop app
npx @gjsify/cli flatpak init

# CLI tool — no .desktop, console-application MetaInfo, skip-icons-check
npx @gjsify/cli flatpak init --kind cli
```

| Option | Default | Description |
|---|---|---|
| `--app-id` | `gjsify.flatpak.appId` or `package.json#name` | Reverse-DNS app id |
| `--kind <app\|cli>` | `app` | Template kind. `cli` emits `console-application` MetaInfo + `flathub.json` with `skip-icons-check: true`, no `.desktop`. |
| `--cli-only` | `false` | Deprecated alias for `--kind cli`. |
| `--runtime <gnome\|freedesktop>` | `gnome` | Runtime family. Both kinds default to GNOME because GJS bundles need GLib/GIO at runtime. |
| `--runtime-version` | `50` (gnome) / `24.08` (freedesktop) | Runtime version |
| `--manifest <path>` | `<app-id>.json` | Manifest output path |
| `--metainfo <path>` | `data/<app-id>.metainfo.xml.in` | MetaInfo XML output path |
| `--desktop <path>` | `data/<app-id>.desktop.in` | `.desktop` output path (kind=app only) |
| `--flathub-json <path>` | `flathub.json` | flathub.json output path |
| `--command` | `gjsify.flatpak.command` or app id | Binary name in `/app/bin` |
| `--sdk-extension <ext>` | — | Repeatable; extra SDK extension (e.g. `org.freedesktop.Sdk.Extension.node24`) |
| `--finish-arg <arg>` | — | Repeatable; appended to default finish-args |
| `--force` | `false` | Overwrite existing outputs (default: skip-and-log) |
| `--verbose` | `false` | Print resolved fields before writing |

**Non-destructive contract:** each output (manifest / metainfo / desktop / flathub.json) is independently checked for existence; existing files are skipped with a log line. Re-run with `--force` to overwrite. User edits to one file (e.g. a hand-tuned `.desktop`) don't block re-running `init` to refresh the others.

**Config gaps degrade gracefully:** missing MetaInfo fields are reported with per-field hints pointing at the exact `gjsify.flatpak.<key>` to set. The manifest still writes; MetaInfo + .desktop are skipped until you fill the gaps and re-run. Full field list:

| `gjsify.flatpak.<key>` | Required for | Notes |
|---|---|---|
| `appId` | both | Reverse-DNS. |
| `kind` | both | `"app"` (default) or `"cli"`. |
| `name` | optional | Human-readable display name for `<name>` + `.desktop` `Name=`. Defaults to a friendly derivation of `package.json#name` — set explicitly when the npm name doesn't match the display name (e.g. npm name `learn6502` vs display name `"Learn 6502 Assembly"`). |
| `developer.id` / `developer.name` | metainfo | AppStream OARS 1.1+ requires `<developer id="…">`. |
| `developer.email` | optional | Emits `<email>` inside `<developer>`. |
| `developer.nameTranslatable` | optional | Default `false` → emits `translate="no"`. Set `true` for descriptive names. |
| `summary` | metainfo | ≤80 chars, no trailing period. |
| `summaryTranslatorHint` | optional | Emits `<!-- TRANSLATORS: ... -->` before `<summary>`. |
| `description` | metainfo | **String** form (blank-line-split into `<p>`) or **`DescriptionBlock[]`** (`{p, translatorHint?}` paragraphs and `{ul:[...], translatorHint?}` bullet lists). |
| `license.metadata` | metainfo | SPDX id; defaults to `CC0-1.0` when absent. |
| `license.project` | metainfo | SPDX id of the software project. |
| `homepageUrl` | metainfo | `<url type="homepage">`. |
| `bugtrackerUrl` / `vcsBrowserUrl` / `donationUrl` / `translateUrl` | optional | Extra `<url>` entries. `translateUrl` is the Weblate/Crowdin URL. |
| `iconRemote` | optional | `<icon type="remote">` — useful for Flathub thumbnail before local SVG ships. |
| `categories` | metainfo (app) / desktop | Freedesktop Menu spec categories. |
| `keywords` | optional | Search keywords. |
| `releases` | metainfo | `[{ version, date, description? }]`. Flathub requires ≥1. `description` accepts the same string-or-block-array shape. |
| `screenshots` | optional (app) | `[{ url, caption?, captionTranslatorHint?, environment?, type? }]`. |
| `branding` | optional (app) | `{ accentLight, accentDark }` hex colours. |
| `icon` | optional (app) | Path to scalable SVG; warning if missing. |
| `contentRating` | optional | OARS keyword string (default `oars-1.1`) **or** `{ type?, attributes? }` with OARS keys (`social-info`, `language-humor`, …) → `none\|mild\|moderate\|intense`. |
| `kudos` | optional | `["ModernToolkit", "HiDpiIcon", "TouchscreenSupport", "UserDocs", ...]` — Flathub-recognised quality markers. |
| `provides.binaries` | optional | Defaults to `[command]`. |
| `provides.mimetypes` / `provides.dbus` | optional | Extra `<mediatype>` / `<dbus>` entries. |
| `supports.controls` | optional | `["keyboard", "pointing", "touch", "gamepad", "tablet", "console", "vision"]`. |
| `supports.internet` | optional | `"always" \| "offline-only" \| "first-run"`. |
| `requires.displayLengthMin` / `recommends.displayLengthMin` | optional | Minimum display length in pixels. Phone-portrait min ≈ 360, tablet recommendation ≈ 480. |
| `requires.controls` / `recommends.controls` | optional | Hard / soft control requirements. |

For multilingual apps, every translatable string (`summary`, `description` paragraphs + list items, screenshot captions, release notes) supports a parallel `translatorHint` field that emits a `<!-- TRANSLATORS: ... -->` comment in the generated `.metainfo.xml.in` — `xgettext` / `msgfmt --xml --template` picks these up and forwards them to the `.po` files so contributors on Weblate / Crowdin see the context. See the [flatpak-app guide → Rich AppStream features](/gjsify/guides/flatpak-app/#rich-appstream-features-i18n-ready) for a worked example.

### `gjsify flatpak check`

Run Flathub linters locally — same checks Flathub's PR CI runs.

```bash
npx @gjsify/cli flatpak check                              # auto-detect manifest
npx @gjsify/cli flatpak check eu.jumplink.Learn6502.json   # explicit manifest
npx @gjsify/cli flatpak check --repo repo                  # also lint a built repo
```

| Option | Default | Description |
|---|---|---|
| `[manifest]` | auto | Manifest path; defaults to `<app-id>.json` or the single `.json` matching a manifest shape. |
| `--metainfo <path>` | `data/<app-id>.metainfo.xml.in` | MetaInfo to validate; skipped if missing. |
| `--repo <path>` | — | If set, also runs `flatpak-builder-lint repo <path>` (post-build). |
| `--appstream` | `true` | Toggle `appstreamcli validate --strict`. `--no-appstream` to skip. |
| `--builder-lint` | `true` | Toggle `flatpak-builder-lint`. `--no-builder-lint` to skip. |
| `--verbose` | `false` | Stream linter stdout/stderr through. |

Requires `appstreamcli` and `flatpak-builder-lint` on `PATH`. Both ship inside the `org.flatpak.Builder` Flatpak — install via `flatpak install -y flathub org.flatpak.Builder`; check prints this hint on `ENOENT`. Exit code aggregates: non-zero if any linter fails or any required binary is missing.

### `gjsify flatpak build`, `deps`, `ci`

See the [flatpak-app guide](./guides/flatpak-app/) for usage examples; flags are stable since v0.4.x.

## `gjsify self-update`

Refresh the installed `@gjsify/cli` to the latest release (or a pinned dist-tag).

```bash
gjsify self-update              # install latest
gjsify self-update --check      # diff only, exit 1 if outdated
gjsify self-update --force      # reinstall identical version
gjsify self-update --tag next   # install a specific dist-tag (or version)
```

Walks `import.meta.url` to find the CLI's own `package.json`, fetches the matching `dist-tag` via `@gjsify/npm-registry`, then re-uses the install backend that powers `gjsify install -g` (handles transitive native prebuilds, lockfile, bin shims).

Only works for CLIs installed under `~/.local/share/gjsify/global/` (the `install.mjs` bootstrap or `gjsify install -g`). Installs from `npm install -g` land outside that prefix; `self-update` surfaces a warning pointing at the new bootstrap.

| Option | Default | Description |
|---|---|---|
| `--check` | `false` | Compare current vs target without installing. Exit 0 if up-to-date, 1 if outdated. |
| `--force` | `false` | Reinstall even when target matches current. |
| `--tag` | `latest` | npm dist-tag or pinned version. |

## `gjsify generate-installer`

Scaffold an `install.mjs` for your own GJS-runnable npm package — your users get the same `curl ... | gjs -m -` install story as gjsify itself.

```bash
cd my-gjs-app
gjsify generate-installer
# → install.mjs written. Commit it.

# Optional flags:
gjsify generate-installer \
  --target @my-org/my-app \
  --bin-name my-app \
  --bootstrap-url https://example.com/cli.gjs.mjs \
  --output bin/install.mjs --force
```

The generated `install.mjs` is a verbatim copy of gjsify's own root `install.mjs` with three constants substituted (`DEFAULT_TARGET`, `DEFAULT_BIN_NAME`, `DEFAULT_BOOTSTRAP_URL`). See the [Distributing GJS apps guide](/guides/distributing-gjs-apps/) for the full publication workflow.

| Option | Default | Description |
|---|---|---|
| `[target]` (positional) | `package.json#name` | npm package to install. |
| `--bin-name <name>` | first key of `gjsify.bin` or `bin` | Bin name produced by the installer. |
| `--bootstrap-url <url>` | gjsify GH `releases/latest/download/cli.gjs.mjs` | Override the bootstrap bundle source. |
| `--output <file>` | `install.mjs` | Where to write the installer. |
| `--force` | `false` | Overwrite an existing file. |

## `gjsify uninstall`

Symmetric inverse of `gjsify install -g`. Removes a previously installed package tree from `~/.local/share/gjsify/global/node_modules/<pkg>/` plus any bin shims under `~/.local/bin/` that point into it.

```bash
gjsify uninstall -g <pkg>                # remove pkg and its bin shim(s)
gjsify uninstall -g <pkg> --dry-run      # show what would be removed
gjsify uninstall -g <pkg1> <pkg2>        # remove multiple packages
```

Scoped to `--global` only. Project-local removal (mirror of `npm uninstall <pkg>` without -g) requires rewriting `package.json` + refreshing the lockfile, which is a separate workstream.

## `gjsify pack`

Produce an npm-compatible `.tgz` tarball for a workspace. Drop-in for `npm pack`. Always rewrites `workspace:^/~/*` deps to resolved version ranges so the published tarball is portable. Honors the `files` allowlist + `.npmignore`/`.gitignore` with the same precedence as npm.

```bash
gjsify pack                                # pack the current workspace
gjsify pack packages/infra/cli             # pack a specific workspace
gjsify pack --pack-destination dist        # write the .tgz somewhere else
gjsify pack --json                         # emit npm-pack-compatible metadata
```

| Option | Default | Description |
|---|---|---|
| `[path]` | `cwd` | Workspace path to pack. |
| `--pack-destination <dir>` | workspace cwd | Where to write the tarball. |
| `--json` | `false` | Emit pack metadata as JSON on stdout (matches `npm pack --json`). |
| `--dry-run` | `false` | Compute everything but do not write the `.tgz`. |

Auto-includes `package.json`, `README*`, `LICENSE*`, `NOTICE*`, `main` and `bin` entries even if they're not in `files`.

## `gjsify publish`

Pack + upload a workspace to its npm registry. Drop-in for `npm publish`. Uses [`gjsify pack`](#gjsify-pack) under the hood (so the `workspace:^` rewrite happens automatically). Authenticates by reading `process.env.NPM_CONFIG_USERCONFIG` first (where `actions/setup-node@v6` writes the auth-token npmrc) with `~/.npmrc` as fallback.

```bash
gjsify publish                                  # publish current workspace
gjsify publish packages/infra/cli --tag latest
gjsify publish --access public                  # required for first publish of scoped pkg
gjsify publish --tolerate-republish             # treat 409 conflict as success
gjsify publish --dry-run                        # pack only, don't PUT
```

| Option | Default | Description |
|---|---|---|
| `[path]` | `cwd` | Workspace path to publish. |
| `--tag <tag>` | `latest` | npm dist-tag. |
| `--access <kind>` | — | `public` or `restricted` (required on first publish of scoped packages). |
| `--tolerate-republish` | `false` | Treat a 409 conflict (version already published) as success. Matches `yarn --tolerate-republish`. |
| `--provenance` | `false` | Recorded in payload but no signing happens (no sigstore signer yet). |
| `--dry-run` | `false` | Pack only, do not PUT. |
| `--json` | `false` | Emit publish metadata as JSON. |

Combine with [`gjsify foreach`](#gjsify-foreach) to publish every workspace in one go:

```bash
gjsify foreach --no-private --exec -- gjsify publish --tag latest --access public
```

| Option | Default | Description |
|---|---|---|
| `<packages..>` (positional) | — | One or more package names. |
| `--global` / `-g` | `false` | Required; removes from `defaultGlobalLayout()` paths. |
| `--dry-run` | `false` | Print "would remove" lines, touch no files. |
| `--verbose` | `false` | Surface inspection failures (rare). |

Exits non-zero when nothing was removed (no matching install found).

## `gjsify format`

Format source files via [Biome](https://biomejs.dev). gjsify resolves Biome's native binary from `node_modules/@biomejs/cli-<platform>-<arch>/biome` directly — skipping the Node-launcher in `@biomejs/biome/bin/biome` — so the toolchain stays Node-free (mirror of how `gjsify gettext` spawns `msgfmt` and `gjsify gresource` spawns `glib-compile-resources`).

```bash
gjsify format --init             # write recommended biome.json
gjsify format --write src/       # apply formatter in place
gjsify format --check src/       # CI mode — exit non-zero on drift
```

| Option | Default | Description |
|---|---|---|
| `[paths..]` | `.` | Files/directories to format. |
| `--write` | `false` | Apply changes in place. |
| `--check` | `false` | CI-mode: report drift, exit non-zero (does not write). Equivalent to running biome without `--write`. |
| `--config-path <path>` | walks up | Path to `biome.json`. Default: nearest `biome.json` / `biome.jsonc` from cwd or workspace root. |
| `--init` | `false` | Write a recommended `biome.json` into cwd (skips if exists). |
| `--force` | `false` | Used with `--init` to overwrite existing. |
| `--verbose` | `false` | Echo the resolved biome binary + args before spawning. |

**Workspace-aware resolution** — when run from inside a sub-workspace, gjsify walks up to the workspace root to find `node_modules/@biomejs/cli-*/biome`. Single biome.json at the workspace root applies to all sub-workspaces (Biome v2 globbing handles this natively).

**Standalone projects** — same shape, single `biome.json` at the project root.

### Recommended `biome.json` defaults

`gjsify format --init` writes a `biome.json` tuned for GJS/GNOME projects:

- **JS/TS:** 4-space indent, single quotes, semicolons-always, trailing commas, line width 120 (matches the gjsify codebase + GNOME Shell style guide)
- **JSON / JSONC:** 2-space indent (matches Flathub manifest convention, Biome+Prettier defaults)
- **CSS:** 2-space indent, single quotes (matches GTK4-CSS convention)
- **Linter:** Biome's `recommended: true` + four GJS-specific opt-outs:
  - `noNonNullAssertion: off` — `!` operator needed for `@girs/*` API surfaces
  - `noExplicitAny: warn` (not error) — `as unknown as T` chains in cross-runtime polyfills
  - `noConsole: off` — GJS apps log via `console.log` (no structured-logger convention)
  - `useImportType: warn` — recommended but non-blocking
- **Excludes** — generated artifacts (`dist`, `lib`, `cli.gjs.mjs`, `test.{gjs,node}.mjs`), Flatpak build dirs, `refs/` submodules, prebuilds, `.yarn/cache`, compiled `.metainfo.xml`.

**Errors when biome is missing:** prints `[gjsify biome] biome native binary not found.` with `gjsify install -D @biomejs/biome` as the install hint, exits 1.

## `gjsify lint`

Run Biome's lint diagnostics. Default reports findings (exit non-zero); `--write` applies safe fixes in place.

```bash
gjsify lint              # lint all
gjsify lint src/         # lint specific paths
gjsify lint --write      # apply safe fixes (skips unsafe)
```

| Option | Default | Description |
|---|---|---|
| `[paths..]` | `.` | Files/directories to lint. |
| `--write` | `false` | Apply safe lint fixes in place. |
| `--config-path <path>` | walks up | biome.json path override. |
| `--verbose` | `false` | Echo resolved biome binary + args. |

Use `gjsify fix` for the combined format + safe-lint-fix + organize-imports pass.

## `gjsify fix`

Combined `format + safe-lint-fix + organize-imports` (wraps Biome's `check --write`). Different from `gjsify check` (which verifies system dependencies).

```bash
gjsify fix               # default: apply all safe fixes
gjsify fix --no-write    # report only, don't modify
```

| Option | Default | Description |
|---|---|---|
| `[paths..]` | `.` | Files/directories to process. |
| `--write` | `true` | Apply fixes. Pass `--no-write` to report only. |
| `--config-path <path>` | walks up | biome.json path override. |
| `--verbose` | `false` | Echo resolved biome binary + args. |
