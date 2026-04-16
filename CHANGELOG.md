# Changelog

## [0.1.13](https://github.com/gjsify/gjsify/compare/v0.1.12...v0.1.13) (2026-04-16)

### Features

* **infra:** lower CSS Nesting for GTK4 via esbuild target=firefox60 ([#22](https://github.com/gjsify/gjsify/issues/22)) ([3c946c3](https://github.com/gjsify/gjsify/commit/3c946c35392af475fd1c539bf3734695073381af))

## [0.1.12](https://github.com/gjsify/gjsify/compare/v0.1.11...v0.1.12) (2026-04-16)

### Features

* **infra:** @gjsify/esbuild-plugin-css — resolve CSS [@import](https://github.com/import) at build time ([#21](https://github.com/gjsify/gjsify/issues/21)) ([812276a](https://github.com/gjsify/gjsify/commit/812276a32c9f2b659a63eef242a6236346feeee9))

## [0.1.11](https://github.com/gjsify/gjsify/compare/v0.1.10...v0.1.11) (2026-04-15)

### Features

* **cli:** GJS app packaging — --shebang + gresource + gettext ([#18](https://github.com/gjsify/gjsify/issues/18)) ([fe267c4](https://github.com/gjsify/gjsify/commit/fe267c41596cb22385cbab3a24c1b08a4747160d))
* **create-app:** multi-template scaffolding with 7 starter templates ([#16](https://github.com/gjsify/gjsify/issues/16)) ([7a97c8f](https://github.com/gjsify/gjsify/commit/7a97c8f5009059bddb4e2c8934de122f3e092701))
* **examples:** update start script to use 'yarn start:gjs' ([2ddecca](https://github.com/gjsify/gjsify/commit/2ddeccaed242328b5107b9f8091252443ac95e6d))

### Bug Fixes

* **dom,event-bridge:** close input gaps surfaced by Excalibur in GJS ([#17](https://github.com/gjsify/gjsify/issues/17)) ([f9f01da](https://github.com/gjsify/gjsify/commit/f9f01da2ab18871158738762a52ba8639708304c))

## Unreleased

### Features

* **webrtc:** new `@gjsify/webrtc` package — W3C WebRTC API skeleton on top of GStreamer `webrtcbin`. Ships the full JS surface: `RTCPeerConnection` (ctor + synchronous state getters + all `on<event>` attribute handlers), `RTCDataChannel`, `RTCSessionDescription` (with Gst ↔ JS roundtrip via GstSDP), `RTCIceCandidate` (RFC 5245 candidate-line parser), `RTCError` (extends DOMException), `RTCPeerConnectionIceEvent`, `RTCDataChannelEvent`, `RTCErrorEvent`. Wires `globalThis.RTC*` via granular register subpaths (`@gjsify/webrtc/register/{peer-connection,data-channel,error}`) that the `--globals auto` CLI mode auto-injects; no source-level import needed in consumer projects. Signal→event bridge, `withGstPromise` helper, and `deferToMain(GLib.idle_add)` dispatch already in place. **Known GJS limitation:** webrtcbin fires its async signals and `Gst.Promise` change_func callbacks from GStreamer's internal streaming thread — GJS blocks those JS callbacks to prevent VM corruption, so the async handshake (`createOffer`/`createAnswer`/`setLocal/RemoteDescription`) currently hangs on GJS. The fix (a native Vala/C helper that marshals webrtcbin signals through `g_main_context_invoke()`) is tracked as **Phase 1.5** in STATUS.md. Tests: 18 green (register wiring, construction, deferred-API error paths, session-description roundtrip, ICE-candidate parsing); 1 skipped (loopback). **Media tracks** (RTCRtpSender/Receiver, MediaStream, getUserMedia) deferred to Phase 2. Requires GStreamer ≥ 1.20 with `gst-plugins-bad` + `libnice-gstreamer1` (Fedora) / `gstreamer1.0-plugins-bad` + `gstreamer1.0-nice` (Ubuntu). Initial foundation work for [#14](https://github.com/gjsify/gjsify/issues/14); references: [refs/node-gst-webrtc/](refs/node-gst-webrtc/) (ISC, Ratchanan Srirattanamet) + [refs/node-datachannel/polyfill/](refs/node-datachannel/src/polyfill/) (MIT). New private example: `examples/dom/webrtc-loopback` — two local peers exchange offer/answer + ICE and echo strings/binary over a data channel (also currently blocked on the GJS streaming-thread issue; will light up with Phase 1.5).
* **infra:** `@gjsify/esbuild-plugin-css` — GTK4 CSS Nesting lowering. The GJS app target now defaults `css.target` to `['firefox60']` so esbuild lowers CSS Nesting (unsupported by GTK4's CSS parser) at build time: authored `.parent { &:hover { … } }` becomes `.parent:hover { … }` in the bundled string. Features GTK4 *does* support (`var()`, `calc()`, `:is()`, `:where()`, `:not()`) are preserved. Override via `gjsify.config.js` → `esbuild.css.target` if your GTK version accepts newer CSS. Browser + node targets still inherit the parent build's target. Demonstrated in the `adwaita-package-builder` showcase: `runtime-style.css` contains a nested `&:hover` rule; the bundled binary shows it flattened
* **infra:** new `@gjsify/esbuild-plugin-css` package. Bundles `.css` imports into a JS string at build time, resolving `@import` statements (including node_modules via `package.json#exports`) through esbuild's own resolver. Wired into `gjsify build` for GJS, browser, and node targets. Fixes the runtime GTK CSS Theme-parser warnings that occurred because `Gtk.CssProvider.load_from_string()` cannot resolve `@import "@scope/pkg/style.css"` at runtime — the imports are now resolved at build time. Config via `PluginOptions.css` (`{ minify, target }`, both default to the parent build's values)
* **showcases:** new `adwaita-package-builder` showcase — minimal Adwaita app demonstrating `gjsify gresource`, `gjsify gettext`, and `gjsify build --shebang` in a single build pipeline. Produces a directly-executable binary with an embedded GResource (CSS) and per-language `.mo` translations (de/es). Serves as the `gjsify showcase adwaita-package-builder` reference for "how to package a GJS/GNOME app with the gjsify CLI alone"

### Bug Fixes

* **cli/gettext:** `--format mo` no longer passes an invalid `--mo` flag to `msgfmt`. `msgfmt` produces a `.mo` file by default when no format flag is given; the `--mo` pseudo-flag never worked and caused every `gettext --format mo` invocation to fail with "Unbekannte Option »--mo«"
* **cli/gresource:** create the target directory automatically before invoking `glib-compile-resources`. Previously a target like `dist/app.gresource` failed with ENOENT when `dist/` did not exist, because `glib-compile-resources` writes a temp file next to the target

### Tests

* **event-bridge:** new `event-bridge.spec.ts` regression suite verifying the `motion` handler reads widget-local coords from the signal callback (NOT from `controller.get_current_event().get_position()`, which returns surface-local coords and produced a drag-jump on first move after click). Covers coord forwarding, clamping to widget allocation, and movementX/Y tracking across successive motions
* **cli-only E2E:** added coverage for `gjsify build --shebang` (shebang prepend + `chmod 0o755` + idempotence on repeated builds), `gjsify gresource` (binary bundle produced, `gresource list` lists the embedded path), and `gjsify gettext --format mo` (per-language locale tree under `<outDir>/<lang>/LC_MESSAGES/<domain>.mo`). Skips gracefully when `glib-compile-resources` / `msgfmt` are not installed

## [0.1.10](https://github.com/gjsify/gjsify/compare/v0.1.9...v0.1.10) (2026-04-11)

### Features

* **showcases:** add focus to canvas widgets on initialization ([c2a1e4b](https://github.com/gjsify/gjsify/commit/c2a1e4b932aa347e0bbd64887db18e45c9b9bdb1))
* **website:** show Express.js example first in showcase slideshow ([5d8fe22](https://github.com/gjsify/gjsify/commit/5d8fe22be38d48705e1851dc7eef2f99374755e1))
* **website:** streamline docs with Quick Start, collapsible sections and CTA ([9f8a10e](https://github.com/gjsify/gjsify/commit/9f8a10e434fcd0151ee9d71e2f1e9b71b1e2f327))

### Bug Fixes

* **website:** rename Express showcase title to express-webserver.ts ([e86b055](https://github.com/gjsify/gjsify/commit/e86b055d387e1f4e149fc3b7c152fe3a154cdd25))

## [0.1.9](https://github.com/gjsify/gjsify/compare/v0.1.8...v0.1.9) (2026-04-11)

### Features

* **build:** --globals auto — two-pass esbuild analysis ([#15](https://github.com/gjsify/gjsify/issues/15)) ([943f61c](https://github.com/gjsify/gjsify/commit/943f61c972e9b01b93f933191c60128b370cd0a4))
* **showcase:** excalibur-jelly-jumper — 2D platformer + Browser API stubs ([#13](https://github.com/gjsify/gjsify/issues/13)) ([63e7c25](https://github.com/gjsify/gjsify/commit/63e7c25046527f9cb61c32ff634e78b503cbb786))

## Unreleased (2026-04-10)

### Features

* **webaudio:** new `@gjsify/webaudio` package — Web Audio API for GJS backed by GStreamer 1.26. Implements AudioContext, decodeAudioData (MP3/WAV/OGG/FLAC via GStreamer decodebin), AudioBufferSourceNode (per-play pipeline: appsrc→audioconvert→volume→autoaudiosink), GainNode (AudioParam with setTargetAtTime), AudioBuffer (PCM Float32Array), HTMLAudioElement (canPlayType + playbin). 29 tests. Phase 1 — covers Excalibur.js audio needs
* **showcase:** add Excalibur Jelly Jumper — 2D platformer running natively on GJS/GTK4 and in the browser ([#13](https://github.com/gjsify/gjsify/pull/13)). Based on [excaliburjs/sample-jelly-jumper](https://github.com/excaliburjs/sample-jelly-jumper)
* **canvas2d:** HSL/HSLA color parsing, shadow blur approximation, pixel-perfect font rendering via FontFace + PangoCairo
* **webgl:** premultipliedAlpha support, clearBufferfv/iv/uiv/fi WebGL2 entry points, eager context init, uniform name resolution
* **dom-elements:** HTMLElement.dataset (DOMStringMap proxy), HTMLImageElement data: URI support
* **dom-elements:** stub `window.scrollX`, `window.scrollY`, `window.pageXOffset`, `window.pageYOffset` to `0`. GTK widgets have no page-scroll concept; without these stubs Excalibur's `getPosition()` computed `rect.x + undefined = NaN`, NaN-poisoning every pointer coordinate and producing a blank canvas on any drag/pan
* **dom-elements:** add `onwheel` property getter/setter to `HTMLElement`. Excalibur feature-detects wheel support via `'onwheel' in document.createElement('div')` and silently omits its wheel listener when the property is missing — previously wheel events flowed through event-bridge but never reached game code
* **event-bridge:** `motion` handler now uses widget-local coordinates from the `Gtk.EventControllerMotion::motion` signal directly, matching the coordinate frame used by `GestureClick::pressed`. Previously it pulled coords from `controller.get_current_event().get_position()` which returns surface-local coords, causing drag anchors to jump on the first move after a click
* **event-bridge:** wire keyboard input to window-level listeners
* **fetch:** support file:// URIs + root-relative URL rewrite for GJS
* **gamepad:** new `@gjsify/gamepad` package — Gamepad Web API for GJS backed by libmanette 0.2. Implements Gamepad, GamepadButton, GamepadEvent, GamepadHapticActuator (dual-rumble). Bridges libmanette's event-driven signals to W3C polling-based navigator.getGamepads(). Button/axis mapping from Manette enums to W3C standard layout. Lazy Monitor init + graceful degradation. 19 tests. Enables controller support in excalibur-jelly-jumper showcase
* **cli:** `--shebang` flag on `gjsify build` — after a successful GJS app build, prepends `#!/usr/bin/env -S gjs -m` to the outfile and sets it executable (`chmod 0o755`). Turns the bundle into a standalone, directly-executable GJS binary (e.g. `./org.myapp.Maker`) without a separate launcher script
* **cli:** new `gjsify gresource <xml>` command — thin wrapper around `glib-compile-resources` with `--sourcedir` and `--target` options. Default target is derived from the XML descriptor filename. Mirrors the meson/autotools step for packaging UI templates and assets into a binary `.gresource` bundle
* **cli:** new `gjsify gettext <poDir> <outDir>` command — wraps `msgfmt` for translation workflows. Supports `--format mo` (per-language locale tree `<outDir>/<lang>/LC_MESSAGES/<domain>.mo`, default), `xml` (metainfo template substitution via `msgfmt --template`, with optional `--remove-xml-comments`), `desktop`, and `json`. Replaces hand-rolled shell scripts in GNOME app build pipelines

### Bug Fixes

* **canvas2d:** drawImage via paint+clip, composite operation mapping
* **webgl:** offsetWidth/offsetHeight for Excalibur, extractImageData fix
* **showcase/jelly-jumper:** circular saw rotation precision, outline shader init, TypeScript type errors, MSAA disable, browser sprite rendering

### Chores

* **showcase/jelly-jumper:** clean up leftover files from original repo (.github, vite.config.ts, package-lock.json, social.jpg, .prettierrc, etc.), move assets from public/res/ to src/assets/, align structure with other showcases

## [0.1.8](https://github.com/gjsify/gjsify/compare/v0.1.7...v0.1.8) (2026-04-08)

### ⚠ BREAKING CHANGES

* **globals:** importing the root `@gjsify/<pkg>` module of a
global-providing package no longer registers globals. Callers must
explicitly import the `/register` subpath (`@gjsify/fetch/register`,
`@gjsify/abort-controller/register`, …) or use the aliased bare
specifier (`import 'fetch/register'`, `import 'abort-controller/register'`,
…). Stage 3 will add automatic injection via the esbuild plugin, so
this manual step disappears again for typical projects.

Stage 2 of the refactor plan at .claude/plans/indexed-popping-sloth.md.
* **globals:** projects that relied on `@gjsify/node-globals` to
implicitly register `fetch`, `Headers`, `Request`, `Response`,
`AbortController` or `AbortSignal` must now either import
`@gjsify/web-globals` or import the specific bare specifier
(`import 'fetch'`, `import 'abort-controller'`).

Stage 1 of the refactor plan at
.claude/plans/indexed-popping-sloth.md — next stages will introduce
`/register` subpaths and auto-injection in the esbuild plugin.

### Features

* **build:** stage 3 — auto-inject /register modules via esbuild plugin ([9f4018b](https://github.com/gjsify/gjsify/commit/9f4018bd52f0349d1fa083d9d5d192adc05b1cc4))
* **create-app:** livelier template showing Node.js + Web Crypto + Buffer ([94517d9](https://github.com/gjsify/gjsify/commit/94517d9b4bd4d7fdb77be4f02fd30be6864bd17c))
* **create-app:** template als echtes Workspace-Package ([89fecbf](https://github.com/gjsify/gjsify/commit/89fecbfe36cf853b9679cda876e0234315ef2431))
* **globals:** add node/web/dom group aliases for --globals flag ([4443779](https://github.com/gjsify/gjsify/commit/44437794ed7945d94c73c8f4041dffab53302d25))
* separate showcases from examples ([#5](https://github.com/gjsify/gjsify/issues/5)) ([086bbd0](https://github.com/gjsify/gjsify/commit/086bbd0c9f89b841b21acf13b69b0132d949eb2c)), closes [#222226](https://github.com/gjsify/gjsify/issues/222226) [#ffffff](https://github.com/gjsify/gjsify/issues/ffffff) [#3584e4](https://github.com/gjsify/gjsify/issues/3584e4) [#78aeed](https://github.com/gjsify/gjsify/issues/78aeed) [#9141ac](https://github.com/gjsify/gjsify/issues/9141ac) [#613583](https://github.com/gjsify/gjsify/issues/613583) [#c061cb](https://github.com/gjsify/gjsify/issues/c061cb) [#dc8add](https://github.com/gjsify/gjsify/issues/dc8add) [#9141ac](https://github.com/gjsify/gjsify/issues/9141ac) [#3584e4](https://github.com/gjsify/gjsify/issues/3584e4)

### Bug Fixes

* **ci:** add blueprint-compiler to release workflow prerequisites ([0184b65](https://github.com/gjsify/gjsify/commit/0184b65867bfa3428377494e81e12436a752c596))
* **ci:** add libadwaita-devel to release workflow for blueprint compilation ([dc44b34](https://github.com/gjsify/gjsify/commit/dc44b34a86d334169299333741365d850705cc78))
* **ci:** build adwaita-web SCSS before website build ([460b932](https://github.com/gjsify/gjsify/commit/460b932afc7c0ca0b46a9b3a42a1784bd8a5ffc9))
* **create-app:** add check script to template, fix set_child typo ([4290b92](https://github.com/gjsify/gjsify/commit/4290b92b137bb3f709813c1fb627ea6d2698b9ea))
* **package:** update astro dependency to version 6.1.5 ([77ad702](https://github.com/gjsify/gjsify/commit/77ad70279e414edd9e0e05efa9b2959342d090d6))

### Code Refactoring

* **globals:** stage 1 — drop fetch/abort-controller from node-globals ([#6](https://github.com/gjsify/gjsify/issues/6)) ([94464bd](https://github.com/gjsify/gjsify/commit/94464bdc0a9a215f165ea1cba9445aabd81c4b89))
* **globals:** stage 2 — introduce /register subpath exports ([66957b9](https://github.com/gjsify/gjsify/commit/66957b9bf2bff7e3088f76be45627a578f96abbf))

## Unreleased

### ⚠ BREAKING CHANGES

* **node-globals:** `@gjsify/node-globals` no longer auto-registers `fetch`, `Headers`, `Request`, `Response`, `AbortController` or `AbortSignal`. These are Web APIs, not Node.js globals — importing them automatically pulled the full WHATWG Streams implementation into every bundle even when unused (~80 KB dead weight on a minimal Express app). Projects that need these APIs on GJS should now either:
  - Import `@gjsify/web-globals` to get the full Web API set, or
  - Import the specific package side-effect bundle, e.g. `import 'fetch'` or `import 'abort-controller'` (the aliases resolve to the correct GJS/Node package automatically).
* **node-globals:** The empty `ReadableStream`/`Blob` placeholder stubs in `@gjsify/node-globals` are removed. `Blob`/`File` remain available because `@gjsify/buffer` (still imported by node-globals) registers them. `ReadableStream` is only registered when something actually imports `@gjsify/streams` or a package that depends on it.

### Features

* **cli:** add `gjsify create <name>` subcommand that delegates to `@gjsify/create-app`, so users only need to remember a single npm scope (`@gjsify/cli`) to scaffold, build and run GJSify projects
* **create-app:** expose `createProject()` as a programmatic export (`import { createProject } from '@gjsify/create-app'`) in addition to the existing CLI entry

### Refactor

* **globals:** drop `fetch` and `abort-controller` side-effect imports from `@gjsify/node-globals` and `@gjsify/dom-elements`. Stage 1 of the globals tree-shaking refactor. Express showcase bundle shrinks from 1.83 MB → 1.68 MB (-157 KB, -8.5 %), WHATWG Streams references drop from 186 to 9.
* **fs:** make `FileHandle.readableWebStream()` resolve the `ReadableStream` constructor lazily from `globalThis` instead of importing `node:stream/web` at module load time. Apps that never call `readableWebStream()` no longer ship the full WHATWG Streams polyfill. Stage 1 of the globals tree-shaking refactor.
* **globals:** Stage 2 of the globals tree-shaking refactor — introduce `/register` subpath exports on every global-providing package. The root `@gjsify/<pkg>` exports are now pure named exports with no side effects; side-effects live in `@gjsify/<pkg>/register`. Meta-packages (`@gjsify/node-globals`, `@gjsify/web-globals`) are rewired to chain `/register` subpaths. Internal package dependencies (compression-streams → web-streams, webcrypto → dom-exception) now use pure named imports. Canvas2D fireworks showcase shrinks from 837 KB → 641 KB (-196 KB, -23.4 %). Packages migrated: `abort-controller`, `buffer`, `compression-streams`, `dom-elements`, `dom-events`, `dom-exception`, `eventsource`, `fetch`, `node-globals`, `web-globals`, `web-streams`, `webcrypto`. New bare-specifier aliases: `abort-controller/register`, `fetch/register`, `webcrypto/register`, etc. — resolve to the appropriate `/register` subpath on GJS and to `@gjsify/empty` on Node.
* **globals:** explicit `--globals` CLI flag for controlling which `/register` modules ship in the bundle. Users declare needed globals as a comma-separated list (`--globals fetch,Buffer,process,URL,crypto,structuredClone,AbortController`); the CLI resolves each identifier against `GJS_GLOBALS_MAP`, writes a small ESM stub under `node_modules/.cache/gjsify/`, and passes it to the plugin via `autoGlobalsInject`. The plugin appends the stub to esbuild's `inject` list. The `@gjsify/create-app` template `package.json` ships with a sensible default list pre-wired into the `build` script, so typical Node-style apps work out of the box. There is deliberately no automatic scanning of user code — heuristic scanners (regex on entry points, AST on entry points, two-pass metafile scan across transitive deps) were prototyped and all three leaked in different ways (shadowed identifiers, isomorphic library guards, dynamic imports, bracket-notation global access). Explicit declaration keeps the CLI layer minimal and build output predictable.

### Features

* **cli/build:** add `--globals <list>` flag to `gjsify build` — comma-separated list of global identifiers to register in the bundle (e.g. `--globals fetch,Buffer,process`).

### Bug Fixes

* **website:** build `@gjsify/adwaita-web` SCSS as a prerequisite of the website build so `deploy-docs` CI (which runs only `yarn workspace @gjsify/website build`) can resolve `@gjsify/adwaita-web/style.css` after the CSS-in-JS → SCSS refactor

### Documentation

* **website:** refactor top-level docs to target framework users instead of monorepo contributors — new Getting Started walks through `npx @gjsify/cli create my-app` instead of `git clone`
* **website:** new `CLI Reference` and `How It Works` pages under `Documentation`
* **website:** move contributor docs (Architecture, TDD Workflow, Development Setup) into a dedicated top-level `Contributing` sidebar group
* **website:** home page cards for Node.js APIs, Web APIs and DOM & Graphics now link directly to their respective Packages pages

## [0.1.7](https://github.com/gjsify/gjsify/compare/v0.1.6...v0.1.7) (2026-04-04)

### Bug Fixes

* **ci:** build examples before npm publish in release workflow ([027a729](https://github.com/gjsify/gjsify/commit/027a72985899d4acd91f47bb6d5799b3b020a82d))

## [0.1.6](https://github.com/gjsify/gjsify/compare/v0.1.5...v0.1.6) (2026-04-04)

### Bug Fixes

* **publish:** build examples before npm publish + lint for missing dist ([eba07a5](https://github.com/gjsify/gjsify/commit/eba07a5b98ad10b77bc99827334cd53490c619b9))
* **refs:** update subproject commits for bun, deno, and undici ([e1751dd](https://github.com/gjsify/gjsify/commit/e1751dd0cd041c61bb0270326312b54e18a687da))
* **svg:** update favicon and logos ([4699da6](https://github.com/gjsify/gjsify/commit/4699da6dbc2a0f220e243deec2cc13862cf9bece))

## [0.1.5](https://github.com/gjsify/gjsify/compare/v0.1.4...v0.1.5) (2026-04-04)

### Bug Fixes

* **cli:** resolve gwebgl from CLI location, not user's cwd ([686c53d](https://github.com/gjsify/gjsify/commit/686c53dc6eac5ff2f0d8df54eefd0c365512e02d))
* **cli:** resolve npm packages from project first, CLI as fallback ([8d81c97](https://github.com/gjsify/gjsify/commit/8d81c97ef20f3eea5e79e0851d33344d5013fa31))

## [0.1.4](https://github.com/gjsify/gjsify/compare/v0.1.3...v0.1.4) (2026-04-03)

### Bug Fixes

* **examples:** update outdated engines fields and add lint check ([c27ad7c](https://github.com/gjsify/gjsify/commit/c27ad7cbd777299d99c87bbed5916cc3a4d357f2))

## [0.1.3](https://github.com/gjsify/gjsify/compare/v0.1.2...v0.1.3) (2026-04-03)

### Features

* add documentation link to README ([3e10f75](https://github.com/gjsify/gjsify/commit/3e10f751fda846bddc9c06d875935b0b3c8bf0fc))
* add release:patch script to package.json for patch releases ([f07f30a](https://github.com/gjsify/gjsify/commit/f07f30a243331871457f179291578dafe0fa870f))
* documentation site, WebGL conformance, CLI showcase, dependency updates ([#3](https://github.com/gjsify/gjsify/issues/3)) ([db41f07](https://github.com/gjsify/gjsify/commit/db41f07551d48282161458bb2648cb28560767a2)), closes [#version](https://github.com/gjsify/gjsify/issues/version) [#version](https://github.com/gjsify/gjsify/issues/version) [#version](https://github.com/gjsify/gjsify/issues/version)
* include website package.json in release-it bumper configuration ([58d4242](https://github.com/gjsify/gjsify/commit/58d42421bcc11e55824df6086682524983caf397))
* update favicon to SVG format and replace logo with new design ([f8e0f46](https://github.com/gjsify/gjsify/commit/f8e0f4615b19386f598101ecdb86c01d71994683))

# gjsify — Changelog

### 2026-04-07 — TypeScript: Spec Files Now Type-Checked Monorepo-Wide

**Problem:** VSCode raised `Cannot find name 'node:stream'` on every `*.spec.ts` that imported `node:*` modules. Root cause: all 60 package tsconfigs excluded `src/**/*.spec.{ts,mts}` from their `include`, so the IDE's language server fell back to an inferred project without `@types/node`. `yarn check` (`tsc --noEmit`) was also silently skipping all spec files.

**Fix:**
- Removed the `src/**/*.spec.{ts,mts}` exclusions from 58 package tsconfigs. VSCode's auto-discovered project now covers spec files and loads `@types/node` for them; `yarn check` now actually type-checks specs.
- `packages/dom/webgl/tsconfig.json` re-excludes spec files as a special case — they don't import `node:*` (so the user complaint doesn't manifest) but have pre-existing global DOM `WebGLRenderingContext` vs class-type conflicts that would otherwise flood the check with ~100 errors.
- Added TypeScript `paths` mappings in 9 web tsconfigs (`abort-controller`, `compression-streams`, `dom-events`, `dom-exception`, `eventsource`, `fetch`, `formdata`, `websocket`, `webstorage`) pointing each bare web alias to `./src/index.ts` so specs that use the `AGENTS.md`-mandated bare-specifier imports type-check without build-time esbuild alias resolution.
- Ambient module declarations in `packages/web/dom-events/src/spec-aliases.d.ts` and `packages/node/events/src/spec-aliases.d.ts` cover cross-package bare imports (`abort-controller`) without requiring cross-rootDir path mappings.
- `packages/node/stream/src/spec-internals.d.ts`: ambient module augmentation exposing `_readableState`/`_writableState` for white-box tests that probe stream internals.

**Spec type errors surfaced and fixed:**
- `as any` casts added for test-only invalid arguments (perf_hooks `EntryType` literal, webcrypto `Float32Array`, sqlite unsupported values, `crypto.KeyObject` private constructor, `KeyObject.export` format-only options, `http2.getPackedSettings()` zero-arg, `readline.cursorTo` 3-arg, `http.IncomingMessage` zero-arg).
- Type augmentations for Node internals missing from `@types/node`: `StringDecoder.encoding`, `dgram.Socket.type`, `http.Agent.{defaultPort, keepAlive, keepAliveMsecs, scheduling}`, `http2.constants.{NGHTTP2_SETTINGS_ENABLE_CONNECT_PROTOCOL, DEFAULT_SETTINGS_MAX_HEADER_LIST_SIZE, HTTP2_HEADER_PROTOCOL}`.
- Explicit narrowing for `server.address(): string | AddressInfo | null` (net spec).
- String/Buffer narrowing for `'data'` event handlers in net specs.
- JSON result typing in fetch and stream-consumers specs.
- Loosened `tracingChannel`/`channel` types via local `as any` aliases for the many handler shapes in the diagnostics_channel spec.
- Renamed shadowed `resolve` in dns spec (promise resolve shadowed `dns.resolve`).
- Unused import/variable cleanup in canvas2d, dom-elements, webgl/textures specs.
- Added `declare readonly isTrusted: boolean` on `@gjsify/dom-events` `Event` class so white-box `isTrusted` access in specs type-checks (runtime behaviour unchanged — set via `Object.defineProperty` in the constructor).

**Documentation:**
- `AGENTS.md`: added explicit rule — "Changelog entries live ONLY in CHANGELOG.md. Do NOT add dated 'Latest:' lines, changelog highlights, or per-session summaries to STATUS.md."
- `STATUS.md`: removed the dated "Latest:" line pattern; `## Changelog` section now just points to CHANGELOG.md.
- `packages/node/events/src/callable.spec.ts`: header comment updated — the EventEmitter callable work is no longer a TODO, these specs are its regression coverage.

**Verification:** `yarn check` clean across the monorepo, `yarn build` succeeds, `yarn test` → 53,310 tests passing.

### 2026-04-07 — Stream GJS Fixes: 36→0 Failures, 509 Tests Passing on Both Platforms

**`@gjsify/stream` — GJS implementation fixes (all 36 GJS failures resolved):**

- **`_readableState` / `_writableState` fields** — both now expose `highWaterMark`, `objectMode`, and `pipes` (array), populated in constructors; required by tests that access internal state directly
- **`Writable_.Symbol.hasInstance`** — static `[Symbol.hasInstance]` added: checks prototype chain first (for real subclasses), then sentinel-guarded duck-type check (`writableHighWaterMark` numeric property) so `duplex instanceof Writable` and `transform instanceof Writable` work through the `makeCallable` Proxy
- **Split `highWaterMark` options** — `Duplex_` constructor now correctly handles `highWaterMark` (overrides both sides), `readableHighWaterMark`, and `writableHighWaterMark` independently; NaN validation added for all HWM options
- **Drain condition HWM=0** — `writableNeedDrain` drain check changed from `<` to `<=` so drain fires when `writableLength <= writableHighWaterMark` (critical for HWM=0 case where `0 < 0` is always false)
- **`Transform_` complete redesign:**
  - Constructor assigns `opts.transform`/`opts.flush`/`opts.final` directly as instance properties (`t._transform === opts.transform` equality holds)
  - `ERR_METHOD_NOT_IMPLEMENTED` re-throws synchronously from `_write` (test introspects the throw); other user-provided `_transform` errors become 'error' events
  - `ERR_MULTIPLE_CALLBACK` — `called` flag in `_write` detects second callback invocation and emits error
  - `_doPrefinishHooks` virtual method on `Duplex_` called between `_final` and `finish`; `Transform_` overrides it to run built-in `_final` (flush+push-null) when user supplied a custom `_final`
- **`Readable_.push()` type validation** — non-objectMode pushes of plain objects emit `ERR_INVALID_ARG_TYPE` error
- **`_destroy` virtual method** — `Readable_._destroy(error, callback)` prototype method added; `destroy()` calls `this._destroy()` so instance-overridden `_destroy` works correctly
- **`Stream_.pipe()` cleanup** — `source.on('end', cleanup)` removes all listeners when 'end' fires; `onclose` skips `destroy(dest)` for modern `Readable_` instances to avoid premature close
- **`unpipe()` sync** — maintains `_readableState.pipes` alongside `_pipeDests`

**`@gjsify/util` — `inherits` error codes:**
- All three validation throws now attach `code: 'ERR_INVALID_ARG_TYPE'` matching Node.js behaviour

**Test coverage:**
- Node.js: 507 tests passing | GJS: 509 tests passing (0 failures, up from 36)
- Stream spec files: 7 (readable, writable, duplex, transform, pipe, inheritance + base)

**AGENTS.md:**
- Added note: internal modules may import `@gjsify/stream` directly for non-standard exports; public code must use `node:stream`

### 2026-04-01 — DOM API, WebGL2, Blueprint, Adwaita Web, Three.js Teapot

**DOM API enhancements (`@gjsify/dom-elements`):**
- `Node.ownerDocument` returns `document` singleton (lazy, avoids circular deps)
- Event bubbling via `Node.dispatchEvent` override — walks parentNode chain
- `Document` establishes DOM tree: document → documentElement → body
- `Element`: `setPointerCapture()`, `releasePointerCapture()`, `hasPointerCapture()`
- `HTMLElement`: `getBoundingClientRect()` stub (uses clientWidth/clientHeight)
- Browser globals on import: `globalThis.self`, `devicePixelRatio`, `alert`

**WebGL2 fixes (`@gjsify/webgl`):**
- `WebGL2RenderingContext` overrides `texImage2D`, `texSubImage2D` — bypasses WebGL1 format validation (RGBA8, RGB8, SRGB8_ALPHA8 etc.)
- `WebGL2RenderingContext` overrides `drawElements` — UNSIGNED_INT as core feature (no extension gate)
- `CanvasWebGLWidget`: resize dispatches DOM event + re-invokes last rAF callback

**Blueprint support:**
- New `@gjsify/esbuild-plugin-blueprint` — compiles `.blp` → XML via `blueprint-compiler`
- Wired into `esbuild-plugin-gjsify` for GJS and browser targets
- Type declaration: `@gjsify/esbuild-plugin-blueprint/types`

**Adwaita web components (`@gjsify/adwaita-web`):**
- 5 Custom Elements (light DOM): AdwWindow, AdwHeaderBar, AdwPreferencesGroup, AdwSwitchRow, AdwComboRow
- Embedded Adwaita CSS with light/dark theme (canonical colors from libadwaita)
- Adwaita Sans font via @font-face
- `notify::active` / `notify::selected` events mirror GJS GObject signals

**Three.js teapot example (`examples/gtk/three-geometry-teapot/`):**
- First Adwaita example: Adw.Application + Blueprint template
- First OrbitControls usage (event bridge validation)
- Dual-target: GJS native + browser with @gjsify/adwaita-web
- New convention: `src/gjs/` + `src/browser/` + shared `three-demo.ts`
- 6 shading modes (wireframe, flat, smooth, glossy, textured, reflective)

**New reference submodules:** `refs/adwaita-web`, `refs/libadwaita`, `refs/adwaita-fonts`, `refs/app-mockups`

### 2026-03-27 — WebGL Refactor: HTMLCanvasElement Inheritance, WebGLArea Widget

**Goal: enable browser-targeted game engines (e.g. Excalibur) to run on GJS/GTK with minimal changes.**

**Base `HTMLCanvasElement` in `@gjsify/dom-elements`:**
- New `packages/dom/dom-elements/src/html-canvas-element.ts` — DOM-spec base class extending `HTMLElement`
- Stubs for `getContext()`, `toDataURL()`, `toBlob()`, `captureStream()` (overridden in `@gjsify/webgl`)
- Side-effect globals on import: `Object.defineProperty(globalThis, 'HTMLCanvasElement', ...)`, `HTMLImageElement`, `Image` — same pattern as `@gjsify/node-globals` and `@gjsify/web-globals`
- Removes the `// TODO move this to dom globals` boilerplate from all WebGL examples

**`@gjsify/webgl` real inheritance + class renames:**
- Removed the fake interface trick (`export interface GjsifyHTMLCanvasElement extends HTMLCanvasElement {}`)
- `GjsifyHTMLCanvasElement` → `HTMLCanvasElement` — now extends `BaseHTMLCanvasElement` from `@gjsify/dom-elements`, overrides `width`/`height` getters with `Gtk.GLArea` allocated size
- `GjsifyWebGLRenderingContext` → `WebGLRenderingContext` (and all other `Gjsify*` class prefixes removed — 136 occurrences across 29 files)
- `getContext('webgl')` creates `WebGLRenderingContext` lazily via `??=`

**New `WebGLArea` widget (`packages/dom/webgl/src/ts/webgl-area.ts`):**
- `Gtk.GLArea` subclass registered with `GObject.registerClass({ GTypeName: 'GjsifyWebGLArea' }, ...)`
- Sets up ES 3.2 context + depth buffer + stencil buffer automatically
- `onWebGLReady(cb: (canvas, gl) => void)` — fires once GL context is initialized
- `requestAnimationFrame(cb)` — backed by `GLib.idle_add` + render signal (replaces per-example boilerplate)
- `installGlobals()` — sets `globalThis.requestAnimationFrame` scoped to this widget
- Handles `unrealize` cleanup (disconnects render handler, removes idle source)

**VAPI cleanup:**
- Deleted unused `packages/dom/webgl/src/vapi/glesv2.vapi` (Vala source uses `using GL;` from `epoxy.vapi` only)
- Updated `epoxy.vapi` header: removed vapigen-generated comment, added attribution to valagl

**Examples refactored (6 files):**
- `examples/gtk/webgl-tutorial-02` through `07` and `webgl-demo-fade` simplified from 60–120 lines → 22–33 lines
- All manual `Gtk.GLArea` setup, `requestAnimationFrame` implementations, and `globalThis.Image =` assignments removed
- All now use `new WebGLArea()` + `glArea.installGlobals()` + `glArea.onWebGLReady((canvas) => start(canvas))`

### 2026-03-27 — Restructure: new `packages/dom/` category

**New package category `packages/dom/` for DOM/platform-specific packages:**
- Moved `dom-elements` from `packages/web/` → `packages/dom/`
- Moved `webgl` from `packages/web/` → `packages/dom/`
- Merged `html-image-element` into `dom-elements` (HTMLImageElement, Image now part of @gjsify/dom-elements)
- Updated `@gjsify/webgl` dependency: `html-image-element` → `dom-elements`
- Updated root `package.json` workspaces, `meson.build`, WebGL example scripts, CLAUDE.md, STATUS.md

### 2026-03-27 — HTTP Upgrade Event, Web Globals, Client Auth, Test Coverage

**HTTP Server upgrade event:**
- `server.on('upgrade', (req, socket, head) => {...})` for custom protocol upgrades
- Uses `Soup.ServerMessage.steal_connection()` to take over raw TCP connection
- Socket is a net.Socket Duplex wrapping the stolen Gio.IOStream
- Note: WebSocket upgrades (`Upgrade: websocket`) are handled by Soup internally via `addWebSocketHandler()`

**HTTP Client improvements:**
- `auth` option for Basic authentication (`http.request({auth: 'user:pass'})`)
- `signal` option for AbortController support
- `localAddress` and `family` options in ClientRequestOptions
- Agent constructor options: `keepAlive`, `maxSockets`, `maxTotalSockets`, `maxFreeSockets`, `scheduling`
- Agent exposes `requests`/`sockets`/`freeSockets` objects for framework compatibility

**Web Globals consolidation:**
- `@gjsify/web-globals` now registers: URL, URLSearchParams, Blob, File, FormData, performance, PerformanceObserver
- Previously only: DOMException, Event/EventTarget, AbortController, Streams, Compression, WebCrypto, EventSource

**Net Socket IOStream support:**
- `net.Socket._setupFromIOStream()` creates sockets from raw `Gio.IOStream` (for stolen connections)
- Proper IOStream lifecycle: `_final()` closes entire SoupIOStream for proper EOF signaling
- `@gjsify/net` exports `./socket` subpath for direct internal imports

**New tests (+200):**
- HTTP: 995→1034 (+39): upgrade event (5 tests), auth option (3), Agent constructor (8), signal option, round-trip
- Net: 361→378 (+17): destroy idempotency, getConnections, maxConnections, address info, bytesWritten/bytesRead
- Web-Globals: 45→66 (+21): URL/URLSearchParams, Blob/File, FormData, Performance globals

### 2026-03-26 — Networking Hardening, Timeout Enforcement, Stream Edge Cases

**HTTP Server improvements:**
- **Chunked streaming**: ServerResponse now uses `Soup.Encoding.CHUNKED` for true streaming via `responseBody.append()` instead of buffering the entire response. Each `res.write()` flushes a chunk.
- **Timeout enforcement**: `ServerResponse.setTimeout()`, `IncomingMessage.setTimeout()`, and `ClientRequest.setTimeout()` now emit `'timeout'` events via actual timers (previously properties existed but were inert).
- **ClientRequest timeout option**: `http.request({timeout: 50})` starts a timer that emits `'timeout'` if no response arrives in time. Timer cleared on response or abort.

**Net Socket improvements:**
- **allowHalfOpen enforcement**: `net.Server({allowHalfOpen})` now stores and passes the option to accepted sockets. When `allowHalfOpen=false` (default), the socket calls `end()` on read EOF, matching Node.js behavior.
- **Socket allowHalfOpen property**: `net.Socket` exposes `allowHalfOpen` as a public property and respects it during EOF handling in the read loop.

**New tests (+200):**
- HTTP: 890→995 (+105): ServerResponse.setTimeout, IncomingMessage.setTimeout, ClientRequest.setTimeout/timeout option, abort events, HEAD no-body, automatic headers, custom status messages, res.end() callback, multiple headers (Set-Cookie), flushHeaders, POST body streaming (empty/64KB), error handling (EADDRINUSE, connection refused), server lifecycle
- Net: 295→361 (+66): Socket.setTimeout (idle timeout, data resets, cancellation), allowHalfOpen enforcement, server lifecycle (listening, close, address, getConnections), connection lifecycle (connect/ready events, connecting state, bytesRead/bytesWritten), destroy/close events, error handling (connection refused, EADDRINUSE), setKeepAlive/setNoDelay chainability, maxConnections, echo/binary data
- Stream: 288→330 (+42): pipeline (error propagation from source/transform/sink, callback behavior), finished (writable/readable/error/premature close, cleanup), Transform _flush (data push, error propagation), Readable.from (array/generator/async generator/string/Buffer), addAbortSignal (abort/already-aborted), backpressure (write returns false, drain events), PassThrough, Duplex read+write, objectMode, async iteration with errors

### 2026-03-26 — Fetch Globals, WebSocket Server, EADDRINUSE Fix, GTK Dashboard

**Infrastructure fixes:**
- **Fetch API globals on GJS**: `@gjsify/fetch` now registers `fetch`, `Request`, `Response`, `Headers` on `globalThis`. `@gjsify/node-globals` imports `@gjsify/fetch` for side-effect registration (replaces empty stubs).
- **EADDRINUSE error on GJS**: `http.Server.listen()` now throws when port is busy and no `'error'` listener is registered, matching Node.js behavior (previously exited silently).
- **WebSocket server**: `http.Server.addWebSocketHandler(path, callback)` delegates to `Soup.Server.add_websocket_handler()` for server-side WebSocket on GJS.

**New examples:**
- `examples/net/ws-chat`: WebSocket chat using `Soup.WebsocketConnection` signals, with REST POST fallback
- `examples/gtk/http-dashboard`: GTK4 window + embedded HTTP server. Labels show request count/uptime, TextView shows request log. Uses `GLib.idle_add()` for thread-safe UI updates.

### 2026-03-26 — Real-World Examples Sprint (+6 examples, +116 tests)

**New examples (all work on both Node.js and GJS unless noted):**
- `examples/net/static-file-server`: `createReadStream().pipe(res)`, MIME types, gzip, directory listing, 304 caching
- `examples/net/sse-chat`: Real-time chat via Server-Sent Events + HTTP POST, EventEmitter message bus
- `examples/net/hono-rest`: Hono.js CRUD REST API with JSON validation (Node.js works, GJS needs Fetch API globals)
- `examples/cli/file-search`: Recursive file search using `createReadStream` + `readline.createInterface`
- `examples/cli/dns-lookup`: Interactive DNS tool using `dns.lookup/resolve4/resolve6/reverse`
- `examples/cli/worker-pool`: Task pool with MessageChannel for inter-worker communication

**New tests:**
- HTTP streaming (65 tests): `Readable.pipe(res)`, multi-chunk writes, large bodies (256KB), POST body, concurrent requests, routing, server lifecycle
- fs streams (27 tests): `createReadStream`/`createWriteStream`, pipe (ReadStream→WriteStream, Transform, PassThrough), Unicode, binary
- net TCP (24 tests): echo server, 64KB data transfer, connection events, socket properties, UTF-8/binary, error handling

**Validated:** `createReadStream().pipe(res)` works on GJS. TCP echo and data transfer work cross-platform. MessageChannel postMessage works for task distribution.

### 2026-03-26 — Static File Server Example

**New example:**
- `examples/net/static-file-server`: Static file server with `fs.createReadStream().pipe(res)`, MIME type detection, gzip compression (`zlib.gzipSync`), directory listing, `If-Modified-Since`/304, directory traversal prevention. Runs on both Node.js and GJS.

**Validated:** `createReadStream().pipe(res)` works correctly on GJS — the stream pipe mechanism (Readable→Writable with backpressure) and Soup.Server response buffering are fully compatible.

### 2026-03-26 — Real-World Application Examples & GJS Compat Fixes

**New examples:**
- `examples/net/koa-blog`: Koa.js blog with EJS templates, HTML forms, JSON API, CRUD. Runs on both Node.js and GJS.
- `examples/net/express-hello`: Updated to use `@gjsify/runtime` for platform detection.

**New packages:**
- `@gjsify/runtime`: Platform-independent runtime detection (isGJS, isNode, runtimeName, runtimeVersion). No dependencies, works on both platforms.

**GJS compatibility fixes surfaced by real-world frameworks:**
- **http.Server GC guard**: Koa/Express create http.Server inside `.listen()` and discard the return value. GJS GC collected the server after ~10s of inactivity. Fix: module-level `Set<Server>` keeps strong references to all listening servers.
- **http.Server connection exhaustion**: Soup.Server keeps HTTP/1.1 connections alive by default. After ~10 requests, connection pool was full. Fix: set `Connection: close` header, always call `set_response()` even for empty bodies (redirects, 204s).
- **assert cjs-compat.cjs**: Koa's `require('assert')` got a namespace object instead of the assert function. Added CJS compatibility wrapper.
- **Web API stubs**: Registered `Response`, `Request`, `Headers`, `ReadableStream`, `Blob` as empty global classes on GJS. Prevents `ReferenceError` in frameworks using `val instanceof Response`.
- **StringDecoder function constructor**: Converted from ES6 class to function constructor. `iconv-lite` (used by `koa-bodyparser`) calls `StringDecoder.call(this, enc)` which fails on ES6 classes.
- **skipLibCheck for TS6**: Added to all example and `@gjsify/unit` tsconfigs. `@types/node@25.5.0` has `export = console` pattern incompatible with TypeScript 6's `module: NodeNext`.

### 2026-03-25 — Comprehensive Improvement Sprint (3,260→8,100 tests)

**Phase 1 — Test pipeline stabilization:**
- Fixed test failures in perf_hooks, process, readline, tty, fetch, formdata, stream, url
- Stabilized cross-platform test execution for consistent Node.js and GJS results

**Phase 2 — Test expansion (path, url, diagnostics_channel, zlib):**
- path: 51→135 (parse, format, normalize, resolve, relative, isAbsolute, POSIX + Win32 edge cases)
- url: 82→278 (URL constructor, searchParams, edge cases, legacy url.parse/format/resolve)
- diagnostics_channel: 26→137 (Channel lifecycle, subscribe/unsubscribe, TracingChannel, hasSubscribers)
- zlib: expanded sync/async methods, double compression, consistency tests

**Phase 3 — fs and os implementation fixes:**
- fs: Dirent methods (isFile/isDirectory/isSymbolicLink), FSWatcher persistent option, mkdirSync recursive return value, async rmdir/unlink, proper ENOENT/EACCES error codes
- os: Fixed TODO items in implementation

**Phase 4 — Test expansion (http, vm, worker_threads):**
- http: 136→457 (STATUS_CODES completeness, IncomingMessage/ServerResponse properties, Agent lifecycle, request options, chunked encoding, error handling)
- vm: 49→203 (runInThisContext edge cases, runInNewContext sandbox isolation, Script reuse, compileFunction params, createContext/isContext, error propagation)
- worker_threads: 93→217 (MessageChannel ordering, MessagePort lifecycle, BroadcastChannel multi-receiver, Worker IPC, structured clone completeness, environmentData)

**Phase 5 — Web API expansion (web-streams, webcrypto + impl fixes):**
- web-streams: 139→283 (ReadableStream tee/pipeTo/pipeThrough, WritableStream abort/close, TransformStream backpressure, TextEncoderStream/TextDecoderStream edge cases, queuing strategies)
- webcrypto: 190→486 (digest all algorithms, AES-CBC/CTR/GCM round-trip, HMAC sign/verify, ECDSA/RSA-PSS/RSA-OAEP, PBKDF2/HKDF/ECDH derivation, generateKey/importKey/exportKey completeness, CryptoKey properties)
- webcrypto impl fixes for GJS compatibility

**Total: 3,260→8,100 test cases. 83 spec files. All pass on both Node.js and GJS.**

### 2026-03-25 — Test Expansion Sprint (+720 tests)

**Phase 1 — Underserved packages (8 packages, +442 tests):**
- readline: 24→130 (line events, mixed endings, Unicode, history, async iterator, CSI utilities)
- https: 24→62 (Agent options, globalAgent, request/get methods, createServer/Server)
- tty: 23→29 (isatty, ReadStream/WriteStream prototype, getColorDepth env)
- module: 27→158 (builtinModules completeness, isBuiltin edge cases, createRequire)
- async_hooks: 28→74 (enterWith, snapshot, exit with args, triggerAsyncId option)
- process: 37→75 (env CRUD, pid/ppid, hrtime ordering, memoryUsage, nextTick, cpuUsage)
- os: 32→62 (type/platform/arch validation, constants signals/errno, userInfo, networkInterfaces)
- console: 37→84 (format specifiers, table, dir, time/timeLog, Console stdout/stderr routing)

**Phase 2 — Core packages (2 packages, +167 tests):**
- events: 60→127 (setMaxListeners, errorMonitor, captureRejections, prependListener, rawListeners, Symbol events, async iterator)
- buffer: 52→152 (encodings, TypedArray/ArrayBuffer, fill, indexOf/lastIndexOf, swap16/32/64, int/float read/write, equals)

**Phase 3 — Coverage gaps (3 packages, +111 tests):**
- dgram: 37→80 (socket methods, broadcast/TTL/multicast, ref/unref, IPv6, connect/disconnect, I/O)
- fs/promises: 30→59 (writeFile/readFile round-trip, mkdir/rmdir, stat, rename, copyFile, chmod, mkdtemp, truncate)
- perf_hooks: 31→70 (mark/measure lifecycle, getEntries filtering, clearMarks/Measures, toJSON, exports)

**Implementation fixes:**
- `async_hooks`: Fixed AsyncResource.asyncId() to return stable per-instance id; added snapshot(), exit() with args, triggerAsyncId option
- `os`: Fixed trailing newline from cli() output in type()/platform()/release()
- `buffer`: Fixed lastIndexOf with undefined byteOffset on SpiderMonkey (was searching from index 0)
- `module`: Added async_hooks to builtinModules list

### 2026-03-25 — Coverage & Stability Sprint (Day 7–10)

**New API implementations:**
- `tls`: Added `checkServerIdentity()` (wildcard certs, SAN, FQDN/trailing-dot), `getCiphers()`, `DEFAULT_CIPHERS` (18 new tests)
- `dgram`: Added `Socket.connect()`, `Socket.disconnect()`, `Socket.remoteAddress()` with ERR_SOCKET_DGRAM_IS_CONNECTED / NOT_CONNECTED / BAD_PORT error handling (7 new tests)
- `worker_threads`: Added `MessagePort.addEventListener()` / `removeEventListener()` and `BroadcastChannel.addEventListener()` / `removeEventListener()` (9 new tests)
- `fs/FileHandle`: Implemented `read()` (Gio.FileInputStream-based), `truncate()` (Gio.File overlay), `writeFile()` (Gio.File), `stat()` (Stats constructor). Fixed `open()` error mapping for GLib.FileError (ENOENT vs ENOTDIR). Fixed `readlinkSync` error re-throw guard (numeric vs string code). Fixed `read()` `...args` rest param bug (previously parsed buffer bytes as args).

**Test additions:**
- `fs`: 126 → 153 (+27): FileHandle read/write/truncate/writeFile/stat/readFile/appendFile, error cases for non-existent paths, symlink edge cases
- `tls`: 30 → 48 (+18): checkServerIdentity (wildcards, SANs, FQDN, IP), getCiphers, DEFAULT_CIPHERS constant
- `dgram`: 30 → 37 (+7): connect/disconnect/remoteAddress, error codes
- `worker_threads`: 41 → 50 (+9): addEventListener/removeEventListener, structured clone edge cases (-0, NaN, BigInt, Int32Array)

**Bug fixes:**
- `tls.checkServerIdentity`: Wildcard pattern `unfqdn()` normalization for trailing-dot FQDNs (GJS test was failing)
- `tls` test: `toContain()` does not check string substrings in `@gjsify/unit` (only array containment); replaced with `toMatch(/.../)`
- `readlinkSync`: Catch block `if ((err as {code?}).code) throw err` re-threw Gio errors with numeric code (1) before `createNodeError` conversion; fixed to check `typeof === 'string'`
- `FileHandle.open()`: GLib.IOChannel.new_file() throws GLib.FileError (code 4 = NOENT) which overlaps with Gio.IOErrorEnum (code 4 = NOT_DIRECTORY); added `GLIB_FILE_ERROR_TO_NODE` mapping in constructor
- `FileHandle.write()`: Switched to Gio.File overlay (read-modify-write) so data is immediately on-disk and visible to subsequent `read()` calls (GLib.IOChannel flush does not call fflush on stdio FILE* buffer)

**Total: 2,503 → 2,540 test cases. All pass on both Node.js and GJS.**

---

### 2026-03-25 — Metric Consolidation (Coverage Audit)

**Corrected test counts to match actual spec files (no implementation changes):**
- `net`: 64 → 84 (TCP lifecycle, error handling, large data, simultaneous connections)
- `fs`: 83 (7 specs) → 126 (8 specs) — added symlink.spec.ts, expanded extended/new-apis/file-handle
- `stream`: 141 (3 specs) → 196 — expanded Readable/Writable/Transform/backpressure/objectMode tests
- `child_process`: 43 → 79 — expanded execFile, spawn, env, cwd, edge cases
- `html-image-element`: 2 → 22 — full attribute coverage (alt, src, width, height, crossOrigin, loading, decode)
- Added `@gjsify/dom-elements` to Web API table (was missing): 61 tests, Node/Element/HTMLElement hierarchy
- Total test cases: 2,130 → 2,503 | Spec files: 75 → 83 | Web APIs: 14 → 15

### 2026-03-25 — Stabilization & Deduplication

**Fixed worker_threads GJS timeouts (17 tests → 0 failures):**
- Added `@gjsify/node-globals` import to test.mts (registers structuredClone on GJS)
- Replaced `setTimeout(..., 0)` with `Promise.resolve().then()` in MessagePort._dispatchMessage() and BroadcastChannel.postMessage() for correct microtask scheduling on GLib main loop
- worker_threads tests: 63 → 82 (all pass on both Node.js and GJS)

**Extracted shared base64 utilities to `@gjsify/utils/src/base64.ts`:**
- Consolidated duplicate base64 encode/decode from `@gjsify/buffer` (58 lines) and `@gjsify/string_decoder` (16 lines)
- Exports: `base64Encode`, `base64Decode`, `atobPolyfill`, `btoaPolyfill`
- Both consumer packages now import from `@gjsify/utils` — no behavioral change

**Extracted shared nextTick utility to `@gjsify/utils/src/next-tick.ts`:**
- Consolidated duplicate microtask scheduling (process.nextTick → queueMicrotask → Promise fallback)
- `@gjsify/stream` now imports `nextTick` from `@gjsify/utils` (was inline 6-line definition)

**Expanded test coverage:**
- fetch tests: 24 → 51 (Headers forEach/values, Request clone/redirect/signal/null-body, Response.json/clone/statusText/type/headers)
- vm tests: 22 → 49 (SyntaxError/ReferenceError propagation, object literals, nested sandbox objects, Script invalid code, multi-context reuse)
- Total test cases: ~2,960 → ~3,030

### 2026-03-25 — structuredClone Polyfill

**Replaced JSON round-trip polyfill with full HTML structured clone algorithm:**
- New `packages/gjs/utils/src/structured-clone.ts` implementing spec-compliant structuredClone
- Supports: primitives (-0, NaN, BigInt), wrapper objects, Date, RegExp, Error types (with cause), ArrayBuffer, all TypedArrays, DataView, Map, Set, Blob, File, circular/shared references
- Throws DataCloneError for functions, symbols, WeakMap, WeakSet, WeakRef
- Removed duplicated `deepClone`/`cloneValue` from worker_threads (now uses global structuredClone)
- Added `refs/ungap-structured-clone/` as reference submodule
- globals tests: 40 → 96 (56 new structuredClone tests ported from WPT and node-test)
- All 221 tests pass on both Node.js and GJS

### 2026-03-25 — Phase 20: worker_threads + vm Enhancement

**worker_threads structured clone improvements:**
- Replaced JSON round-trip fallback with proper deep clone supporting: Date, RegExp, Map, Set, Error, ArrayBuffer, TypedArrays, nested objects, circular reference detection
- 7 new structured clone tests (Date, RegExp, Map, Set, Error, Uint8Array, nested complex types)
- worker_threads tests: 56 → 63

**vm promoted from Stub to Partial:**
- `runInNewContext(code, sandbox)`: Evaluates code with sandbox variables injected via Function constructor
- `runInContext(code, context)`: Delegates to runInNewContext for created contexts
- `createContext(context)`: Marks objects with Symbol for isContext() detection
- `isContext(context)`: Checks for createContext marker
- `compileFunction(code, params)`: Compiles source code into a reusable Function
- `Script.runInNewContext(context)`: Run compiled script with sandbox
- `Script.runInContext(context)`: Run compiled script in created context
- `Script.createCachedData()`: Returns empty Uint8Array (stub)
- 22 tests (was 6): exports, runInThisContext (arithmetic, strings, complex), runInNewContext (sandbox variables, strings, empty context, arrays), createContext/isContext, compileFunction (no params, with params, string return), Script (constructable, runInThisContext, runInNewContext, runInContext, reusable, createCachedData)

### 2026-03-25 — Phase 19: WebCrypto Algorithm Completion

**New crypto primitives:**
- **ECDSA sign/verify** (`crypto/src/ecdsa.ts`): Full FIPS 186-4 implementation with RFC 6979 deterministic k generation via HMAC-DRBG. Supports P-256, P-384, P-521 curves with SHA-1/256/384/512. Signature format: raw r||s concatenation.
- **MGF1** (`crypto/src/mgf1.ts`): Mask Generation Function 1 per RFC 8017 Section B.2.1. Foundation for RSA-PSS and RSA-OAEP.
- **RSA-PSS sign/verify** (`crypto/src/rsa-pss.ts`): EMSA-PSS-ENCODE/VERIFY per RFC 8017 Section 9.1. Configurable salt length.
- **RSA-OAEP encrypt/decrypt** (`crypto/src/rsa-oaep.ts`): RSAES-OAEP-ENCRYPT/DECRYPT per RFC 8017 Section 7.1. Optional label support.

**SubtleCrypto extensions:**
- `sign()`: Added ECDSA and RSA-PSS algorithm routing
- `verify()`: Added ECDSA and RSA-PSS algorithm routing
- `encrypt()`: Added RSA-OAEP algorithm routing
- `decrypt()`: Added RSA-OAEP algorithm routing

**6 new ECDSA tests**: key generation (P-256), sign/verify round-trip (P-256 SHA-256), corrupted signature rejection, wrong data rejection, different messages produce different signatures, P-384 sign/verify

### 2026-03-25 — Phase 18: Web-Layer-Refactoring + Unified Web-Globals

**18a: DOMException extracted to own package:**
- New package `@gjsify/dom-exception` — DOMException polyfill per WebIDL standard
- Extracted from `@gjsify/dom-events` (was mixed with DOM Events, but DOMException is WebIDL, not DOM Events)
- `@gjsify/dom-events` now re-exports DOMException from `@gjsify/dom-exception` (backwards compatible)
- Registers `globalThis.DOMException` on GJS if missing

**18b: Unified web-globals package:**
- Redesigned `@gjsify/web-globals` from 2-line side-effect import to unified entry point
- Single `import '@gjsify/web-globals'` registers all Web API globals on GJS:
  - DOMException, Event, EventTarget, CustomEvent (dom-exception + dom-events)
  - AbortController, AbortSignal (abort-controller)
  - ReadableStream, WritableStream, TransformStream, TextEncoderStream, TextDecoderStream (web-streams)
  - CompressionStream, DecompressionStream (compression-streams)
  - crypto.subtle, getRandomValues, randomUUID (webcrypto)
  - EventSource (eventsource)
- Re-exports key types for programmatic use
- **27 tests**: DOMException (constructable, error codes, instanceof), DOM Events (Event, EventTarget dispatch), AbortController (signal, abort), Web Streams (Readable/Writable/Transform constructable), Encoding Streams, Compression Streams, WebCrypto (subtle, getRandomValues, randomUUID), EventSource import

### 2026-03-25 — Phase 17: fs + Stream Submodule Test Expansion

**fs callback test expansion** (1 → 15 tests):
- stat/lstat: directory stat, ENOENT error
- readdir: list files
- mkdir/rmdir: create and remove directory
- writeFile/readFile: string and Buffer data, ENOENT error
- open/write/close: low-level file I/O
- access: F_OK success and ENOENT failure
- appendFile: append content
- rename: file rename round-trip
- copyFile: file copy round-trip
- truncate: truncate file content
- chmod: change file mode

**stream submodule tests** (new 2 spec files):
- **stream/consumers** (12 tests): text (empty, single, multi-chunk), json (object, array, number), buffer (data, empty), arrayBuffer (single, multi-chunk), blob (data, content verification)
- **stream/promises** (8 tests): pipeline (readable→writable, through transform, PassThrough, source error rejection), finished (writable finish, readable end, error rejection, already-finished)

### 2026-03-24 — Phase 16: Networking Test Expansion + Housekeeping

**Housekeeping:**
- Committed pending eventsource GJS compatibility changes (Event/EventTarget polyfill fallbacks, runtime deps)
- Committed TextDecoderStream GJS fallback (manual UTF-8 buffering for missing `stream` option)
- Cleaned up STATUS.md priorities (removed duplicate WebCrypto entry, reordered by impact)

**Networking test expansion:**
- **net** (35 → 64 tests): isIP edge cases (full/compressed IPv6, zone IDs, IPv4-mapped, malformed, non-string input), Socket properties (pending, readyState, destroy, address), TCP connection lifecycle (connect state transitions, localAddress/localPort, bytesRead/bytesWritten, setEncoding, setTimeout, getConnections, remoteFamily, connection event, multi-byte UTF-8 echo, large data transfer, server address family)
- **dgram** (20 → 30 tests): Multiple sends, UDP echo round-trip, rinfo.size, Socket as EventEmitter, ipv6Only option

### 2026-03-24 — Phase 15: Test Coverage Expansion

**Stream package** test expansion (66 → 87 tests):
- Writable backpressure: HWM threshold, drain event, writableLength, writableEnded/Finished state tracking
- ObjectMode: Transform with objects, Readable objectMode, readableObjectMode property
- Destroy behavior: idempotent destroy, error emission, close events on both Readable and Writable
- Pipe error handling: unpipe stops data flow, error isolation between piped streams

### 2026-03-24 — Phase 14: EventSource (Server-Sent Events)

**New package `@gjsify/eventsource`** — W3C EventSource (Server-Sent Events):

- **EventSource** class extending EventTarget with CONNECTING/OPEN/CLOSED states
- **TextLineStream** utility: TransformStream splitting stream into lines (\n, \r\n, standalone \r)
- SSE field parsing: event, data, id, retry fields per HTML spec
- Multi-line data support (multiple `data:` fields concatenated with \n)
- Comment filtering (lines starting with `:`)
- Auto-reconnection with configurable retry delay, new AbortController per attempt
- `onopen`/`onmessage`/`onerror` attribute handlers + addEventListener support
- `lastEventId` tracking via `id:` field
- Global registration on GJS
- **24 tests**: 4 TextLineStream + 11 unit tests + 9 SSE integration tests (real HTTP server)

### 2026-03-24 — Phase 13: WebCrypto (crypto.subtle)

**New package `@gjsify/webcrypto`** — W3C WebCrypto API for GJS:

- **SubtleCrypto** class with all major methods:
  - `digest`: SHA-1, SHA-256, SHA-384, SHA-512 (wraps @gjsify/crypto Hash/GLib.Checksum)
  - `encrypt`/`decrypt`: AES-CBC, AES-CTR, AES-GCM (wraps @gjsify/crypto cipher.ts)
  - `sign`/`verify`: HMAC (wraps @gjsify/crypto hmac.ts)
  - `generateKey`: AES (128/192/256), HMAC, ECDH (P-256/P-384/P-521), ECDSA key pairs
  - `importKey`/`exportKey`: raw, jwk formats for symmetric + EC keys
  - `deriveBits`/`deriveKey`: PBKDF2, HKDF, ECDH
- **CryptoKey** class with type/extractable/algorithm/usages + frozen properties
- **Crypto** polyfill: `getRandomValues()`, `randomUUID()`, `subtle`
- Native passthrough on Node.js (uses globalThis.crypto.subtle), polyfill on GJS
- Global `crypto` registration on GJS
- **37 tests**: digest, generateKey, importKey/exportKey round-trip, AES encrypt/decrypt (CBC/CTR/GCM with AAD), HMAC sign/verify, PBKDF2/HKDF deriveBits, ECDH shared secret, deriveKey, CryptoKey properties, getRandomValues, randomUUID

### 2026-03-24 — Phase 12: TextEncoderStream / TextDecoderStream

**Added to `@gjsify/web-streams`** — WHATWG Encoding Streams:

- **TextEncoderStream**: Encodes string chunks to UTF-8 Uint8Array via TransformStream. Handles surrogate pairs split across chunks (buffers pending high surrogates, emits U+FFFD for unpaired surrogates at stream end). Reference: `refs/deno/ext/web/08_text_encoding.js`.
- **TextDecoderStream**: Decodes byte chunks to strings via TransformStream wrapping `TextDecoder` with `stream: true`. Supports `encoding`, `fatal`, `ignoreBOM` options. Handles multi-byte UTF-8 sequences split across chunks.
- **Global registration**: On GJS, registers `TextEncoderStream` and `TextDecoderStream` as globals (not natively available in GJS 1.86).
- **Re-exports**: Available via `stream/web` module (same as `@gjsify/web-streams`).
- **22 new tests** (117 total for web-streams): Constructor, encoding properties, ASCII/multi-byte/4-byte encode/decode, empty chunks, surrogate pair split, unpaired surrogate replacement, ArrayBuffer input, round-trip (ASCII, Unicode, split surrogates).
- All 117 tests pass on Node.js 24. Foundation for Phase 14 (EventSource).

### 2026-03-24 — Phase 11: WHATWG Web Streams API (@gjsify/web-streams)

**New package `@gjsify/web-streams`** — complete WHATWG Streams polyfill for GJS, ported from `refs/node/lib/internal/webstreams/` (pure TypeScript, no native bindings):

- **WritableStream** (Phase 1): WritableStream, WritableStreamDefaultWriter, WritableStreamDefaultController, backpressure, abort/close lifecycle
- **ReadableStream** (Phase 2): ReadableStream, ReadableStreamDefaultReader, ReadableStreamDefaultController, tee, pipeTo, pipeThrough, async iteration, `ReadableStream.from()` (iterables/async iterables)
- **TransformStream** (Phase 3): TransformStream, TransformStreamDefaultController, backpressure coordination, flush/cancel
- **Queuing strategies**: ByteLengthQueuingStrategy, CountQueuingStrategy
- **Consumer integration** (Phase 4): `stream/web` re-exports from `@gjsify/web-streams`, `compression-streams` uses real TransformStream (SimpleReadable/SimpleWritable shims removed)
- **Global registration**: On GJS, registers ReadableStream/WritableStream/TransformStream as globals
- **95 tests** pass on both Node.js 24 and GJS 1.86
- BYOB/byte streams deferred (Phase 5, optional)

### 2026-03-24 — Phase 10: Promote 4 packages to Full, add 2 Web API packages

**Promoted http, crypto, tls, https from Partial → Full (27 → 31 Full, 69% → 79%):**

- **http** (93 → 136 tests): Added `OutgoingMessage` base class, `setMaxIdleHTTPParsers` stub. API surface now matches Node.js http module. Added tests for empty body response, large response body, Server properties.
- **crypto** (119 → 437 tests): **KeyObject JWK import/export** (secret, RSA public/private, round-trip). **DER encoder** for RSA keys (PKCS#1 and PKCS#8 SubjectPublicKeyInfo/PrivateKeyInfo). **Derived public key** now exports valid PEM (was `[derived-public-key]` marker). **X509Certificate class** — full ASN.1 X.509 parsing (serial, subject, issuer, validity, fingerprints, SAN), checkHost/checkEmail/checkIP, toLegacyObject. Added `x509.spec.ts` with 18 tests.
- **tls** (19 → 36 tests): **Client TLS handshake** — `connect()` now wraps TCP `Gio.SocketConnection` with `Gio.TlsClientConnection`, performs async handshake, emits `secureConnect`. **Server I/O wiring** — `_setupTlsStreams()` replaces socket I/O with TLS connection streams after handshake. **ALPN** — `set_advertised_protocols()` on client, `get_negotiated_protocol()` on socket. Certificate validation via `accept-certificate` signal.
- **https** (17 → 32 tests): Confirmed functional — Soup.Session handles HTTPS natively for client requests.

**New Web API packages (7 → 10):**

- **@gjsify/compression-streams** (25 tests): W3C CompressionStream/DecompressionStream (gzip, deflate, deflate-raw). Uses native on Node.js. GJS polyfill blocked on Web Streams API availability.
- **@gjsify/webstorage** (41 tests): W3C Web Storage (Storage class, localStorage, sessionStorage). In-memory implementation, works on both Node.js and GJS. setItem/getItem/removeItem/clear/key, Unicode support.

**Key discovery:** GJS 1.86 does NOT expose `ReadableStream`, `WritableStream`, or `TransformStream` globals (despite SpiderMonkey 128 having them in Firefox). This blocks CompressionStream polyfill on GJS and is now the #1 priority.

### 2026-03-24 — Phase 9: Fix worker_threads, zlib, string_decoder for CI

- **worker_threads**: Fixed `structuredClone` unavailability in GJS by adding `cloneValue()` fallback (JSON round-trip). Switched message dispatch from `Promise.resolve().then()` to `setTimeout(fn, 0)` for GLib main loop integration. All 56 tests pass on GJS.
- **zlib**: Implemented sync methods (`gzipSync`, `gunzipSync`, `deflateSync`, `inflateSync`, `deflateRawSync`, `inflateRawSync`) using `Gio.ZlibCompressor`/`Gio.ZlibDecompressor`. Replaced legacy `imports.gi` access with proper `@girs/*` imports. All 340 tests pass on both platforms.
- **string_decoder**: Replaced `TextDecoder` dependency with pure manual UTF-8 decoder implementing W3C maximal subpart algorithm. Fixes `F0 B8 41` handling on GJS 1.80 (SpiderMonkey 115) where `TextDecoder` produces incorrect replacement character count.

### 2026-03-24 — Phase 8: http2 — From Stub to Partial

**Promoted http2 from Stub → Partial** with complete constants, settings functions, and class stubs:

- **Complete constants** (200+ entries): All NGHTTP2 error codes (RFC 7540 §7), session types, stream states, frame flags, settings IDs, default settings values, frame size constraints, padding strategies, HTTP/2 pseudo-headers, 70+ standard HTTP headers, 40+ HTTP methods, 60+ HTTP status codes
- **Settings functions**: `getDefaultSettings()` returns RFC 7540 defaults, `getPackedSettings()` / `getUnpackedSettings()` implement binary SETTINGS frame encoding (6-byte pairs: 2-byte ID + 4-byte value, big-endian)
- **Class stubs** (EventEmitter-based): `Http2Session` (localSettings/remoteSettings, settings/goaway/ping/close/destroy), `Http2Stream` (state machine, close/destroy/priority), `ServerHttp2Session`, `ClientHttp2Session`, `ServerHttp2Stream`, `ClientHttp2Stream`, `Http2ServerRequest` (headers/method/url/authority/scheme), `Http2ServerResponse` (setHeader/getHeader/writeHead/write/end)
- **102 tests** (was 5): constants (error codes, session types, stream states, settings IDs, default values, frame flags, pseudo-headers, HTTP headers/methods/status codes, frame size constraints), getDefaultSettings properties, getPackedSettings/getUnpackedSettings round-trip, sensitiveHeaders, factory functions, class exports
- All 102 tests pass on both Node.js 24 and GJS 1.86

**Soup 3.0 HTTP/2 findings**: Soup can negotiate HTTP/2 via ALPN but treats it as transparent — no multiplexed stream API. Full createServer/connect would require nghttp2 bindings (Vala extension) or a pure-JS HTTP/2 frame parser.

### 2026-03-24 — Phase 7: worker_threads — From Stub to Partial

**Promoted worker_threads from Stub → Partial** with full MessageChannel/MessagePort/BroadcastChannel implementation and subprocess-based Worker prototype:

- **MessagePort** (EventEmitter-based): `postMessage` with `structuredClone`, auto-start on `on('message')`, message queue for pre-start delivery, `close()` with cleanup, `ref()`/`unref()` stubs
- **MessageChannel**: Creates paired MessagePorts for bidirectional communication
- **BroadcastChannel** (W3C API): Global registry by name, `onmessage` property, `addEventListener`/`removeEventListener`, `close()` with registry cleanup, no self-delivery
- **Worker** (Gio.Subprocess): Spawns `gjs` child process with embedded bootstrap script, stdin/stdout IPC (newline-delimited JSON), `postMessage`/`on('message')`/`terminate()`, `eval: true` mode, environment variable passthrough
- **Worker context detection**: `globalThis.__gjsify_worker_context` flag lets bundled worker scripts import correct `parentPort`/`workerData`/`threadId` from `worker_threads`
- **Utility functions**: `receiveMessageOnPort` (synchronous dequeue), `getEnvironmentData`/`setEnvironmentData`, `markAsUntransferable`, `markAsUncloneable`, `moveMessagePortToContext`
- **56 tests** (was 6): exports, MessageChannel message delivery (string/object/multi/order), clone verification, MessagePort auto-start/close/once, receiveMessageOnPort (empty/sync/dequeue), BroadcastChannel (same-name/self/different-name/closed/multi-receiver), environmentData CRUD, utility functions
- All 56 tests pass on both Node.js 24 and GJS 1.86

**Research findings documented:**
- GJS intentionally blocks `GLib.Thread.new()` (throws "Use GIO async methods or Promise()")
- SpiderMonkey JSContext is thread-bound — no parallel JS execution possible in-process
- Subprocess-based approach (Ansatz A) is the only viable path for true parallelism
- Vala extension approach (Ansatz B) would require wrapping `gjs_context_new()` — unstable API
- libpeas (Ansatz C) is designed for plugins, not worker pools

### 2026-03-24 — Phases 1–5: Major Feature Implementation

**Phase 1 — HTTP client round-trip on GJS:**
- Fixed ClientRequest to buffer response body before emitting 'response' (race condition fix)
- Fixed ServerResponse double 'finish' emission
- Fixed stream nextTick to prefer queueMicrotask
- All 93 HTTP tests now pass on GJS (6 round-trip tests: GET, POST, headers, 404, etc.)

**Phase 2 — WebSocket Web API:**
- New package `@gjsify/websocket` using Soup 3.0 WebsocketConnection
- W3C spec: WebSocket, MessageEvent, CloseEvent, text + binary support
- 27 tests including 3 round-trip tests with echo server

**Phase 3 — Crypto DH/ECDH/AES-GCM:**
- DiffieHellman: BigInt-based, RFC 2409/3526 groups (modp1–modp18)
- ECDH: Pure TypeScript elliptic curve arithmetic (secp256k1, P-256, P-384, P-521)
- AES-GCM: GHASH authentication in GF(2^128), AAD support
- 30 new tests

**Phase 4 — Crypto Sign/Verify/RSA:**
- ASN.1/DER/PEM parser for RSA keys (PKCS#1 and PKCS#8)
- createSign/createVerify: RSA PKCS#1 v1.5 signatures
- publicEncrypt/privateDecrypt: RSA encryption
- 11 new tests

**Phase 5 — TLS server, fs async, STATUS.md updates**

### 2026-03-23 — Phase 0: Housekeeping

- Reclassified **globals** from Partial → Full (40 tests, all essential globals implemented)
- Reclassified **readline** from Partial → Full (50 tests, Interface/createInterface/question/prompt/async-iterator)
- Updated CLAUDE.md: dgram from Stub → Full (was already correct in STATUS.md)
- Updated metrics: 27 fully implemented (69%), 4 partial (10%), 8 stubs (21%)

### 2026-03-23 — Wave 8

**Remaining packages — expand tests:**

| Package | Before | After | Focus Areas |
|---------|--------|-------|-------------|
| globals | 15 | 96 | process (platform/argv/pid), Buffer (alloc/isBuffer), structuredClone (full polyfill: Date, RegExp, Error, TypedArrays, Map, Set, circular refs, DataCloneError), TextEncoder/Decoder, atob/btoa, URL/URLSearchParams, console |
| child_process | 26 | 35 | execFile error, spawnSync env, exports validation, edge cases |

### 2026-03-23 — Wave 7

**Networking completion — HTTPS & TLS tests:**

| Package | Before | After | Focus Areas |
|---------|--------|-------|-------------|
| https | 2 | 17 | Agent (defaultPort/protocol), request/get wrapper, exports, globalAgent |
| tls | 2 | 19 | TLSSocket API (encrypted, getPeerCert, getProtocol, getCipher), createSecureContext, constants |

### 2026-03-23 — Wave 6

**Crypto expansion — implementation + tests:**

| Package | Component | Tests | Description |
|---------|-----------|-------|-------------|
| crypto | Cipher/Decipher | +25 | Pure-JS AES (FIPS-197): CBC, CTR, ECB; PKCS#7 padding; NIST test vectors |
| crypto | scrypt | +11 | RFC 7914 (Salsa20/8 + BlockMix + ROMix); sync + async; RFC test vectors |

**New implementations:**
- **cipher.ts:** Complete AES-128/192/256 implementation in pure TypeScript. S-Box, InvS-Box, KeyExpansion, MixColumns, ShiftRows. Modes: CBC (with IV chaining), CTR (stream cipher), ECB (no IV). PKCS#7 padding with setAutoPadding().
- **scrypt.ts:** RFC 7914 scrypt in pure TypeScript. Uses Salsa20/8 Core, BlockMix, ROMix. Internally uses pbkdf2Sync (already available).

### 2026-03-23 — Wave 5

**Networking foundation — tests + implementation polish:**

| Package | Before | After | Focus Areas |
|---------|--------|-------|-------------|
| net | 8 | 35 | isIP/isIPv4/isIPv6 complete, Socket/Server API, TCP echo/multi-connect (Node.js) |
| dgram | 10 | 20 | createSocket options, bind, UDP send/receive round-trip (Node.js) |
| http | 24 | 42 (2 specs) | STATUS_CODES/METHODS, Agent, Server round-trip (GET/POST/404/Headers, Node.js) |

### 2026-03-23 — Wave 4

**Test expansions (quick wins for already implemented packages):**

| Package | Before | After | Focus Areas |
|---------|--------|-------|-------------|
| dns | 3 | 50 (2 specs) | Constants, lookup options (family/all), resolve4/6, reverse, dns/promises complete |
| timers | 28 | 43 (2 specs) | Ordering, negative delays, nested timers, refresh, setInterval with AbortController |
| zlib | 15 | 27 | Unicode, binary, large data, constants, cross-format errors, gzip magic bytes |
| module | 14 | 21 | createRequire, builtinModules validation, isBuiltin with subpaths/prefixes |
| tty | 14 | 23 | isatty with various fds, ReadStream/WriteStream properties |
| perf_hooks | 18 | 30 | mark/measure/getEntries, clearMarks, toJSON, timeOrigin validation |

### 2026-03-23 — Waves 1–3

**New tests (selection):**

| Package | Before | After | Source |
|---------|--------|-------|--------|
| crypto | 38 | 144 | +Hmac specs, PBKDF2/HKDF tests |
| os | — | 240 | Extensive reference tests ported |
| util | 52 | 110 | format edge cases (%%, -0, BigInt, Symbol) |
| events | 60 | 119 | Extended EventEmitter tests |
| buffer | 52 | 123 | Encoding, alloc, compare, slice |
| url | — | 82 | URL/URLSearchParams compatibility tests |
| stream | 49 | 66 | Async scheduling, backpressure |
| console | — | 57 | Console.log/warn/error, formatting |
| readline | 15 | 50 | Line endings, Interface events |
| child_process | 4 | 26 | cwd, env, encoding, spawnSync |
| diagnostics_channel | 8 | 26 | Channel, TracingChannel |
| module | 6 | 14 | builtinModules, isBuiltin |

**Implementation fixes:**

- **crypto:** Replaced GLib.Hmac with pure-JS HMAC (RFC 2104) due to segfault. PBKDF2 + HKDF use the new Hmac implementation. 144 tests green on both platforms.
- **child_process:** `cwd` and `env` options via `Gio.SubprocessLauncher`; `spawnSync` with encoding support.
- **readline:** `\r` recognized as standalone line ending.
- **util.format:** `%%` escape, `-0`, BigInt, Symbol, `%i` with Infinity→NaN, remaining args without quotes.
- **os.cpus:** Real `times` from `/proc/stat` (jiffies → ms) instead of zeros.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        User Application                         │
├─────────────────────────────────────────────────────────────────┤
│  import 'fs'  │  import 'http'  │  import 'stream'  │  fetch() │
├───────────────┴─────────────────┴────────────────────┴──────────┤
│              esbuild + @gjsify/esbuild-plugin-gjsify            │
│         (aliased: fs → @gjsify/fs, http → @gjsify/http)        │
├─────────────────────────────────────────────────────────────────┤
│                     @gjsify/* Implementations                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────────┐  │
│  │ @gjsify/  │  │ @gjsify/  │  │ @gjsify/  │  │ @gjsify/fetch │  │
│  │ fs       │  │ http     │  │ stream   │  │               │  │
│  └────┬─────┘  └────┬─────┘  └──────────┘  └──────┬────────┘  │
│       │              │                              │           │
├───────┴──────────────┴──────────────────────────────┴───────────┤
│                     GNOME Libraries (GIR)                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │ Gio 2.0  │  │ Soup 3.0 │  │ GLib 2.0 │  │ Gtk 4.0  │       │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘       │
├─────────────────────────────────────────────────────────────────┤
│              GJS (SpiderMonkey 128 / ES2024)                    │
└─────────────────────────────────────────────────────────────────┘
```
