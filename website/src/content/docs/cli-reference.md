---
title: CLI Reference
description: All GJSify subcommands, flags and typical usage
---

The `@gjsify/cli` package ships the `gjsify` binary. Run it via `npx @gjsify/cli <command>` or add it as a dev dependency.

> **Tip:** `npx @gjsify/cli --help` lists all commands and flags. The output ends with a `Running on …` line showing the active runtime — `Running on Node.js v24.x.y` when invoked via the Node bin, or `Running on GJS 1.x.y (SpiderMonkey)` when running the GJS bundle.

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
| `--shebang` | bool | `false` | Prepend a target-appropriate shebang to the outfile and chmod it `0o755`: `#!/usr/bin/env -S gjs -m` for `--app gjs`, `#!/usr/bin/env node` for `--app node`. Applies to GJS and Node app builds with a single `--outfile`. |
| `--watch`, `-w` | bool | `false` | Watch source files and rebuild on change. Logs each rebuild with duration; SIGINT cleanly stops the watcher. Rejected with `--library`. Requires the npm `rolldown` engine — run under Node. |
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

### `package.json#gjsify` config reference

The `gjsify` field in `package.json` (or `.gjsifyrc.js` / `gjsify.config.mjs`) controls bundler behaviour declaratively.

#### `bundler` — Rolldown options pass-through

`bundler` is a `RolldownOptions` subset. The orchestrator applies platform-specific defaults on top.

> **`define` placement:** `define` belongs under `bundler.transform.define`, **not** at the top level of `bundler`. If you write `bundler.define` (a common mistake when flat-renaming the old `esbuild` key), GJSify auto-maps it to `bundler.transform.define` and emits a build-time warning. To suppress the warning, move it:
>
> ```jsonc
> // ❌ silently wrong without the alias — now warned + auto-fixed
> { "gjsify": { "bundler": { "define": { "__APP_ID__": "\"org.example.App\"" } } } }
>
> // ✓ canonical
> { "gjsify": { "bundler": { "transform": { "define": { "__APP_ID__": "\"org.example.App\"" } } } } }
> ```

#### `loaders` — custom extension → loader kind

Map of file extension (with leading `.`) to a loader kind. Rolldown does not classify unknown extensions natively; without a loader it tries to parse them as JS and fails.

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

| Kind | Output | Use case |
|---|---|---|
| `'text'` | `export default "<file contents>"` | GLSL shaders, GtkBuilder `.ui` XML, assembly source, etc. |
| `'dataurl'` | `export default "data:<mime>;base64,<b64>"` | Images for Excalibur `ImageSource`, any API that accepts a data: URL string |

MIME inference for `'dataurl'`: `.png` → `image/png`, `.jpg`/`.jpeg` → `image/jpeg`, `.gif` → `image/gif`, `.svg` → `image/svg+xml`, `.webp` → `image/webp`, `.wasm` → `application/wasm`, all others → `application/octet-stream`.

Replaces the legacy `esbuild.loader` option — migration: `esbuild: { loader: { '.png': 'dataurl', '.glsl': 'text' } }` → `loaders: { '.png': 'dataurl', '.glsl': 'text' }`.

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

## `gjsify test`

Build + run the package's `src/test.mts` aggregator on GJS and Node and aggregate the results. Replaces the per-package `build:test:{gjs,node}` + `test:{gjs,node}` + `test` script boilerplate.

```bash
# Default: build + run on both runtimes, aggregate exit codes
npx @gjsify/cli test

# Only one runtime
npx @gjsify/cli test --runtime gjs
npx @gjsify/cli test --runtime node

# Skip building (assume bundles already exist)
npx @gjsify/cli test --no-build

# Force rebuild even if bundles look fresh
npx @gjsify/cli test --rebuild
```

| Option | Default | Description |
|---|---|---|
| `--runtime <gjs\|node\|all>` | `all` | Which runtime(s) to build + run. |
| `--entry <path>` | `gjsify.test.entry` or `src/test.mts` | Test entry. |
| `--outdir <path>` | `gjsify.test.outdir` or `dist/` | Where to write `test.{gjs,node}.mjs`. |
| `--rebuild` | `false` | Always rebuild, even when outputs look fresh (mtime-based check). |
| `--build` | `true` | Build before running. `--no-build` skips when bundles already exist. |
| `--verbose` | `false` | Resolved entry/outdir + per-step timing. |

`package.json#gjsify.test` configures defaults declaratively:

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

The test entry typically aggregates [`@gjsify/unit`](https://www.npmjs.com/package/@gjsify/unit) suites:

```ts
// src/test.mts
import { run } from '@gjsify/unit';
import myFeature from './my-feature.spec.js';
import other from './other.spec.js';
run({ myFeature, other });
```

Output: per-runtime summary line, e.g. `[gjsify test] ✅ gjs (412ms)  ✅ node (88ms)`. Exit code is non-zero whenever any runtime build or run fails.

## `gjsify run`

Run a built GJS bundle. Automatically sets `LD_LIBRARY_PATH` and `GI_TYPELIB_PATH` for native prebuilds.

```bash
npx @gjsify/cli run dist/index.js
```

| Argument | Description |
|---|---|
| `<target>` | A GJS bundle file to run, **or** a script name from the current `package.json` |
| `[args..]` | Extra arguments passed through to the script / `gjs` |
| `-w, --workspace <name>` | Run `<target>` as a script in the named workspace (by package name or path), like `npm run <script> -w <name>` |
| `--runtime <gjs\|node\|bun\|deno>` | Runtime to launch a bundle **file** on. Forces file mode. Default `gjs`. |

If `<target>` resolves to a file on disk (or has a path-like prefix), it is launched via `gjs`. Otherwise it is looked up in the current `package.json`'s `scripts` (yarn-run-style).

```bash
gjsify run start              # run the `start` script from ./package.json
gjsify run build -w cli       # run the `build` script in the `cli` workspace
```

### `--runtime` — run a bundle on gjs / node / bun / deno

`--runtime` selects which runtime launches a **built bundle file**, generalizing the
`gjsify storybook --runtime` mechanism. `gjs` (default) runs a `--app gjs` bundle via
`gjs -m`; `node`/`bun`/`deno` run a `--app node` bundle — the **same** bundle for all
three, since Node-API is their common ABI (bun/deno reuse the node build). Native typelib
env is wired exactly as for `gjs`, and `@gjsify/node-gi` is required only when the bundle
actually uses `gi://`.

```bash
gjsify build src/app.ts --app gjs  --outfile dist/app.gjs.mjs
gjsify build src/app.ts --app node --outfile dist/app.node.mjs

gjsify run --runtime gjs  dist/app.gjs.mjs    # gjs -m
gjsify run --runtime node dist/app.node.mjs   # node
gjsify run --runtime bun  dist/app.node.mjs   # bun — same node bundle
gjsify run --runtime deno dist/app.node.mjs   # deno run -A --node-modules-dir=manual
```

Passing `--runtime` forces file mode (it beats the script-name lookup). If the current
`package.json` declares [`gjsify.example.runtimes`](#per-example-runtime-declaration), the
requested runtime is validated against it — a runtime the example doesn't support fails with
a clear, actionable message instead of a bundle crash.

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
| `--cached` | `GJSIFY_BUILD_CACHE=1` | Content-hash build cache: skip workspaces whose inputs are unchanged and restore their stored outputs instead (script mode only). See [Build cache](#build-cache---cached). |
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

| Option | Default | Description |
|---|---|---|
| `-d`, `--with-dependencies` | `false` | First run the same script in every transitive workspace dependency (topological order); deps without the script are skipped. |
| `--include-dev` | `false` | With `-d`, also walk `devDependencies`. |
| `--continue-on-error` | `false` | With `-d`, keep running remaining deps after one fails. |
| `--cached` | `GJSIFY_BUILD_CACHE=1` | Content-hash build cache — see [Build cache](#build-cache---cached). |
| `-v`, `--verbose` | `false` | Echo every spawned command. |

### Build cache (`--cached`)

With `--cached` (or `GJSIFY_BUILD_CACHE=1`; explicit `--no-cached` wins), `gjsify foreach <script>` and `gjsify workspace <name> <script>` skip workspaces whose build inputs are unchanged and restore the previously stored outputs instead of re-running the script.

```bash
gjsify foreach build -tp --cached          # rebuild only what changed
GJSIFY_BUILD_CACHE=1 gjsify run build      # opt in a whole root script chain
```

- **Key** — sha256 over the script name + forwarded args, a toolchain salt (the workspace-resolved `@gjsify/cli`, `@gjsify/tsc`, `rolldown` and `typescript` versions), the package's own input hash (`src/**`, `package.json`, root `tsconfig*.json` — real file contents, sorted) and the input hashes of its full transitive workspace-dependency closure. Editing a dependency re-runs every dependent.
- **Storage** — `node_modules/.cache/gjsify/build/<pkg>/<key>/`, at most 2 keys per package (oldest evicted).
- **Outputs** — only the conventional output dirs (`lib/`, `dist/`, `dist-templates/`) that the script *actually modified* are stored; a cache hit replaces exactly those dirs and nothing else. A package that does not define the script — or a committed, no-build `lib/` the script never touches — is never written to.
- Script mode only (`--exec` is rejected); any cache error falls back to running the script uncached.

## `gjsify check`

Run TypeScript type-checks (`tsc --noEmit`) across the current workspace. Symmetric peer of `gjsify format` / `lint` / `fix`.

```bash
npx @gjsify/cli check                              # default: workspace-wide, parallel
npx @gjsify/cli check --include '@gjsify/process'  # filter to one package
npx @gjsify/cli check --no-parallel --verbose      # sequential with per-workspace output
```

Behaviour:

- **In a workspace root**: walks every package whose `package.json#scripts.check` is defined (`@girs/*` always excluded), runs `npm run check` in each, aggregates exit codes. Parallel by default with `os.cpus().length` workers; `--jobs N` caps it, `--no-parallel` switches to sequential.
- **In a single package** (cwd inside a workspace package with a `check` script): runs that package's `check` script directly. Useful for `npm run check` ergonomics from `gjsify`.

Exits with code **1** if any workspace's check fails; **0** if all pass. With `--no-parallel`, exits with the first non-zero code; with `--parallel` (default), prints a summary of failed workspaces.

| Option | Default | Description |
|---|---|---|
| `--include <glob>` | (all) | Repeatable. Only run in workspaces matching these glob patterns. |
| `--exclude <glob>` | `@girs/*` | Repeatable. Skip workspaces matching these glob patterns. |
| `--parallel`, `-p` | `true` | Run workspace checks in parallel. `--no-parallel` for sequential. |
| `--jobs N`, `-j N` | `os.cpus().length` | Max parallel workers when `--parallel`. |
| `--verbose` | `false` | Log per-workspace command before spawning. |

## `gjsify system-check`

Verify that required system dependencies are installed.

```bash
npx @gjsify/cli system-check
```

Reports an install command for your detected package manager when something is missing. Exits with code **1** if any required dependency is missing.

> **Note:** Previously called `gjsify check`. The bare name was repurposed for workspace TypeScript checks (see above).

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
npx @gjsify/cli system-check --json
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
| `--runtime <gjs\|node\|bun\|deno>` | `gjs` | Runtime to run the showcase on. |

### `--runtime` — run a showcase off GJS

`gjs` (default) runs the showcase's GJS bundle via `gjsify dlx` (unchanged). `node`/`bun`/`deno`
resolve the showcase's `--app node` bundle and run it on that runtime — the Node-API showcases
(`showcases/node/*`). The runtime is validated against the showcase's
[`gjsify.example.runtimes`](#per-example-runtime-declaration) declaration: a GTK/Adw showcase
requested under `node` fails with a clear message rather than crashing.

```bash
gjsify showcase express-webserver                  # GJS (default)
gjsify showcase express-webserver --runtime node   # the --app node bundle, on Node.js
gjsify showcase express-webserver --runtime bun    # same node bundle, on Bun
gjsify showcase express-webserver --runtime deno   # same node bundle, on Deno
```

### Per-example runtime declaration

An example/showcase MAY declare which runtimes it supports, so `--runtime` validates the request
instead of failing deep in a bundle it can't run:

```jsonc
// package.json
"gjsify": {
  "example": {
    "runtimes": ["gjs", "node", "bun", "deno"], // supported runtimes (optional; omitted = permissive)
    "node": "dist/app.node.mjs"                 // explicit --app node bundle path (optional; else derived)
  }
}
```

`runtimes` is optional and back-compat — a package without it runs on any requested runtime. A
GTK/Adw showcase declares `["gjs"]` so `--runtime node` errors cleanly (node-gi has no GTK layer
yet). When `node` is omitted, the node bundle is derived from the GJS entry by convention
(`dist/<name>.gjs.js` → `dist/<name>.node.mjs`).

## `gjsify storybook`

Discover every `*.story.ts` in the project and launch the GTK/Adwaita component browser from [`@gjsify/storybook`](https://www.npmjs.com/package/@gjsify/storybook) — a sidebar grouped by category, a live preview pane, and an auto-generated controls panel. No per-project storybook *application* to maintain.

```bash
gjsify storybook                       # discover src/**/*.story.ts and launch
gjsify storybook --stories packages    # scan a different directory
gjsify storybook --watch               # rebuild + relaunch on story change
```

| Option | Default | Description |
|---|---|---|
| `--stories <dir>` | `src` or `gjsify.storybook.stories` | Directory scanned recursively for `*.story.ts`. |
| `--app-id <id>` | `gjsify.storybook.applicationId` or derived from the package name | GApplication id. |
| `--title <text>` | — | Window title. |
| `--globals <value>` | `auto` | Value for `gjsify build --globals` (use `auto,dom` for canvas/DOM stories). |
| `--out <path>` | `node_modules/.cache/gjsify-storybook` | Output bundle path. |
| `--watch` | `false` | Rebuild and relaunch when a story file changes. |
| `--build-only` | `false` | Build the bundle but do not launch it. |

Configure defaults in `package.json#gjsify.storybook` (`applicationId`, `title`, `stories`, `globals`). With `GJSIFY_DEVTOOLS=1`, the storybook host also exposes the devtools control plane, so an agent can drive it via `gjsify debug --profile storybook`. See the [Debugging & remote control guide](./guides/devtools/).

## `gjsify debug`

Launch an **MCP↔devtools bridge** for a running, devtools-enabled GJSify app (its `org.gjsify.Devtools` DBus control plane). An MCP client (e.g. Claude Code) uses this as its server command; the bridge speaks JSON-RPC on stdio and translates each tool call to the app's DBus interface. Provided by [`@gjsify/devtools-mcp`](https://www.npmjs.com/package/@gjsify/devtools-mcp).

```bash
# Point an MCP client at it (.mcp.json):
#   { "mcpServers": { "my-app": { "command": "gjsify", "args": ["debug", "--bus-name", "org.example.App"] } } }

gjsify debug --bus-name org.example.App         # generic profile
gjsify debug --profile storybook                # storybook tools (list/open/set-arg/screenshot)
gjsify debug --build-only --out dist/bridge.gjs.mjs   # build once; point .mcp.json at the bundle
```

| Option | Default | Description |
|---|---|---|
| `--bus-name <name>` | `gjsify.devtools.busNameBase`, or the storybook/browser app-id | App DBus base name. |
| `--profile <kind>` | auto | `generic` \| `storybook` \| `browser` \| `cdp`. Auto: `storybook` if `@gjsify/storybook` is a dep, `browser` if `@gjsify/devtools-browser` is, `cdp` if `@gjsify/devtools-cdp` is, else `generic`. |
| `--globals <value>` | `auto` | Value for `gjsify build --globals`. |
| `--out <path>` | `node_modules/.cache/gjsify-debug` | Output bundle path. |
| `--build-only` | `false` | Build the bridge bundle but do not launch it (for a `.mcp.json` command pointing at the bundle). |

> **MCP cleanliness:** `gjsify debug` logs **only to stderr** — stdout is the JSON-RPC channel. The bridge resolves `@gjsify/devtools-mcp` from the *consumer's* `node_modules`. Full workflow: [Debugging & remote control guide](./guides/devtools/).

## `gjsify browse`

Launch the minimalist **Adwaita web browser** from [`@gjsify/devtools-browser`](https://www.npmjs.com/package/@gjsify/devtools-browser), optionally pointed at a URL. With `--devtools` it exposes the same `org.gjsify.Devtools` control plane (browser profile), so an agent can navigate, screenshot the rendered page, eval JS, inspect elements, and read the DOM/network/accessibility trees over MCP — purpose-built for debugging gjsify-built **web** apps.

```bash
gjsify browse                              # open page:welcome
gjsify browse https://gnome.org            # open a URL
gjsify browse https://localhost:8080 --devtools   # + MCP control plane (drive via `gjsify debug --profile browser`)
```

| Option | Default | Description |
|---|---|---|
| `[url]` | `page:welcome` | Initial URL (a `page:*` built-in page or `https://…`). |
| `--app-id <id>` | `gjsify.browse.applicationId` or derived from the package name | GApplication id. |
| `--title <text>` | — | Window title. |
| `--globals <value>` | `auto,dom` | Value for `gjsify build --globals` (WebKit/iframe need DOM globals). |
| `--out <path>` | `node_modules/.cache/gjsify-browse` | Output bundle path. |
| `--devtools` | `false` | Enable the MCP devtools control plane (sets `GJSIFY_DEVTOOLS=1`). |
| `--inspector-port <n>` | — | Enable WebKit's remote inspector protocol on this port + the `Cdp*` deep-protocol methods (implies `--devtools`). |
| `--build-only` | `false` | Build the bundle but do not launch it. |

The browser is built on [`@gjsify/iframe`](https://www.npmjs.com/package/@gjsify/iframe) (a `WebKit.WebView` postMessage bridge). With `--inspector-port`, it also sets `WEBKIT_INSPECTOR_HTTP_SERVER` and exposes the [`@gjsify/devtools-cdp`](https://www.npmjs.com/package/@gjsify/devtools-cdp) `Cdp*` methods (`CdpDiscoverTargets` / `CdpConnect` / `CdpSend` / `CdpDrainEvents`) over the control plane — the deep Runtime/DOM/CSS/Network/Console/Debugger protocol. See the [Debugging & remote control guide](./guides/devtools/) for the agent workflow.

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

Before running, `gjsify showcase` calls `gjsify system-check` to verify system dependencies.

## `gjsify flatpak`

Subcommand group for shipping GJS apps and CLIs as Flatpaks. Eight subcommands:

| Subcommand | Purpose |
|---|---|
| `flatpak init` | Scaffold the full Flathub-ready asset set: manifest JSON + MetaInfo XML + `.desktop` (apps only) + `flathub.json` |
| `flatpak check` | Run `appstreamcli validate --strict` + `flatpak-builder-lint manifest` locally |
| `flatpak build` | Wrap `flatpak-builder` with sensible defaults |
| `flatpak deps` | Wrap `flatpak-node-generator` to produce the offline npm cache |
| `flatpak ci` | Scaffold `.github/workflows/flatpak.yml` matching the Flathub action shape |
| `flatpak sync-flathub` | After cutting a release, sync the per-app `flathub/<app-id>` tracking-repo manifest to the new git tag + commit |
| `flatpak diff` | Compare the local git state to the per-app Flathub tracking-repo manifest; surface version drift |
| `flatpak release` | Cut a release end-to-end: chain init + check + tag + sync-flathub |

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

### `gjsify flatpak sync-flathub`

Sync the per-app `flathub/<app-id>` tracking-repo manifest to a new git tag + commit. Flathub publishes each app from a separate repo whose manifest pins the upstream `tag` + `commit`; after cutting a release in your source repo, this command updates that pin and (optionally) opens the PR.

```bash
# Use the latest local git tag + its commit; auto-resolves flathub-repo from appId
npx @gjsify/cli flatpak sync-flathub

# Explicit tag + commit
npx @gjsify/cli flatpak sync-flathub --version v0.6.6 --commit 1a2b3c4d…

# Show resolution without writing or invoking git/gh
npx @gjsify/cli flatpak sync-flathub --version v0.6.6 --dry-run

# Local clone + commit only — skip push + PR
npx @gjsify/cli flatpak sync-flathub --version v0.6.6 --no-pr
```

| Option | Default | Description |
|---|---|---|
| `--version <tag>` | `git describe --tags --abbrev=0` in cwd | Git tag to sync to. |
| `--app-id <id>` | `gjsify.flatpak.appId` | Reverse-DNS app id (used to locate the manifest in the flathub-repo). |
| `--flathub-repo <owner/name>` | `gjsify.flatpak.flathubRepo` or `flathub/<app-id>` | Tracking-repo. |
| `--commit <sha>` | `git rev-list -n 1 <version>` in cwd | Pin to this commit. |
| `--branch <name>` | `update-to-<version>` | Branch name in the flathub-repo. |
| `--source-index <n>` | first `type: git` source | Which `modules[0].sources[]` entry to update (for manifests with multiple sources). |
| `--no-pr` | open PR | Skip `gh pr create`, also skip `git push` (local commit only). |
| `--dry-run` | `false` | Report resolution + intended branch + commit, touch no files. |
| `--verbose` | `false` | Echo every `git` / `gh` invocation. |

**Workflow:**
1. Clones (or updates) `flathub/<app-id>` into `$XDG_CACHE_HOME/gjsify/flathub-sync/`.
2. Surgically edits `modules[0].sources[<i>]` — sets `tag` + `commit`, injects an `x-checker-data` block if missing (so Flathub's auto-update bot can pick up future releases).
3. Preserves the manifest's original 2-space indent + key ordering.
4. Creates branch `update-to-<version>`, commits, pushes, opens a PR via `gh pr create`.

Requires `git` (always) and `gh` (unless `--no-pr`). Both surface install hints on `ENOENT`. Idempotent: re-running with the same `--version` is a no-op when the manifest is already pinned.

**`gjsify.flatpak.flathubRepo`** in `package.json#gjsify.flatpak` overrides the default `flathub/<app-id>` derivation for repos that don't follow the convention.

### `gjsify flatpak diff`

Compare the local git state against the per-app Flathub tracking-repo manifest and surface version drift before publishing.

```bash
# Fetch flathub manifest, compare local latest tag against pinned tag
npx @gjsify/cli flatpak diff

# Compare against an explicit version
npx @gjsify/cli flatpak diff --version v0.6.6

# Compare against a local file (offline / CI)
npx @gjsify/cli flatpak diff --against ./flathub/<app-id>.json

# Print the full flathub source entry
npx @gjsify/cli flatpak diff --detail
```

| Option | Default | Description |
|---|---|---|
| `--version <tag>` | `git describe --tags --abbrev=0` in cwd | Local version to compare against. |
| `--app-id <id>` | `gjsify.flatpak.appId` | Reverse-DNS app id. |
| `--flathub-repo <owner/name>` | `gjsify.flatpak.flathubRepo` or `flathub/<app-id>` | Tracking-repo to fetch from. |
| `--against <path>` | — | Read a local manifest instead of fetching. |
| `--detail` | `false` | Also print the full flathub manifest source entry. |
| `--source-index <n>` | first `type: git` source | Which `modules[0].sources[]` entry to inspect. |
| `--verbose` | `false` | Echo fetch URL + resolved values. |

Exit 0 when the local tag matches the flathub-pinned tag; exit 1 on drift with a hint at the exact `gjsify flatpak sync-flathub` command that would fix it.

### `gjsify flatpak release`

Cut a release end-to-end: chain `flatpak init` (regenerate assets) → `flatpak check` (lint locally) → `git tag` (+ push) → `flatpak sync-flathub` (open the Flathub PR). One command for the maintainer flow that otherwise spans four manual invocations.

```bash
# Full chain
npx @gjsify/cli flatpak release v0.6.6

# Show the plan without running anything
npx @gjsify/cli flatpak release v0.6.6 --dry-run

# Tag was already created
npx @gjsify/cli flatpak release v0.6.6 --skip-tag
```

| Option | Default | Description |
|---|---|---|
| `<version>` | — | **Required.** Release tag, e.g. `v0.6.6`. |
| `--skip-init` | `false` | Skip the `flatpak init --force` regen step. |
| `--skip-check` | `false` | Skip the `flatpak check` linter step. |
| `--skip-tag` | `false` | Skip `git tag` + `git push origin <version>`. |
| `--push-tag` | `true` | Whether to push the created tag (only relevant without `--skip-tag`). |
| `--flathub-repo <owner/name>` | — | Override forwarded to `sync-flathub`. |
| `--dry-run` | `false` | Print the plan, take no action. |
| `--verbose` | `false` | Echo every sub-command invocation. |

The orchestrator runs `init` + `check` **before** creating the tag — if either fails, no tag is created (the release is aborted, not half-released).

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

Scaffold an `install.mjs` for your own GJS-runnable npm package — your users get the same `curl ... | gjs -m -` install story as GJSify itself.

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

The generated `install.mjs` is a verbatim copy of GJSify's own root `install.mjs` with three constants substituted (`DEFAULT_TARGET`, `DEFAULT_BIN_NAME`, `DEFAULT_BOOTSTRAP_URL`). See the [Distributing GJS apps guide](/guides/distributing-gjs-apps/) for the full publication workflow.

| Option | Default | Description |
|---|---|---|
| `[target]` (positional) | `package.json#name` | npm package to install. |
| `--bin-name <name>` | first key of `gjsify.bin` or `bin` | Bin name produced by the installer. |
| `--bootstrap-url <url>` | GJSify GH `releases/latest/download/cli.gjs.mjs` | Override the bootstrap bundle source. |
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

| Option | Default | Description |
|---|---|---|
| `<packages..>` (positional) | — | One or more package names. |
| `--global` / `-g` | `false` | Required; removes from `defaultGlobalLayout()` paths. |
| `--dry-run` | `false` | Print "would remove" lines, touch no files. |
| `--verbose` | `false` | Surface inspection failures (rare). |

Exits non-zero when nothing was removed (no matching install found).

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
gjsify publish --access public --otp 123456     # first publish with 2FA OTP (Node-free bootstrap)
gjsify publish --tolerate-republish             # treat 409 conflict as success
gjsify publish --dry-run                        # pack only, don't PUT
```

| Option | Default | Description |
|---|---|---|
| `[path]` | `cwd` | Workspace path to publish. |
| `--tag <tag>` | `latest` | npm dist-tag. |
| `--access <kind>` | — | `public` or `restricted` (required on first publish of scoped packages). |
| `--otp <code>` | — | npm 2FA one-time code; forwarded as the `npm-otp` HTTP header on the PUT request. Required for manual publishes from a 2FA-enabled npm account. If the registry responds with `401 OTP-required` and `--otp` was not supplied: on an interactive TTY the CLI prompts once and retries; on a non-TTY it exits non-zero with an actionable message. |
| `--tolerate-republish` | `false` | Treat a 409 conflict (version already published) as success. Matches `yarn --tolerate-republish`. |
| `--provenance` | `false` | Recorded in payload but no signing happens (no sigstore signer yet). |
| `--dry-run` | `false` | Pack only, do not PUT. |
| `--json` | `false` | Emit publish metadata as JSON. |

Combine with [`gjsify foreach`](#gjsify-foreach) to publish every workspace in one go:

```bash
gjsify foreach --no-private --exec -- gjsify publish --tag latest --access public
```

## `gjsify onboard`

Ensure **every** publishable `@gjsify/*` workspace is both **published** on npm and has a **Trusted Publisher** configured for this repo's `release.yml` — doing the minimum work. It folds the whole manual first-publish + Trusted-Publisher bootstrap into a single idempotent sweep:

1. **Auth gate** — runs the `whoami` liveness check first. If the token is live, it proceeds without asking for credentials; only when the token is dead/missing does it run the [`gjsify login`](#gjsify-login) flow (or fail clearly under `--yes` on a non-TTY).
2. **Enumerate** the publishable workspaces (non-private, excluding `@girs/*`).
3. **Determine each package's state concurrently** (bounded) by reading npm's Trusted-Publisher config: unpublished / published-but-untrusted / published-and-trusted. Reads never prompt for 2FA.
4. **Act on the gaps, minimally** — build + `publish --access public` each unpublished package, then configure its Trusted Publisher; configure a published-but-untrusted one; skip an already-done one.
5. **One shared OTP** — a single 2FA code is reused across every publish + trust operation (cache-first: the cached code is tried before prompting). A whole sweep of N packages typically needs you to type an OTP **once**, never once-per-package.

Re-running when everything is already published + trusted does nothing and exits 0.

```bash
gjsify onboard                       # publish + trust every missing package (prompts for OTP once)
gjsify onboard --dry-run             # report the plan; change nothing
gjsify onboard --otp 123456          # seed the shared 2FA code (no prompt if it stays valid)
gjsify onboard --json                # machine-readable summary object as the final stdout line
gjsify onboard --yes                 # non-interactive: fail clearly if a login/OTP is needed
```

| Option | Default | Description |
|---|---|---|
| `--repository <owner/repo>` | inferred from `origin` | GitHub repo the Trusted Publisher is scoped to. |
| `--workflow <file>` | `release.yml` | Workflow filename allowed to publish via OIDC (basename only). |
| `--environment <env>` | — | Optional GitHub Actions environment the workflow must run in. |
| `--registry <url>` | scope-aware `.npmrc` | Registry override. |
| `--otp <code>` | — | Seeds the shared 2FA code; prompted once on demand if omitted and a challenge occurs. |
| `--concurrency <n>` | `8` | How many packages to probe (read state) in parallel. |
| `--dry-run` | `false` | Report the plan without publishing or configuring anything. |
| `--json` | `false` | Emit a machine-readable summary object as the final stdout line. |
| `--yes` | `false` | Non-interactive: never prompt. Fail clearly if a login or an OTP is required and not supplied via flags. |

## `gjsify format`

Format JS/TS source files via [oxfmt](https://oxc.rs/docs/guide/usage/formatter) (oxc's formatter). Dual-engine:

- **Under GJS** (the `gjs -m cli.gjs.mjs` bundle), GJSify prefers the `@gjsify/oxfmt-native` GI bridge — the full oxfmt CLI runs in-process, **Node-free** (config resolution, ignore handling, file walking, `--write`/`--check`/`--list-different` all included). Override with `GJSIFY_OXFMT=npm` (force the Node launcher) or `GJSIFY_OXFMT=native` (error instead of falling back when the prebuild is unavailable).
- **On Node** (or when the native prebuild is missing), GJSify resolves oxfmt's npm package Node launcher from `node_modules/oxfmt/bin/oxfmt` and spawns it with the current Node executable. The per-platform native code ships as the `@oxfmt/binding-<target>` napi optionalDependency.

> **CSS/JSON formatting is not supported.** oxfmt formats JS/TS (+TOML) only. The previous Biome toolchain formatted CSS and JSON too; that is intentionally dropped in the oxc migration and not replaced by another formatter.

```bash
gjsify format --init             # write recommended .oxlintrc.json + .oxfmtrc.json
gjsify format --write src/       # apply formatter in place
gjsify format --check src/       # CI mode — exit non-zero on drift
gjsify format src/               # report drift without writing (list-different)
```

| Option | Default | Description |
|---|---|---|
| `[paths..]` | `.` | Files/directories to format. |
| `--write` | `false` | Apply changes in place. |
| `--check` | `false` | CI-mode: report drift + stats, exit non-zero (does not write). |
| `--config-path <path>` | walks up | Path to an `.oxfmtrc.json`. Default: nearest `.oxfmtrc.json` from cwd or workspace root. |
| `--init` | `false` | Write recommended `.oxlintrc.json` + `.oxfmtrc.json` into cwd (skips existing unless `--force`). |
| `--force` | `false` | Used with `--init` to overwrite existing config files. |
| `--verbose` | `false` | Echo the resolved oxfmt launcher + args before spawning. |

With no `--write`/`--check`, `gjsify format` reports drift via oxfmt's `--list-different` without modifying files.

**Workspace-aware resolution** — when run from inside a sub-workspace, GJSify walks up to the workspace root to find `node_modules/oxfmt/bin/oxfmt`. A single `.oxfmtrc.json` at the workspace root applies everywhere oxfmt discovers it.

**Standalone projects** — same shape, single `.oxfmtrc.json` at the project root.

### Recommended config defaults

`gjsify format --init` writes two config files tuned for GJS/GNOME projects:

`.oxfmtrc.json` (formatter):
- 4-space indent (spaces, not tabs), single quotes, semicolons-always, trailing commas `all`, arrow parens `always`, printWidth 120, bracket spacing on (matches the GJSify codebase + GNOME Shell style guide).
- Excludes generated artifacts (`dist`, `lib`, `cli.gjs.mjs`, `test.{gjs,node}.mjs`), Flatpak build dirs, `refs/` submodules, prebuilds, compiled `.metainfo.xml`.

`.oxlintrc.json` (linter):
- `categories.correctness: "error"` (oxlint's correctness set) plus:
  - `typescript/no-non-null-assertion: off` — `!` operator needed for `@girs/*` API surfaces
  - `typescript/no-explicit-any: warn` (not error) — `as unknown as T` chains in cross-runtime polyfills
  - `typescript/consistent-type-imports: warn`
  - `unicorn/prefer-node-protocol: error` — enforce `node:` import protocol
  - `eslint/no-unused-vars: warn`
- Same exclude set as the formatter config.

**Errors when oxfmt is missing:** prints `[gjsify oxc] oxfmt not found.` with `gjsify install -D oxfmt` as the install hint, exits 1.

## `gjsify lint`

Run [oxlint](https://oxc.rs/docs/guide/usage/linter) diagnostics. Default reports findings (exit non-zero); `--fix` applies safe fixes in place. oxlint is spawned via its Node launcher (`node_modules/oxlint/bin/oxlint`) so its JS-plugin host — including GJSify's internal `gjsify/register-class-order` rule — is available.

```bash
gjsify lint              # lint all
gjsify lint src/         # lint specific paths
gjsify lint --fix        # apply safe fixes (skips unsafe)
```

| Option | Default | Description |
|---|---|---|
| `[paths..]` | `.` | Files/directories to lint. |
| `--fix` | `false` | Apply safe lint fixes in place. |
| `--config-path <path>` | walks up | `.oxlintrc.json` path override. |
| `--verbose` | `false` | Echo resolved oxlint launcher + args. |

Use `gjsify fix` for the combined format + safe-lint-fix pass.

### Internal lint rule: `gjsify/register-class-order`

GJSify ships an internal oxlint JS plugin (`@gjsify/oxlint-plugin-gjsify`, not published to npm) with one rule, wired into the workspace `.oxlintrc.json` via `jsPlugins`. It flags `static` GObject metadata fields (`GTypeName`, `Properties`, `InternalChildren`, `Signals`, `Template`, `CssName`, …) declared **after** a `static { GObject.registerClass(…) }` block — where `registerClass` runs before the field is assigned, so the metadata is silently ignored — and autofixes by hoisting those fields above the static block. (GNOME/gjs#704, gjsify/ts-for-gir#410.)

## `gjsify fix`

Combined fix pass: `oxfmt --write` (format JS/TS) followed by `oxlint --fix` (safe lint fixes). Different from `gjsify system-check` (which verifies system dependencies) and `gjsify check` (the tsc orchestrator).

```bash
gjsify fix               # default: format + apply all safe lint fixes
gjsify fix --no-write    # report only, don't modify
```

| Option | Default | Description |
|---|---|---|
| `[paths..]` | `.` | Files/directories to process. |
| `--write` | `true` | Apply fixes. Pass `--no-write` to report only. |
| `--config-path <path>` | walks up | `.oxlintrc.json` / `.oxfmtrc.json` path override. |
| `--verbose` | `false` | Echo resolved oxc launchers + args. |

## `gjsify upgrade`

Drop-in replacement for `yarn upgrade-interactive` / `npx npm-check-updates`. Checks the npm registry for newer versions of declared dependencies and updates `package.json` accordingly. Interactive prompt by default; `--latest` / `--minor` / `--patch` switch to non-interactive bulk-update mode.

`@gjsify/*` packages ship as a single release train — upgrade them together (`gjsify upgrade --latest --filter @gjsify`); see [Versioning & Compatibility](/gjsify/versioning/).

```bash
gjsify upgrade                          # interactive: pick which to upgrade
gjsify upgrade --latest                 # non-interactive: bump every dep to latest (allows major)
gjsify upgrade --minor                  # skip major bumps (semver-minor + patch only)
gjsify upgrade --patch                  # patches only
gjsify upgrade --latest --dry-run       # print plan, don't write
gjsify upgrade --filter '@gjsify,vite'  # narrow scope by substring
gjsify upgrade -y                       # interactive-all (no prompt, select everything)
```

Workspace-aware: `workspace:`, `file:`, `link:`, `git:`, `git+`, `http(s):`, `npm:`, `*`, `latest` ranges are skipped — those are not external npm dependencies. Range prefix is preserved (`^1.2.3` → `^2.0.0`, `~0.4.0` → `~0.5.0`).

The registry URL is resolved from `~/.npmrc` → `<cwd>/.npmrc`, with `npm_config_registry` env var overriding both. Scope-specific registries + auth tokens from `.npmrc` are honored.

| Option | Default | Description |
|---|---|---|
| `--latest` | `false` | Non-interactive bulk-update — allows major bumps. |
| `--minor` | `false` | Non-interactive — semver-minor + patch only. |
| `--patch` | `false` | Non-interactive — semver-patch only. |
| `--filter <substring>` | — | Comma-separated list of substrings (case-insensitive) to match against package names. |
| `--dry-run` | `false` | Print upgrade plan, don't write `package.json`. |
| `--yes` / `-y` | `false` | In interactive mode, select all candidates without prompting. |
| `--cwd <path>` | `process.cwd()` | Project directory. |
| `--verbose` | `false` | Print resolution details. |

Output is a color-coded table (red=major, yellow=minor, green=patch, cyan=prerelease) listing every dependency with a newer version available. After write-back, `gjsify install` must be run to actually fetch the new versions.
