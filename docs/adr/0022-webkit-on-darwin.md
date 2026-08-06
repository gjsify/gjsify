# ADR 0022 — `@gjsify/iframe` on macOS: Apple's WebKit behind a GObject shim; the widget half is a compositor, not an embed

- **Status:** Proposed (2026-08-07)
- **Scope:** `@gjsify/iframe` (Framework pillar) and its `WebKit.WebView` dependency; a prospective `@gjsify/webkit-native` + `*-darwin-{x64,arm64}` per-target set (distribution per ADR 0017, OS axis per ADR 0018). Nothing here is implemented — this ADR exists to decide the SHAPE before anyone writes the shim.

## Context

ADR 0018 made Linux, macOS and Windows a declared, checked target set, and
`macos-suites.yml` now runs the Node pillar on both architectures. One package
does not merely fail there, it cannot load at all:

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
```

`gjsify/document-start` is one expression evaluating two things at once: the
DOM query `document.querySelector('h1').textContent` **and** the global a user
script set at document-start. Both halves answered.

The surface that has to map is small. Counted over `@gjsify/iframe`'s shipping
source (`packages/framework/iframe/src/**`, specs excluded): `WebKit.WebView`
27×, `LoadEvent` 5×, `UserContentManager` 3×, `UserScript` +
`UserScriptInjectionTime` + `UserContentInjectedFrames` 2× each,
`SnapshotRegion` 2×, `SnapshotOptions` and `Settings` 1× each; four instance
methods — `evaluate_javascript`, `get_snapshot`, `load_html`, `load_uri`.

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

### The renderer question, measured rather than assumed

`docs/poc/gsk-renderer-darwin.gjs.js`, on the GPU-less Intel VM:

```
display        : GdkMacosDisplay
GSK_RENDERER   : <unset — GTK chooses>
  GskNglRenderer / GskVulkanRenderer / GskCairoRenderer / GskGLRenderer   all available
chosen renderer: GskGLRenderer
GL context     : API GL — version 4.1
```

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

1. **Two stages, decided separately, because they cost differently.** Stage 1
   is an offscreen engine bridge; stage 2 is the widget. Stage 1 is useful on
   its own — most of `@gjsify/iframe`'s surface is eval, user scripts, the
   message bridge and snapshots, none of which need a live widget.

2. **Stage 1 — an Objective-C → GObject shim with a GIR and a typelib**,
   distributed by the pattern this repo already runs: `@gjsify/webkit-native`
   plus `@gjsify/webkit-native-darwin-{x64,arm64}` per-target packages behind an
   `optionalDependencies` bridge (ADR 0017), built by meson and staged by
   `stage-prebuild.mjs`. That pattern is already proven on darwin —
   `http2-native-darwin-x64`, `tls-native-darwin-x64` and `webgl-darwin-x64`
   exist and load.

3. **Stage 2 — a paintable, not an embed.** `WKWebView`'s layer tree →
   `CARenderer` → `IOSurface` → `GdkTexture` → `GdkPaintable` in a
   `Gtk.Picture`, with mouse, keyboard, focus, IME and scroll forwarded
   synthetically. Casilda's architecture, Apple's buffers.

4. **The output type is `GdkTexture`, never a GL context the widget owns.**
   `GdkGLTexture` where a GL context exists, `GdkMemoryTexture` otherwise. This
   is what makes hardware acceleration a property of the HOST rather than a
   build flag, and it is the reason stage 2 can be developed on a GPU-less VM at
   all.

5. **This is NOT `gi://WebKit` 6.0.** It is a separate namespace exposing a
   compatible subset. `@gjsify/iframe` therefore needs a **backend seam** — one
   internal interface with a WebKitGTK implementation and a darwin one — rather
   than a drop-in swap. Designing that seam is part of stage 1, not a later
   cleanup: a seam retrofitted after two backends exist is written to fit the
   accident of what was built first.

## Consequences

- **A new published `@gjsify/*` name costs a manual bootstrap.** npm Trusted
  Publishing requires the package to already exist, so the first publish is a
  maintainer action (`gjsify onboard`, `--dry-run` first) BEFORE the release
  that ships it — see [docs/publishing.md](../publishing.md). Skipping it makes
  `release.yml`'s OIDC exchange 404 and stalls every alphabetically later
  package; that is the v0.4.20 incident, which left 60+ packages at 0.4.19.
  Three new names are proposed here, so this is three onboardings, not one.
- **`@gjsify/iframe` gains no `gjsify.os` declaration from this ADR.** It makes
  no OS decision in shipping source (verified: no `process.platform`, no
  `isDarwin()`/`hostOs()`, nothing equivalent), so the `os-axis` rule does not
  demand one and adding it on suspicion would contradict ADR 0018's derivation
  rule. The fact that the package cannot load on macOS is a `status/` ledger
  entry, not a manifest claim. It becomes a candidate the moment the backend
  seam introduces a host branch — which stage 1 will.
- **`WKWebView` runs its own content process.** In the plain CLI case that was
  measured working; under App Sandbox, hardened runtime or a service context it
  is untested, and a `gjs` process has no bundle identifier, which some WebKit
  features key on.
- **Stage 2 is independent systems work**, not glue, and its input half (IME
  and focus especially) is comparable in size to its rendering half. It should
  be scoped as its own track and not smuggled into stage 1's estimate.
- `@gjsify/iframe` stays unavailable on macOS until stage 1 lands. That is the
  status quo, now written down with its reason instead of surfacing as a
  typelib error.

## Implementation

Nothing yet, deliberately — this ADR is Proposed. The order, when it starts:

1. Design the backend seam in `@gjsify/iframe` against the existing WebKitGTK
   implementation ALONE, so it is shaped by the contract rather than by the
   second backend.
2. `gjsify onboard --dry-run` for the three new names, before any release.
3. Stage 1: the shim, its GIR and typelib, the meson build, the per-target
   packages, and `gjsify.platforms` declaring only what a job actually builds
   (ADR 0018: never declare an OS whose only evidence is that the build
   succeeded).
4. Stage 1's gate ends in an operation the OS performs — an `evaluate_javascript`
   round-trip and a real snapshot, not a file count.
5. Stage 2 separately, with the paintable path measured on both a GPU-less host
   and an M-series Mac before any claim about acceleration is written down.

## Do not

- **Do not hardcode `GSK_RENDERER`.** GTK picks GL on macOS and does not
  degrade to cairo on its own; forcing cairo is right on a GPU-less VM and wrong
  on real hardware. Renderer selection belongs to the host, which is the same
  rule the CI legs already follow by setting it in the environment.
- **Do not build on `JavaScriptCore.framework` alone**, and do not read "macOS
  has no WebKitGTK" as "macOS has no WebKit" — the engine and its DOM are
  complete, the binding and the widget are what is missing.
- **Do not reach for the WebKit1 ObjC DOM API** because it is the shorter path.
  It is a deprecated single-process engine, and WebKitGTK 6.0 has no DOM
  bindings either, so it would buy a shortcut on one platform at the price of
  the parity the seam exists to preserve.
- **Do not claim `gi://WebKit` compatibility.** A compatible subset under its
  own namespace is honest; a namespace that answers to `WebKit` and diverges is
  the kind of promise ADR 0018 was written to stop.
