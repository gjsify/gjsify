# @gjsify/webkit-native

Apple's WebKit (`WKWebView`) behind a GObject API shaped like WebKitGTK 6.0 — the
darwin backend for [`@gjsify/iframe`](../iframe/README.md).

Decision and measurements: [ADR 0022](../../../docs/adr/0022-webkit-on-darwin.md).

## Why this exists

`gi://WebKit` version 6.0 has no macOS provider, and that is upstream's position
rather than a packaging gap: Homebrew's `webkitgtk` formula carries an
unconditional `depends_on :linux` whose own comment says *"Use
JavaScriptCore.Framework on macOS."*, ships Linux-only bottles, and builds the
GTK**3** port anyway (`-DUSE_GTK4=OFF`). So `@gjsify/iframe` could not load on
macOS at all:

```
JS ERROR: Error: Requiring WebKit, version 6.0:
  Typelib file for namespace 'WebKit', version '6.0' not found
```

macOS does have complete WebKit with a complete DOM — what it lacks is a
GObject-Introspection binding and a GTK widget. This package supplies both.

## What it is

One Objective-C library exposing a **subset of WebKitGTK 6.0's API under the
same namespace**: `WebKit-6.0`. That is the whole integration strategy —
`@gjsify/iframe` keeps `import WebKit from 'gi://WebKit?version=6.0'` verbatim
and carries **no backend seam, no OS branch, and no `gjsify.os` declaration**.
Which typelib answers to that name is decided by what is on `GI_TYPELIB_PATH`,
i.e. by packaging.

| exposed | backed by |
|---|---|
| `WebKit.WebView` (a real `Gtk.Widget`, derivable) | `WKWebView`, offscreen |
| `WebKit.UserContentManager` / `UserScript` | `WKUserContentController` / `WKUserScript` |
| `WebKit.Settings` | `WKWebViewConfiguration` / `WKPreferences` |
| `load-changed` + `WebKit.LoadEvent` | `WKNavigationDelegate` |
| `script-message-received::<name>` | `window.webkit.messageHandlers.<name>.postMessage` |
| `evaluate_javascript()` → a value with `to_string()` | `evaluateJavaScript:completionHandler:` |
| `get_snapshot()` → `Gdk.Texture` | `takeSnapshotWithConfiguration:` |

## The two things that are not obvious

**The run loop.** `WKWebView` delivers everything through a CFRunLoop; GJS runs a
GMainContext, and a GMainContext does not pump a CFRunLoop. Measured: a
`WKWebView` driven from a bare `g_main_loop_run()` never even reaches
`didFinishNavigation`. The library installs a drain source while at least one
view is alive — [`docs/poc/webkit-runloop-darwin.m`](../../../docs/poc/webkit-runloop-darwin.m)
is that measurement, and it fails loudly if either half stops being true.

The drain holds under **Node** too, which is worth stating because the host that
needs it most is not GJS: ADR 0024 § 4 puts macOS applications on Node +
`@gjsify/node-gi`, and node-gi pumps the GMainContext its own way — it can fall
back to timed polling rather than watching a GLib poll fd from libuv. Measured on
the darwin-x64 VM under Node 24: `load_html()` on a `WebKit.WebView` reaches
`LoadEvent.FINISHED` via `STARTED` and `COMMITTED`, so the CFRunLoop source is
serviced there as well. Nothing here is GJS-specific — the package ships no
JavaScript at all, only the dylib and the typelib, and both are runtime-neutral.
`gjsify.runtimes.node` stays `"none"` for the reason every other JS-free
`*-native` package declares it so: that axis describes the package's own
JavaScript, of which there is none. It is not a claim that Node cannot use the
namespace.

**The widget is built, not embedded.** `WKWebView` is an `NSView` and GTK4 has no
foreign-window embedding, so the content renders offscreen and is presented as a
`GdkTexture` in the widget's `snapshot` vfunc. There is no "content changed"
signal from an out-of-process web view, so the widget pulls: it snapshots on a
tick while mapped, at most one in flight. Measured at 1024×768 on a GPU-less
Intel VM, `takeSnapshot` averages 15.8 ms — a ~63 fps ceiling before any GPU is
involved.

## Building

Requires macOS, clang, meson and gobject-introspection.

```bash
gjsify workspace @gjsify/webkit-native run build:prebuilds
```

That runs meson and stages `libgjsifywebkit.dylib` + `WebKit-6.0.typelib` +
`WebKit-6.0.gir` into `prebuilds/<os>-<arch>/`, from where ADR 0017's per-target
split publishes them.

**In CI this needs the `ci:macos` label on the PR.** `prebuilds.yml`'s
`build-prebuilds-macos` job is opt-in (macOS runners bill at 10×), so without the
label every darwin leg skips and nothing here is built or uploaded — a PR can go
green while this package was never compiled. The label only takes effect on a run
created *after* it was added: neither workflow declares `types:`, so the default
`[opened, synchronize, reopened]` applies and `labeled` is not among them. Push a
commit (or reopen the PR) after labelling.

## Input

Mouse, scroll and keyboard are forwarded from the GTK widget to the web content:
`GtkGestureClick`, motion, scroll and key controllers each re-synthesize an
`NSEvent`. A forwarded click focuses the element under it, so DOM focus follows
the pointer as it does on Linux, and no `GtkIMContext` is attached because WebKit
routes `keyDown:` through its own `NSTextInputClient` — which *is* the macOS
input-method path, so a second IM context would compose the input twice.

Two things worth knowing if you touch it, both measured
(`docs/poc/webkit-input-darwin.m`): the view needs **no window and no responder
chain** — an offscreen `NSWindow` was built and is indistinguishable except that
it breaks scrolling — and an `NSEvent`'s location is **bottom-left window space
even though `WKWebView` is flipped**, so a GTK y is flipped exactly once against
the widget height. Getting that wrong delivers every event to the wrong element
and nothing else.

Minimum deployment target is **macOS 11**, declared in `meson.build`, because
script worlds are `WKContentWorld`.

## Not implemented

Deliberate, and each fails loudly rather than silently:

- **`document.hasFocus()` is always `false`,** so `window.onfocus` / `onblur`
  never fire and no caret blinks. It is derived from a responder chain a
  windowless view has no place in; an offscreen window does not fix it, which was
  measured rather than assumed.
- **The pointer cursor never changes** over links or text — another thing WebKit
  delivers through a window it does not have.
- **App Sandbox is unanswered.** The **hardened runtime works**
  (`docs/poc/webkit-hardened-runtime-darwin.sh`, with
  `com.apple.security.cs.allow-jit`), so a notarised app has no WebKit-specific
  obstacle. The sandbox case dies before `main` because
  `com.apple.security.app-sandbox` needs a bundled app with an
  `application-identifier` that an ad-hoc signature cannot issue — a statement
  about bare executables, not about WebKit. A `gjs` process also has no bundle
  identifier, which some WebKit features key on.
- **No CI covers the input path**, on any platform. It is held by two by-hand
  probes that both need a display, and `@gjsify/iframe`'s unit suite instantiates
  no live WebView. See `status/open-todos.md` for the two event-injection routes
  that were tried and are dead ends.
