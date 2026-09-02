# ADR 0022 — `@gjsify/iframe` on macOS: Apple's WebKit behind a GObject shim that answers to `gi://WebKit` 6.0

- **Status:** Accepted (2026-08-07)
- **Scope:** `@gjsify/iframe` (Framework pillar) and its `WebKit.WebView` dependency; `@gjsify/webkit-native` + its `*-darwin-*` per-target set (distribution per ADR 0017, OS axis per ADR 0018).
- **Amended while implementing.** Two decisions in the Proposed draft were measured wrong and are corrected below, each with the measurement that overturned it: the shim does NOT take its own namespace (§ *One namespace*), and stage 2 does NOT go through `IOSurface`/`CARenderer` (§ *The renderer question*). A third finding the draft had no idea about — the run loop — is what stage 1 actually turned on.
- **Amended again after the first release.** Input forwarding — deferred as its own track — has landed, and two of the four "not implemented" bullets turned out to be mistakes of fact rather than deferrals: named script worlds and user-script allow/block lists are both implementable and both now ship. See § *Input forwarding* and § *What the first revision got wrong*, each with the measurement behind it.
- **Amended a third time, on the runtime axis.** `@gjsify/iframe` declared `gjsify.runtimes.node: "none"` while its suite measurably ran on Node over the reverse bridge — and Node is the only host macOS and Windows have for this pillar. See § *Amendment — the `node` slot*.

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

### Amendment — the `node` slot

`@gjsify/iframe` declares
`{gjs: polyfill, node: polyfill, browser: none, nativescript: none}`.

**`node` was `none` from the day the package was written, and that is amended
rather than quietly corrected** — the same error [ADR 0027](0027-gtk-host-layer.md)
had to amend for `@gjsify/gtk-host`, for the same reason. The package binds GJS
through nothing but `gi://` — `WebKit`, `JavaScriptCore`, `GLib`, `GObject`,
`Gio` — and the `--app node` target rewrites every one of those to
`@gjsify/node-gi`'s `requireGi(…)`. Nothing pinned this package to GJS but the
declaration and a `test:gjs`-only script.

Amended on measurements this repository already carried while the manifest said
the opposite:

- `docs/reports/node-gi-consumer-survey.json` — the whole suite built `--app node`
  and run over the reverse bridge: **275/275 on node, bun AND deno** (Fedora 44,
  GJS 1.88.0, Node 24.15.0, girepository-2.0 2.88.1). Re-measured while writing
  this amendment on GJS 1.88.1 / Node 24.19.0, with `DISPLAY` and
  `WAYLAND_DISPLAY` both unset: **the two legs agree test for test**, the node
  bundle carrying `requireGi("WebKit","6.0")` beside `GLib`, `Gio`, `GObject` and
  `GdkPixbuf`.
- `packages/framework/webkit-native/README.md` — on darwin-x64 under Node 24,
  `load_html()` on a `WebKit.WebView` reaches `LoadEvent.FINISHED` via `STARTED`
  and `COMMITTED`, so the CFRunLoop drain decision 2 rests on is serviced on Node
  as well as on GJS. Re-measured 2026-09-02 on macOS 15.7.9 / Node 24.18.1
  against the published 0.45.0 packages, with `evaluate_javascript()` reading
  back the loaded document: 12 runs, natural exit and `process.exit()` alike, no
  crash on teardown, and a bare `GLib.MainLoop.run()` is enough — no
  `Adw.Application`. That run is also what settled how far the claim reaches,
  below.

**What `node: "polyfill"` claims here is the `--app node` BUILD**, not a bare
`node_modules` import. The published `lib/esm` carries literal
`gi://WebKit?version=6.0` specifiers, and Node has no loader hook for that scheme
(`ERR_UNSUPPORTED_ESM_URL_SCHEME`), so a Node consumer reaches this package
through `gjsify build --app node`, which is what rewrites the specifier to
`requireGi(…)`. That is the runtime axis as the root `AGENTS.md`
§ *Runtime & platform model* defines it — the quintuplet is the INPUT to slot
routing, read at build config time — and it is true of every GJS-bound package in
the tree, not a caveat of this one.

`register.spec.ts` stood down on the node leg while it was wrapped in
`on('Gjs', …)`, which read as `/register` being the one part the node leg could
not cover. The GATE was the reason, not the code: `--app node` resolves the same
WebKit import chain through `requireGi()`, and widened to
`on(['Gjs', 'Node.js', 'Bun', 'Deno'], …)` those tests pass on all four at the
same count as on GJS (measured: node 24.19.0, bun 1.3.14, deno 2.9.4 — ONE
`--app node` bundle serves the three Node-API hosts, so a gate naming one of
them stood the other two down for no measured reason either).
A gate written while the slot said `none` outlives the reason it was written for,
and the axis ledger reports it as a stand-down either way — which is honest about
what ran, and says nothing about what could have.

The reason this matters is not portability for its own sake. **There is no GJS
host for this pillar on macOS or on Windows** — ADR 0024 § 4 puts macOS
applications on Node + `@gjsify/node-gi`, and [ADR 0035](0035-web-view-on-win32.md)
does the same for win32. `node: "none"` therefore denied the WebView pillar on the
only host either platform has, which is precisely the platform this ADR exists to
serve.

`browser` and `nativescript` stay `none`, and that is not the same kind of claim:
on those two targets `gi://` is substituted with `{}`, so a wrong declaration
there fails SILENTLY — which is why the reachability pass treats them as fatal and
`node` only as a warning.

`@gjsify/webkit-native` keeps `node: "none"` and that is not a contradiction. It
ships no JavaScript at all — only the dylib and the typelib, both runtime-neutral
— and the runtime axis describes a package's own JavaScript. Its README says so;
which host loads the typelib is decided by `GI_TYPELIB_PATH`, i.e. by packaging,
exactly as decision 3 has it.

The slot flips in the same change that gives it a **test leg**, because a declared
runtime with no suite behind it is the defect ADR 0030 § Decision 6 names:
`test:gjs-on-node` builds the same corpus `--app node` and runs it on Node, wired
into `node-gi.yml` beside `@gjsify/gtk-host`'s. Which packages take that step is a
JUDGEMENT and not derivable — `@gjsify/sqlite` runs the identical leg and is
correctly `node: "none"`, because on Node you use `node:sqlite` and its leg proves
the BRIDGE rather than a node consumer story. What is mechanised is the other
direction, in the `reverse-bridge-leg` conformance rule: a package that reaches
Node only through the reverse bridge and declares `node: "polyfill"` must run a
Node suite CI actually reaches.

#### What the leg found: `@gjsify/message-channel` routed the ports away

The node leg does not merely re-run the gjs corpus; it ran a DIFFERENT program
until this change, and the difference was a defect in the shipping path rather
than in the test. `@gjsify/message-channel` declares `node: "native"`, so ADR 0014
routing sent the bare specifier to `./globals` — Node's own `MessageChannel` — on
every `--app node` build of this package, not just in the suite. That port is not
substitutable here: `BridgePortTransport` plugs into the polyfill's transport
hook, `MessageBridge._registerTransferredPort()` reads `port._partner`, and
`substitutePorts()` recognises a port by `Symbol.toStringTag === 'MessagePort'`.
Measured on Node 24.19.0, a host `MessagePort` has none of the three: no hook, no
`_partner`, and `Symbol.toStringTag` `EventTarget` (its channel: `Object`). The
suite already said so — `IFrameMessageChannel — Symbol.toStringTag identifies the
types` is the test that goes red without the substitution — and the same
substitution takes `_registerTransferredPort()` down its `partner missing` throw
branch and leaves `substitutePorts()` matching nothing. The port-transfer half of
the WebKit bridge, gone on the node target.

The fix is at the source, per AGENTS.md § *Don't patch* (pure-JS → native swap:
keep the pure-JS path at a subpath): `@gjsify/message-channel` now exports
`./core`, the same implementation at a specifier the alias layer does not rewrite
(it matches exact specifiers), declared all-`polyfill` in `gjsify.runtimeSubpaths`.
`@gjsify/iframe` imports the seam from there. `native` stays right for the package
itself — a consumer who wants a transferable port on Node wants Node's — and the
slot claim of THIS package now describes the program a consumer actually gets.

A build-level `--alias` on the test leg would have made the suite green without
any of that, which is what makes this worth writing down: on a leg whose whole
purpose is corpus identity, an alias that forces the corpus back into agreement
buys the green and hides the divergence it was built to surface.

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
- **`WKWebView` runs its own content process, and the HARDENED RUNTIME is fine
  with that.** `docs/poc/webkit-hardened-runtime-darwin.sh` signs the same
  minimal program three ways and runs each:

  ```
    unsigned (what a gjs process is today)   engine works
    ad-hoc signed + hardened runtime         engine works
    ad-hoc signed + App Sandbox              killed by signal 4 before it could run
  ```

  The hardened-runtime row is the one that matters for shipping, and it passes
  with `com.apple.security.cs.allow-jit` — so a notarised application embedding
  this backend has no WebKit-specific obstacle.

  **App Sandbox remains genuinely unanswered, and the probe says so rather than
  reporting a result it did not measure.** The abort is at process start, before
  `main`: `com.apple.security.app-sandbox` requires a bundled application with an
  `application-identifier` entitlement, and an ad-hoc signature has no team to
  issue one. That is a statement about bare executables and ad-hoc signing, not
  about WebKit. A properly bundled, Developer-ID-signed app needs a real identity
  to test and is out of reach here. A `gjs` process still has no bundle
  identifier, which some WebKit features key on.

### Input forwarding — the second track, now landed

The first revision of this ADR deferred input entirely and called it "comparable
in size to the rendering half". It is not, and the reason is one measurement:
`docs/poc/webkit-input-darwin.m`.

The expectation was that input would need the view to be first responder of a
key window, because that is how WebKit derives `ActivityState::IsFocused`. Three
modes were built and measured — bare windowless, windowless +
`-[NSView becomeFirstResponder]`, and a parked offscreen `NSWindow` +
`-[NSWindow makeFirstResponder:]` — and they are **indistinguishable on every
line, typing included**. The offscreen window was strictly worse while it
existed: it never became key even under activation policy `Accessory`, and it
dragged the wheel event's location out of the view, so scrolling stopped
working. So the shim creates no window, touches no responder chain, and leaves
the activation policy at `Prohibited`.

Two findings decide the code:

```
  WKWebView isFlipped : YES   (top-left, like GTK)
  mousedown at        : [30,50]   (sent 30,50 top-left)
  focused element     : i
  input.value         : x
  scrollY             : 50   (sent 50 px)
  document.hasFocus   : false
```

**The coordinate space is not the view's.** `-[WKWebView isFlipped]` is `YES`, so
the view's own space is top-left exactly like GTK's — but an `NSEvent` carries
`locationInWindow`, which is bottom-left, and WebKit converts with
`-[NSView convertPoint:fromView:nil]`. So a GTK y is flipped **once** against the
widget height. Unflipped, a y of 55 lands at `clientY` 245 in a 300 px view: the
events all arrive, at the wrong element, which is the only symptom.

**A forwarded click focuses the element under it**, so DOM focus follows the
pointer as it does on Linux and there is no separate focus channel to build.

`docs/poc/webkit-input-widget-darwin.m` then drives the shipping widget through
the `GtkEventController`s it installs, and is what holds the pieces the first
probe cannot see — that the controllers are connected, that the flip is against
the live widget height, and that GTK's scroll steps convert at WebCore's own
`Scrollbar::pixelsPerLineStep()` of 40 px (3 steps → `scrollY` 120, measured).

No `GtkIMContext` is attached, deliberately: WebKit routes `keyDown:` through
`-[NSView interpretKeyEvents:]` into its own `NSTextInputClient`, which *is* the
macOS input-method path, and a second IM context on the GTK side would compose
the input twice.

### What is not implemented

Each fails loudly rather than silently, which is the difference between a subset
and a lie:

- **`document.hasFocus()` is always `false`,** so `window.onfocus` / `onblur`
  never fire and focus-dependent UA chrome (a blinking caret) does not appear.
  It is a page-level activity-state flag WebKit derives from the responder
  chain, distinct from which element holds DOM focus — text input works without
  it. Measured in all three modes above, including the one with a real window,
  which is what says no arrangement of public API reaches it.
- **The pointer cursor does not change** over links or text. Cursor shape is
  another thing WebKit delivers through a window it does not have.
- **`darwin-arm64` is built but not committed.** `commit-prebuilds` downloads it
  now — the step was missing when this ADR first landed, so every arm64 artifact
  the `ci:macos` leg produced was discarded, which was the real blocker rather
  than the authoring host's architecture. It needs one labelled run to reach
  `main`.
- **App Sandbox stays unanswered.** See § *Consequences*.

### What the first revision got wrong

Two of the four bullets that stood here were not deferrals, they were **mistakes
of fact**, and both are now implemented:

- **Named script worlds.** This ADR said "`WKWebView` has no public
  isolated-world API" and refused a non-`NULL` world. `WKContentWorld` has been
  public since **macOS 11**, together with the `inContentWorld:` overloads of
  `addScriptMessageHandler`, `WKUserScript`'s initialiser and
  `evaluateJavaScript`. `docs/poc/webkit-script-worlds-darwin.m` measures the
  property that matters rather than merely that the calls return: the same
  global set in two worlds reads back `page` and `iso`, and a handler registered
  in `"iso"` is `undefined` from the page world and an `object` from `"iso"`.
  The requirement is now declared — `meson.build` pins
  `-mmacosx-version-min=11.0` — rather than inherited from whichever host built
  it.
- **User-script allow/block lists.** True that Apple's `WKUserScript` has no URL
  filter; false that this leaves nothing to do. Warning and running the script
  anyway is precisely the failure a block list exists to prevent. The patterns
  are now parsed in C and applied by wrapping the source in a guard that tests
  the document's URL, measured against a real origin via
  `loadHTMLString:baseURL:`: of five scripts on `https://example.com/page`, the
  exact-origin and `*.example.com` ones run and the other-host, other-path and
  `*://*/*`-blocked ones do not.

  The wrap costs one thing, stated because it cannot be hidden: the guard is a
  **labelled block**, so a filtered script's top-level `let`, `const` and `class`
  become block-scoped instead of global. `var` and function declarations are
  unaffected. A labelled block is used rather than the obvious IIFE precisely
  because an IIFE would capture those too, and a script with no lists is not
  wrapped at all.

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
5. Input forwarding: `GtkGestureClick`, motion, scroll and key controllers on the
   widget, each re-synthesizing an `NSEvent` with the single y-flip; no window,
   no responder chain, no `GtkIMContext`.
6. Script worlds via `WKContentWorld`, with `gjsify_webkit_user_script_new_for_world()`
   mirroring `webkit_user_script_new_for_world()`, and `-mmacosx-version-min=11.0`
   declaring the floor that API needs.
7. URL-pattern allow/block lists parsed in C and applied as a labelled-block
   guard around the script source.
8. The probes, each of which fails if its own finding stops holding:
   `webkit-runloop-darwin.m` (the run loop), `webkit-input-darwin.m` (what
   WebKit accepts), `webkit-input-widget-darwin.m` (what the widget forwards),
   `webkit-script-worlds-darwin.m` (isolation and filtering) and
   `webkit-hardened-runtime-darwin.sh` (code-signing contexts).
9. Per-target split per ADR 0017 and the `gjsify onboard` bootstrap before the
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
- **Do not put the `WKWebView` in an offscreen `NSWindow` to make input work.**
  It was built that way first. It buys nothing measurable — a bare windowless
  view types and clicks identically — it never becomes key even under activation
  policy `Accessory`, and it moves the wheel event's location out of the view, so
  scrolling regresses. Likewise do not relax the activation policy from
  `Prohibited`: that is what keeps a `gjs` CLI process out of the Dock, and
  nothing in the input path needs it.
- **Do not flip the pointer y twice, or not at all.** `isFlipped` is `YES` and
  the event location is still bottom-left; exactly one flip against the widget
  height is correct. Both errors deliver every event to the wrong element, which
  is a symptom that looks like a hit-testing bug anywhere but here.
- **Do not write "WKWebView has no public isolated-world API" again.**
  `WKContentWorld` has been public since macOS 11 and this ADR asserted the
  opposite for a release. If an Apple API looks absent, check the availability
  annotation before designing around it.
