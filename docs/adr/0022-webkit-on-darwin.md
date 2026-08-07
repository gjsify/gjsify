# ADR 0022 — `@gjsify/iframe` on macOS: Apple's WebKit behind a GObject shim that answers to `gi://WebKit` 6.0

- **Status:** Accepted (2026-08-07)
- **Scope:** `@gjsify/iframe` (Framework pillar) and its `WebKit.WebView` dependency; `@gjsify/webkit-native` + its `*-darwin-*` per-target set (distribution per ADR 0017, OS axis per ADR 0018).
- **Amended while implementing.** Two decisions in the Proposed draft were measured wrong and are corrected below, each with the measurement that overturned it: the shim does NOT take its own namespace (§ *One namespace*), and stage 2 does NOT go through `IOSurface`/`CARenderer` (§ *The renderer question*). A third finding the draft had no idea about — the run loop — is what stage 1 actually turned on.

## Context

ADR 0018 made Linux, macOS and Windows a declared, checked target set, and
`macos-suites.yml` now runs the **Node** pillar there on both architectures.
`@gjsify/iframe` is Framework-pillar and is in no macOS leg; its suite runs
only under `gjsify foreach test` on Fedora, where WebKitGTK 6.0 exists. This
ADR is about why that gap is not closed by adding a package to a matrix.
Measured by hand on the host, importing the package's own dependency:

```
JS ERROR: Error: Requiring WebKit, version 6.0:
  Typelib file for namespace 'WebKit', version '6.0' not found
```

That reads like a missing install. It is not. Measured on macOS 15.7.8 against
Homebrew's `webkitgtk` formula (2.52.5), every one of these independently
blocks it:

| | fact | consequence |
|---|---|---|
| 1 | `depends_on :linux`, unconditional, at the top level of the formula body | Homebrew refuses it on macOS by construction |
| 2 | the formula states its own reason: `# Use JavaScriptCore.Framework on macOS.` | this is upstream's position, not a packaging oversight |
| 3 | bottles are `arm64_linux` and `x86_64_linux` only | no macOS binary exists; it would have to build from source |
| 4 | the would-install closure pulls `systemd`, `wayland`, `mesa`, `libdrm`, `libxkbcommon` | there is no `systemd` for macOS |
| 5 | it builds `-DUSE_GTK4=OFF` and its own test links `webkit2gtk-4.1` | even on Linux this formula is the **GTK3** port, while `@gjsify/iframe` requires `gi://WebKit` **6.0**, the GTK4 one |

MacPorts is not installed on the test host and `brew search webkit` offers no
alternative tap. So this is an upstream platform gap: the WebKit **GTK port**
targets X11/Wayland, and macOS gets the **Mac port** — Apple's
`WebKit.framework` — which ships no GObject-Introspection typelib.

### What macOS actually has, measured

The tempting summary is "macOS has no WebKit". The opposite is true, and the
distinction decides the whole design: **macOS has complete WebKit with a
complete DOM. What it lacks is a GI binding and a GTK widget.**

`docs/poc/webkit-darwin-probe.m` runs the surface `@gjsify/iframe` actually
uses against `WKWebView`, in a **non-bundled CLI process** — deliberately, since
that is the process shape a `gjs` is (no `.app`, no bundle identifier):

```
probing WKWebView in a NON-BUNDLED process (no .app):
  [ok] script message from the page: hello from the user script
  [ok] navigation finished  (== WebKit.LoadEvent.FINISHED)
  [ok] evaluateJavaScript -> gjsify/document-start
  [ok] takeSnapshot -> 800x600 px, 32 bpp  (== Gdk.Texture source)
verdict: the engine half maps 1:1
```

`gjsify/document-start` is one expression evaluating two things at once: the
DOM query `document.querySelector('h1').textContent` **and** the global a user
script set at document-start. Both halves answered.

The surface that has to map is small. Counting `WebKit.`-qualified occurrences
over the 14 files `@gjsify/iframe` actually ships — `packages/framework/iframe/src/**/*.ts`
minus `*.spec.ts`, which is exactly what its `build:gjsify` script compiles:
`WebKit.WebView` 25×, `LoadEvent` 5×, `UserContentManager` 3×, `UserScript` +
`UserScriptInjectionTime` + `UserContentInjectedFrames` 2× each,
`SnapshotRegion` 2×, `SnapshotOptions` and `Settings` 1× each; four instance
methods — `evaluate_javascript` (14 call sites), `get_snapshot` (5),
`load_html` and `load_uri` (1 each).

| WebKitGTK 6.0 | Apple WebKit | measured |
|---|---|---|
| `WebKit.UserContentManager` + `UserScript` @ `INJECTION_TIME.START`, `INJECTED_FRAMES.ALL_FRAMES` | `WKUserContentController` + `WKUserScript` @ `AtDocumentStart`, `forMainFrameOnly:NO` | yes |
| `webView.evaluate_javascript()` | `evaluateJavaScript:completionHandler:` | yes |
| `load-changed` / `WebKit.LoadEvent` | `WKNavigationDelegate` | yes |
| `webView.get_snapshot(region, options)` → `Gdk.Texture` | `takeSnapshotWithConfiguration:` → `NSImage`/`CGImage` | yes |
| the `postMessage` bridge | `window.webkit.messageHandlers.<name>.postMessage` | yes — **the same spelling**, because it is the same WebKit |
| `WebKit.Settings` | `WKWebViewConfiguration` / `WKPreferences` | not probed |
| `WebKit.WebView` **as a `GtkWidget`** | `WKWebView` is an `NSView` | **no — see below** |

### What does not map, and why it is the expensive half

`IFrameBridge extends WebKit.WebView`. It is a `GtkWidget`: consumers write
`window.set_child(iframeWidget)`, and the class overrides `vfunc_size_allocate`
because GTK4 has no `resize` signal on `Gtk.Widget`.

`WKWebView` is an `NSView`, and **GTK4 has no foreign-window embedding**.
`GtkSocket`/`GtkPlug` are gone, and on macOS a `GdkSurface` is one `NSWindow`
that GSK renders into as a whole — widgets are not `NSView`s and there is no
public seam to insert one. A drop-in replacement for `WebKit.WebView` is
therefore not available at any effort level; the widget has to be built, not
bound.

### The blueprint already exists, twice

**Casilda** — a GTK4 widget that hosts a Wayland compositor — solves exactly
this problem, and its answer is the one to copy: it **reparents nothing**. The
content stays out-of-process, its buffers are composited into an ordinary GTK
widget, and input is forwarded synthetically. Substitute `WKWebView` +
`IOSurface` for "Wayland client + dmabuf" and that is the macOS design. As a
*transport* Casilda is unusable here — wlroots is Linux-only and GTK4 on macOS
is `GdkMacosDisplay`/Quartz — but the architecture transfers intact.

**WPE WebKit** is the closer relative: WebKit's embedded flavour, built to
render into a caller-provided buffer rather than own a toolkit window — "WebKit
as a texture producer and an input sink", which is precisely the contract
needed. Its FDO backend is Wayland-based, so again the shape transfers and the
transport does not.

### The run loop — the finding the draft was missing

`webkit-darwin-probe.m` measures the API surface under `[NSApp run]`, a full
AppKit run loop. That is **not** the process shape this runs in: GJS drives a
`GMainContext`, and the shim has no AppKit loop to borrow.

`docs/poc/webkit-runloop-darwin.m` runs the same `WKWebView` twice, changing one
thing:

```
  [1] bare GMainLoop, no CFRunLoop drain:
        TIMED OUT after 8 s — didFinishNavigation never fired
  [2] GMainLoop + a CFRunLoop drain source:
        navigation finished
        evaluateJavaScript -> 2
```

Case [1] does not run slowly, it runs **not at all** — `WKWebView`'s callbacks
are CFRunLoop sources and a `GMainContext` never looks at them. So the first
thing stage 1 needs is not a binding, it is a loop bridge; every API row in the
table above is unreachable without it. The shim installs a drain source while at
least one view is alive. The interval is a compromise with no better option: the
CFRunLoop's wakeup port is not public API, so there is no descriptor for a
`GSource` to poll and a timer is the only integration point.

The probe fails if EITHER half stops holding — a bare loop that worked would
mean the drain is dead weight — so it retires itself rather than becoming a
comment.

### The renderer question, measured rather than assumed

`docs/poc/gsk-renderer-darwin.gjs.js`, on the GPU-less Intel VM:

```
display        : GdkMacosDisplay
GSK_RENDERER   : <unset — GTK chooses>
  GskNglRenderer     available
  GskVulkanRenderer  available
  GskCairoRenderer   available
  GskGLRenderer      available
chosen renderer: GskGLRenderer
GL context     : GL — version 4.1
```

"available" there is what the typelib exposes, not a claim that each one would
realise; the load-bearing line is the one below it, which is what a real
`Gtk.Window` on this host actually got.

Three things follow. OpenGL on macOS is frozen at **4.1** and deprecated since
10.14 — it works (Apple implements it over Metal) but it is the legacy path;
this GTK4 also ships `GskVulkanRenderer`, which on macOS means MoltenVK → Metal.
Speed, however, does not come from picking an API: it comes from not copying.
The interchange currency is **`IOSurface`** — `CGLTexImageIOSurface2D` binds one
as a GL texture zero-copy, Metal takes one via
`newTextureWithDescriptor:iosurface:` — so a single `IOSurface` serves either
GSK backend and the choice need not be made in advance.

And the degradation falls out for free: hand GTK a `GdkGLTexture` where a GL
context exists and a `GdkMemoryTexture` where it does not. Same code, GPU-
resident on an M-series Mac, one software copy per frame on this VM.

The measurement also exposes a trap. **GTK does not fall back to cairo on its
own.** It chose GL here, and Apple's GL without a GPU rasterises in software —
which is why this VM feels frozen, why `GSK_RENDERER=cairo` helps *here*, and
why hardcoding that would be a regression on real hardware.

### The dead end, named because it is the tempting one

`JavaScriptCore.framework` alone is **not** a route. It is a JS engine: no DOM,
no loader, no rendering. Building a "WebKit polyfill" on it means writing a
browser engine, and the DOM-emulation direction is already occupied by
`@gjsify/domparser` and `@gjsify/dom-elements`. `WebKit.framework` is
emphatically not the dead end — it is the answer to the engine half.

One further finding, recorded because it is the *second* tempting shortcut: the
macOS SDK still ships the WebKit1 Objective-C DOM API (`DOMDocument`,
`createElement:`, `createTextNode:` are in `WebKit.framework/Headers/`), which
would give direct in-process DOM access with no JS round-trip. It belongs to
the deprecated single-process `WebView`, not to `WKWebView` — and WebKitGTK 6.0
removed its own DOM bindings too, so `@gjsify/iframe` already talks to the DOM
through `evaluate_javascript`. The convenient path binds us to a retired
engine; the inconvenient one preserves parity with the Linux backend.

## Decision

1. **Two stages, decided separately, because they cost differently.** Stage 1 is
   the engine and the loop bridge; stage 2 is the widget. Both landed; input
   forwarding is explicitly deferred (§ *What is not implemented*).

2. **Stage 1 — an Objective-C → GObject shim with a GIR and a typelib**,
   distributed by the pattern this repo already runs: `@gjsify/webkit-native`
   plus per-target packages behind an `optionalDependencies` bridge (ADR 0017),
   built by meson and staged by `stage-prebuild.mjs`. That pattern already
   carries darwin — `http2-native-darwin-x64`, `tls-native-darwin-x64` and
   `webgl-darwin-x64` each ship a `.dylib` with its `.gir` and `.typelib` beside
   it today. The header is pure C: `g-ir-scanner` has no Objective-C front end,
   so every doc comment and every `(transfer)`/`(nullable)`/`(scope async)`
   annotation lives there and the `@interface`s stay in the `.m`.

3. **ONE namespace: the shim IS `WebKit` 6.0.** *(Reverses draft decision 5,
   which called for a separate `GjsifyWebKit` namespace plus a backend seam in
   the consumer.)* GIR's namespace name and its identifier/symbol prefixes are
   independent knobs, so the C symbols stay `gjsify_webkit_*` while the typelib
   answers to `WebKit-6.0`. `@gjsify/iframe` therefore keeps `import WebKit from
   'gi://WebKit?version=6.0'` verbatim, and the backend is chosen by what is on
   `GI_TYPELIB_PATH` — by PACKAGING, not by a branch in shipping source.

   The separate namespace was built first and measured unworkable, which is the
   only reason this is not the tidier-sounding option:

   - a distinct namespace forces a seam module, and the seam has to pick a
     backend at import time;
   - ESM `gi://` has **no synchronous form**, so the seam needs a top-level
     await, which makes the whole `@gjsify/iframe` module graph async;
   - `@gjsify/unit` blocks on a nested `g_main_loop_run()` during start-up, so
     an async module graph **deadlocks the suite before its first test**.
     Measured: idle at 0.0% CPU, stack parked in
     `PromiseJobDispatcher::dispatch → … → g_main_loop_run`.

   The only synchronous escape is the legacy `imports.gi` object, which this
   repo bans outright as "NOT an API". Between a banned global and a namespace
   decided by packaging, packaging wins.

   The honest cost is stated in § *Consequences*: this is namespace squatting,
   and it is only defensible because the artifact ships in an `os: ["darwin"]`
   package and macOS provably has no other `WebKit-6.0` provider.

4. **The output type is `GdkTexture`, never a GL context the widget owns.**
   `GdkMemoryTexture` today, `GdkGLTexture` where a GL context exists. This is
   what makes hardware acceleration a property of the HOST rather than a build
   flag, and it is the reason the widget could be developed on a GPU-less VM at
   all.

5. **Stage 2 — a snapshot-driven widget, not a compositor.** *(Reverses draft
   decision 3, which specified `WKWebView` layer tree → `CARenderer` →
   `IOSurface`.)* `WKWebView` renders out-of-process and the host holds a remote
   layer, so there is no public path to a continuously-updated `IOSurface`; the
   draft assumed one existed. It also assumed the public path was too slow to
   matter, and that is the part the measurement overturned: at 1024×768 on the
   GPU-less Intel VM, `takeSnapshot` averages **15.8 ms — a ~63 fps ceiling**,
   before any GPU is involved.

   So the widget pulls: `WKWebView` → `takeSnapshot` → `GdkTexture` →
   `gtk_snapshot_append_texture()` in the widget's own `snapshot` vfunc, on a
   tick callback that runs only while mapped, with at most one snapshot in
   flight. Per `docs/governance.md` § `simplicity`, the simpler mechanism that
   clears the bar is the one that ships; `IOSurface` becomes an optimisation
   with a measurement to beat rather than a premise.

6. **`WebKit.WebView` is a derivable `GtkWidget`.** `IFrameBridge extends
   WebKit.WebView` and consumers write `window.set_child(iframeWidget)`, so the
   shim's type must be BOTH a `GtkWidget` and subclassable. A
   `G_DECLARE_FINAL_TYPE` compiled, installed, and then failed at the one call
   the port exists to preserve — GJS raises *"Cannot inherit from a final
   type"*. Likewise `UserScript` is a **boxed** type, matching
   `WebKitUserScript`, because GJS maps a boxed `new` constructor onto
   `new WebKit.UserScript(source, frames, time, allow, block)` while a GObject
   would demand `new UserScript({…})`. Neither is a style question: both change
   the call the consumer has to write.

## Consequences

- **The consumer did not change.** `@gjsify/iframe` has no seam module, no OS
  branch and no `gjsify.os` declaration — the draft predicted it would need one
  "the moment the backend seam introduces a host branch", and decision 3 is why
  that moment never arrived. Its whole suite (**291 tests**) now passes on
  darwin, where the package previously could not load at all.
- **This is namespace squatting, and the risk is real if narrow.** A second
  `WebKit-6.0` typelib on `GI_TYPELIB_PATH` would shadow, and ours is a SUBSET —
  a consumer reaching for `WebKit.WebContext` gets `undefined`, not an error.
  Three things bound it: the artifact ships only in an `os: ["darwin"]` package,
  macOS provably has no other provider (§ Context), and `@gjsify/iframe` is the
  only consumer. A macOS host that built WebKitGTK from source is the case this
  gets wrong, and it is listed in `status/open-todos.md` rather than defended
  against speculatively.
- **A new published `@gjsify/*` name costs a manual bootstrap.** npm Trusted
  Publishing requires the package to already exist, so the first publish is a
  maintainer action (`gjsify onboard`, `--dry-run` first) BEFORE the release that
  ships it — see [docs/publishing.md](../publishing.md). Skipping it makes
  `release.yml`'s OIDC exchange 404 and stalls every alphabetically later
  package; that is the v0.4.20 incident, which left 60+ packages at 0.4.19.
- **A pre-existing bug in `@gjsify/iframe` surfaced and is fixed here.**
  `promisify.ts` is a side-effect-only module, and `sideEffects` was pinned to
  `register.js` alone — so `Gio._promisify` was **tree-shaken out of every app
  bundle**, and `evaluateJavaScript()`/`takeScreenshot()` threw *"At least 6
  arguments required, but only 5 passed"*. That is platform-independent: the
  bundler drops it for Linux consumers too. It stayed invisible because the unit
  suites never call the live methods and GJS 1.88 does not auto-promisify from
  `glib:finish-func`/`glib:async-func` alone (verified: both attributes present,
  still no promise).
- **The run-loop drain is a timer, and that is a real cost.** It wakes while any
  view is alive. It is refcounted so a program that has finished with WebKit
  stops paying, but an idle page still costs a periodic wakeup — the CFRunLoop
  exposes no descriptor to poll instead.
- **`WKWebView` runs its own content process.** The plain CLI case is measured
  working; App Sandbox, hardened runtime and service contexts are untested, and a
  `gjs` process has no bundle identifier, which some WebKit features key on.

### What is not implemented

Each fails loudly rather than silently, which is the difference between a subset
and a lie:

- **Input forwarding.** The widget renders; mouse, keyboard, focus, scroll and
  IME are not forwarded to the web content. This is the half the draft correctly
  called "comparable in size to the rendering half", and it remains its own
  track.
- **Named script worlds.** `WKWebView` has no public isolated-world API, so
  `register_script_message_handler(name, world)` returns `FALSE` for a
  non-`NULL` world instead of quietly registering into the page world, where
  page scripts could reach it.
- **User-script allow/block lists.** Not a WebKit feature — WebKitGTK implements
  them above WebKit. A non-empty list warns rather than being dropped.
- **`darwin-arm64`.** The code is architecture-independent and this VM is Intel.
  Per ADR 0018, a platform is declared when a job builds it, not when it would
  compile, so `gjsify.platforms` says `darwin-x64` only.

## Implementation

1. `packages/framework/webkit-native/` — `meson.build`, `src/objc/gjsify-webkit.h`
   (pure C, every GIR annotation) and `src/objc/gjsify-webkit.m` (all the
   Objective-C), producing `libgjsifywebkit.dylib` + `WebKit-6.0.{gir,typelib}`.
2. The run-loop drain, refcounted on live views.
3. `WebView` as a derivable `GtkWidget` with a snapshot-driven `snapshot` vfunc,
   a tick callback live only while mapped, and `size_allocate` resizing the
   offscreen view so the page lays out to the widget's width.
4. `@gjsify/iframe`: `sideEffects` gains `./lib/esm/promisify.js`. That is the
   package's ONLY change.
5. `docs/poc/webkit-runloop-darwin.m`, which fails if either half of the run-loop
   finding stops holding.
6. Per-target split per ADR 0017 and the `gjsify onboard` bootstrap before the
   release that ships the new names.

## Do not

- **Do not give the shim its own namespace "for honesty".** It was built that
  way first; the seam it forces needs a top-level await, and that deadlocks
  `@gjsify/unit` before its first test (decision 3). If the squatting has to go,
  the replacement is a synchronous backend selector, not a seam — and GJS
  currently offers none that this repo permits.
- **Do not reach for `IOSurface`/`CARenderer` without beating 15.8 ms.**
  `WKWebView`'s layer tree is out-of-process and has no public zero-copy path;
  the snapshot route already clears 60 fps on the slowest host in the fleet.
- **Do not hardcode `GSK_RENDERER`.** GTK picks GL on macOS and does not degrade
  to cairo on its own; forcing cairo is right on a GPU-less VM and wrong on real
  hardware. Renderer selection belongs to the host.
- **Do not build on `JavaScriptCore.framework` alone**, and do not read "macOS
  has no WebKitGTK" as "macOS has no WebKit" — the engine and its DOM are
  complete, the binding and the widget are what was missing.
- **Do not reach for the WebKit1 ObjC DOM API** because it is the shorter path.
  It is a deprecated single-process engine, and WebKitGTK 6.0 has no DOM
  bindings either, so it would buy a shortcut on one platform at the price of
  parity.
- **Do not make `WebView` final, or `UserScript` a GObject.** Both compile,
  install, and then break the exact call the port exists to preserve.
