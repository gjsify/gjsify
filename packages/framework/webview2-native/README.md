# @gjsify/webview2-native

**This package installs a typelib that answers to `gi://WebKit` version 6.0, and
the engine behind it is Chromium.** It is Microsoft's WebView2 wearing
WebKitGTK's API, on Windows only, so that
[`@gjsify/iframe`](../iframe/README.md) — and anything else written against
`WebKit.WebView` — runs there without a backend seam or an OS branch. The name
says WebView2 because the engine does; the namespace says WebKit because the API
shape does. Nothing about that is accidental, and the reasoning is
[ADR 0035](../../../docs/adr/0035-web-view-on-win32.md).

Sibling: [`@gjsify/webkit-native`](../webkit-native/README.md) does the same job
on macOS with Apple's WebKit behind it (ADR 0022). On Linux there is no shim —
`gi://WebKit` 6.0 is the real WebKitGTK.

## Why this exists

WebKit's **GTK port** targets X11 and Wayland; there is no Windows GTK port
upstream, `gvsbuild` (the project that builds GTK for Windows) has no WebKit
project at all, and WebKit's **WinCairo** port — which does build — ships neither
a GObject-Introspection typelib nor a GTK widget. So `gi://WebKit` 6.0 has no
win32 provider, and not for packaging reasons.

What Windows does have is a complete, supported, already-installed web engine:
**WebView2**, the Evergreen runtime that ships with Windows 11 and with Edge on
Windows 10. That solves the engine half before this package starts, exactly as
`WebKit.framework` solved it on darwin. What it does not solve is the widget
half, and that is what stage 1 below is honest about.

## What ships, and what it is

| exposed | backed by |
|---|---|
| `WebKit.WebView` (a real `Gtk.Widget`, derivable) | `ICoreWebView2Controller` on a child `HWND` |
| `WebKit.UserContentManager` / `UserScript` | `AddScriptToExecuteOnDocumentCreated` |
| `WebKit.Settings` | `ICoreWebView2Settings` |
| `load-changed` + `WebKit.LoadEvent` | `NavigationStarting` / `ContentLoading` / `NavigationCompleted` |
| `script-message-received::<name>` | `window.chrome.webview.postMessage`, behind a `window.webkit.messageHandlers` object injected once per view |
| `evaluate_javascript()` → a value with `to_string()` | `ExecuteScript` (which returns JSON — see below) |
| `get_snapshot()` → `Gdk.Texture` | `CapturePreview` (PNG) decoded by `gdk_texture_new_from_bytes()` |

That list is ADR 0035 decision 4's counted subset and deliberately nothing
wider — it is the surface `@gjsify/iframe` actually uses, not WebKitGTK's.

## The three things that are not obvious

### 1. It is an OS-composited OVERLAY, not a widget GSK draws

This is stage 1 of a two-stage plan, and the stage boundary is exactly here. The
web content is a child `HWND` under the GTK toplevel's own `HWND`, positioned and
sized to the widget's allocation, hidden when the widget is unmapped. Input,
focus and accessibility therefore come from the OS for free — which is the whole
reason this staging is the reverse of darwin's, where the widget was the
expensive half.

The price is that the content is **outside GSK's scene graph**:

- an ancestor cannot clip it — a `GtkScrolledWindow` scrolls the widget and not
  the page, a rounded corner does nothing;
- nothing can be drawn over it;
- opacity and transforms are not applied.

GTK's failure mode for all of that is exit 0, so this package says so out loud
rather than in a doc comment:

```js
view.get_hosting_mode()          // WebKit.HostingMode.OVERLAY
view.get_overlay_constraints()   // the arrangements it is in that it cannot honour
```

Each detected constraint is also warned once per view, naming the ancestor. What
the detector does **not** see is a CSS `border-radius` that reaches the widget —
that is not readable from GTK's public API — so the list is the arrangements that
have actually been reported, not a proof of absence.

Stage 2 (composition hosting plus `Windows.Graphics.Capture` into a
`Gdk.Texture`) is what changes the answer, and it is not in this release.

### 2. The Win32 message queue has to be dispatched, and only for some calls

WebView2 delivers content-level callbacks through the thread's Win32 message
queue, and `g_main_loop_run()` does not dispatch that queue. Measured on
`windows-latest` against Evergreen 151.0.4129.101
([`docs/poc/webview2-win32-probe.cpp`](../../../docs/poc/webview2-win32-probe.cpp)):

| call | needs the queue pumped |
|---|---|
| `CreateCoreWebView2EnvironmentWithOptions` | no |
| `CreateCoreWebView2Controller` | no |
| `NavigationCompleted` | **yes** — 8000 ms timeout without, immediate with |

That asymmetry is the interesting part, and it decided the design. A backend that
installed its bridge at the first need would install it after the only two calls
that do not have one — so the widget would exist, the view would exist, and
nothing would load, eight seconds and one abstraction layer from the cause.

So the pump `GSource` is attached when the **first view is constructed**, held
while any view is alive, and its absence is a **named error on every
content-level call** instead of a timeout:

```js
view.get_message_pump_state()   // WebKit.MessagePumpState.ATTACHED | DETACHED | FOREIGN_THREAD
```

GDK's own Win32 backend pumps the same queue when a display is open. That is not
a conflict — both sources call `PeekMessage(PM_REMOVE)` on one queue, so a
message is removed once — and it is not a substitute either, because a view with
no display and no toplevel still has to reach `NavigationCompleted`. The CI proof
runs in exactly that shape.

### 3. `evaluate_javascript` speaks JSON

`ExecuteScript` returns its result as JSON text where WebKitGTK returns a live
`JSCValue`. A JSON string is unquoted and unescaped, so a string result reads the
same on both backends; everything else comes back as its JSON text, which matches
`JSCValue.to_string()` for numbers and booleans and is a real divergence for
objects. WebView2 also returns `"null"` for both `null` and `undefined` — they
are not distinguishable in JSON — so `is_null()` is true for both and
`is_undefined()` is never true.

## What stage 1 does not do

Each fails loudly rather than silently, which is the difference between a subset
and a lie:

- **Named script worlds are ignored, with a warning.** WebView2 has no public
  isolated-world API; `new_for_world()` exists so the call site stays portable
  and says what it did.
- **A user script carrying an allow or block list is REFUSED, with a warning.**
  WebView2's injection point has no URL filter. Warning and injecting anyway is
  precisely the failure a block list exists to prevent, so this narrows in the
  safe direction. Porting the darwin backend's in-script guard is what closes
  this; it is outside ADR 0035 decision 4's counted subset.
- **`UserScriptInjectionTime.END` is approximated** by a document-start script
  that defers itself to `DOMContentLoaded` — WebView2 has one injection point.
- **`SnapshotRegion.FULL_DOCUMENT` returns the viewport.** `CapturePreview`
  captures what is laid out, not the whole scrollable document.
- **`Settings.enable-write-console-messages-to-stdout` is not honoured.**
  WebView2 has no console-forwarding API short of a DevTools Protocol session;
  `@gjsify/iframe`'s console-capture user script works on every backend.
- **An UNREGISTERED message channel accepts `postMessage` instead of throwing.**
  WebKitGTK leaves `window.webkit.messageHandlers.foo` `undefined` until a
  manager registers it, so a page posting to it gets a TypeError. Here one
  auto-vivifying object is installed per view, ahead of every user script,
  because WebView2 runs document-start scripts in registration order and a
  per-handler shim would run *after* a bootstrap script that uses it — which is
  the whole `@gjsify/iframe` bridge. The host warns once per unknown channel,
  naming it, rather than discarding the message in silence.
- **`x64` only.** `gvsbuild` publishes no arm64 GTK, so ADR 0024's `--arch arm64`
  refusal on Windows already forecloses the question.

## The runtime closure is bigger than the tarball

`gjsifywebview2.dll` links GTK4, GLib and GObject, and Windows has no system copy
of any of them — so this prebuild is usable next to
[`@gjsify/gtk-runtime-win32-x64`](../../node-gi/gtk-runtime-win32-x64/README.md)'s
batteries-included bundle, which every win32 consumer already has because it is
how `@gjsify/node-gi` gets GObject at all. That bundle is **not** pulled in
automatically (node-gi declares no `optionalDependencies` on it, deliberately —
ADR 0023); install it explicitly. Duplicating those DLLs into this tarball would
put a second copy of each on the process's search path, which is a worse failure
than the one it solves.

Measured on the win11-gjsify VM against `@gjsify/gtk-runtime-win32-x64@0.45.0`:
45 typelibs, **none of them `WebKit`**, no `JavaScriptCore`, no `Soup`, and no
`webkit*` DLL among the 52 in `gtk/bin`. There is nothing on Windows to wire this
namespace up to — which is why the package exists.

## The Evergreen runtime is a dependency, not an assumption

`CreateCoreWebView2Environment` answers
`HRESULT_FROM_WIN32(ERROR_FILE_NOT_FOUND)` on a machine with no runtime, and this
package turns that into a message naming the runtime and the Fixed Version
redistributable rather than a bare HRESULT. Declaring it in the `.msi` that
`gjsify ship windows` produces — detection at install time, the redistributable
as the opt-out — is ADR 0035 decision 5 and is **not** in this release.

**Whoever writes that detection: read both registry views.** Measured on Windows
11 build 26200 with the runtime installed (152.0.4191.53), the Evergreen client
key exists only under
`HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-…}` — the
64-bit view does not have it. A detector reading the 64-bit path alone reports
"not installed" on a machine that has it: green in CI, wrong at the user. The
view-independent answer is `GetAvailableCoreWebView2BrowserVersionString`, which
is what this backend itself uses.

## Building

There is no host that can build all of this at once, and that is structural
rather than a limitation of anybody's machine:

| half | needs | where |
|---|---|---|
| `WebKit-6.0.gir` | `g-ir-scanner`, which builds and RUNS a dumper against the library | Fedora (`ghcr.io/gjsify/ci-fedora:43`) |
| `gjsifywebview2.dll` + `WebKit-6.0.typelib` | MSVC, the WebView2 SDK, gvsbuild's GTK4 | `windows-latest` |

Both halves are two jobs of ONE `prebuilds.yml` run, so drift between them is
structurally impossible rather than merely unlikely. On Fedora the library links
against `src/c/gjsify-webview2-unsupported.c`, which registers no behaviour and
fails every call loudly; nothing it produces is ever staged, because `win32-x64`
is this package's only declared target and `stage-prebuild.mjs` refuses any
other host.

```bash
# the GIR half, on any host with gtk4-devel + gobject-introspection-devel
gjsify workspace @gjsify/webview2-native run build:meson
```
