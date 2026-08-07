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

## Not implemented

Deliberate, and each fails loudly rather than silently:

- **Named script worlds.** `WKWebView` has no public isolated-world API.
  `register_script_message_handler(name, world)` returns `FALSE` for a non-`NULL`
  world instead of registering into the page world.
- **User-script allow/block lists.** Not a WebKit feature — WebKitGTK implements
  them above WebKit. A non-empty list warns.
- **Input forwarding.** The widget renders; mouse, keyboard, focus and IME are
  not yet forwarded to the web content. Scoped as its own track in ADR 0022.
- **Sandboxed / hardened-runtime processes** are untested. `WKWebView` runs its
  own content process and a `gjs` process has no bundle identifier.
