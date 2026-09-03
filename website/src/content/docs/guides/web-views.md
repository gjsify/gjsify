---
title: Web Views
description: Embed real web content in a native app with @gjsify/iframe — the same code on Linux, macOS and Windows, plus the Windows caveats you will hit.
---

`@gjsify/iframe` puts a real browser engine inside your app. You write against
`HTMLIFrameElement` the way you would on a web page — `src`, `srcdoc`,
`contentWindow.postMessage()`, `addEventListener('message')` — and what renders is a full
web view with cookies, JavaScript, CSS and developer tools behind it. An HTML report, a
help page, an OAuth flow, a third-party widget, a Markdown preview: this is the package for
all of them.

It works on Linux, macOS and Windows, and **your source does not branch for any of them**.

## Install

```bash
gjsify install @gjsify/iframe
```

On Linux you also need WebKitGTK 6.0 from your distribution — `gjsify system-check` tells
you whether it is there. On macOS and Windows the engine comes with the package, with one
proviso on Windows: your users need the WebView2 runtime, which
[has its own section](#the-webview2-runtime-has-to-be-on-the-users-machine) below.
[One API, three engines](#one-api-three-engines) explains where each engine comes from.

## A window with a web view

`IFrameBridge` is a `Gtk.Widget` — it extends `WebKit.WebView` — so it goes wherever a
widget goes. This is a complete program:

```ts
import Adw from 'gi://Adw?version=1';
import { IFrameBridge } from '@gjsify/iframe';

const app = new Adw.Application({ applicationId: 'org.example.WebViewDemo' });

app.connect('activate', () => {
    const view = new IFrameBridge();

    view.onReady(async () => {
        console.log('url:', view.currentUri);
        console.log('h1:', await view.evaluateJavaScript('document.querySelector("h1").textContent'));
        console.log('links:', (await view.getLinks()).map((link) => link.href).join(' '));
        console.log('snapshot:', (await view.takeScreenshot('visible')).length, 'bytes of PNG');
    });

    view.loadHtml(`<!doctype html>
        <title>Web view demo</title>
        <h1>Hello from the web view</h1>
        <p><a href="https://gjsify.github.io/gjsify/">Documentation</a></p>`);

    const win = new Adw.ApplicationWindow({
        application: app,
        title: 'Web view demo',
        defaultWidth: 800,
        defaultHeight: 600,
    });
    win.set_content(view);
    win.present();
});

app.run([]);
```

Build it for whichever runtime you have and run it:

```bash
gjsify build src/main.ts --app gjs  --outfile dist/app.gjs.mjs   # Linux, on gjs
gjsify build src/main.ts --app node --outfile dist/app.node.mjs  # Linux, macOS, Windows

gjsify run dist/app.gjs.mjs
gjsify run --runtime node dist/app.node.mjs   # or --runtime bun / --runtime deno
```

A window opens with the page in it, and the terminal shows:

```
url: about:srcdoc
h1: Hello from the web view
links: https://gjsify.github.io/gjsify/
snapshot: 11819 bytes of PNG
```

The snapshot size depends on your window, so expect a different number.

There is no GJS on macOS or Windows, so off Linux the `--app node` bundle is the one to
build. [Platform Support](/gjsify/platform-support/) has the whole picture.

## Two APIs, and you can use either

**The standard DOM one**, on `view.iframeElement`: `src`, `srcdoc`, `contentWindow`,
`postMessage`, `addEventListener('message')`. Reach for it when the same code should also
run in a browser.

**The bridge one**, on the widget itself: `loadUri()`, `loadHtml()`, `postMessage()`,
`goBack()`, `goForward()`, `reload()`, guarded by `canGoBack` / `canGoForward`, with
`currentUri`, `pageTitle` and `lastLoadError` reporting state. Reach for it when you want
the engine's own back/forward list instead of one you track yourself.

Prefer `loadUri(url)` and `loadHtml(html, baseUri?)` over setting `src` and `srcdoc`
directly: they keep the engine and the iframe element's attributes in step.

Two things to watch. `contentWindow` is `null` until the first navigation finishes, and
`onReady()` is drained per load — so re-attach your message listener from `onReady()` after
each load. (A browser `<iframe>` keeps `contentWindow` across navigations, so a browser
build does not need this.) And `pageTitle` is still empty inside `onReady()`: the engine
reports the document title a moment after the load finishes. If you mirror the title into a
header bar, watch for it instead of reading it once:

```ts
view.connect('notify::title', () => {
    win.title = view.pageTitle;
});
```

If your code calls `document.createElement('iframe')` or names `HTMLIFrameElement`
directly, `gjsify build` sees the reference and wires up the DOM surface for you — that is
what `--globals auto` (the default) does. `new IFrameBridge()` needs none of it and works
under `--globals none`; when you want the global installed unconditionally, the bridge has
`installGlobals()`.

## Driving the page

Beyond loading, the bridge is a small automation surface — the same calls whether the app
is on screen or running headless in a test:

| Call | What it does |
|---|---|
| `evaluateJavaScript(expr)` | Evaluate an *expression* in the page and get its value back. Wrap multi-statement logic in an IIFE that returns something. |
| `queryDom(selector, limit?)` | Metadata for every element matching a CSS selector. |
| `getLinks()` | Every `<a href>` on the page: resolved href, trimmed text, title. |
| `clickElement(selectorOrText)` | Click the first match — a CSS selector, or an `<a>` matched by its exact text. |
| `waitForNavigation(timeoutMs?)` | Resolve on the next finished load. Register it *before* the click that triggers one. |
| `takeScreenshot('full' \| 'visible')` | The rendered page as PNG bytes. |
| `getConsoleLogs()` / `onConsole(cb)` | The page's own `console.*` output, with `new IFrameBridge({ captureConsole: true })`. |
| `getViewportSize()` / `setViewportSize(w, h)` | Read the realised content size; request a different one. |

Values from `evaluateJavaScript` round-trip through JSON, so anything that is not
JSON-serialisable — a DOM node, a function, a circular object — comes back as `undefined`,
and a thrown page error rejects the promise.

## One API, three engines

`@gjsify/iframe` imports `gi://WebKit?version=6.0` and never asks what operating system it
is on. Which engine answers to that name is decided by packaging:

| OS | Where the engine comes from | Engine |
|---|---|---|
| Linux | your distribution's WebKitGTK | WebKit |
| macOS | `@gjsify/webkit-native`, shipped by gjsify | Apple's WebKit |
| Windows | `@gjsify/webview2-native`, shipped by gjsify | Chromium, via Microsoft's WebView2 |

The Windows row is the interesting one. WebView2 is Chromium, and it is deliberately
presented under the `WebKit-6.0` namespace anyway: the namespace names the API *shape*, not
the engine. What that buys you is the whole point — **no backend seam, and no `if (os ===
…)` anywhere in your code.** The same `new IFrameBridge()`, the same `loadUri()`, the same
`evaluateJavaScript()`, on all three.

Both shims are ordinary dependencies of `@gjsify/iframe` and contain no JavaScript. Each
one's binaries arrive through per-platform optional dependencies, which your package manager
installs only on the matching platform and skips silently everywhere else — so a Linux
install pulls in two empty packages and no binaries at all.

Where the engines genuinely differ, the differences are below, and each one announces
itself at the call site rather than failing quietly.

## Windows: the view is an overlay

On Windows the web content is a child window the OS composites on top of your app. It is
not a node in GTK's scene graph, which buys you input, focus and accessibility straight
from the OS — and costs you clipping. An ancestor cannot cut the page to shape, nothing can
be drawn over it, and opacity and transforms do not reach it.

So these arrangements will not do what you expect:

- **inside a `Gtk.ScrolledWindow` or `Gtk.Viewport`** — the scrolled window scrolls the
  widget, not the page, and the content is not clipped to the viewport;
- **as the main child of a `Gtk.Overlay`** — anything you overlay is drawn *under* the web
  content instead of over it;
- **inside a `Gtk.Popover`** — the popover's rounded, clipped surface is not followed;
- **with an opacity below 1**, on the view or on any ancestor — it is not applied to the
  web content.

gjsify warns once per finding, naming the ancestor, rather than letting it look like a bug
in your layout. The view also keeps the list:

```js
view.get_hosting_mode();        // WebKit.HostingMode.OVERLAY
view.get_overlay_constraints(); // the arrangements it cannot honour, as readable strings
```

Those two names exist on the Windows backend only — they describe a condition Linux and
macOS do not have — so guard the call or keep it to Windows-specific diagnostics.

What the detector cannot see is a CSS `border-radius` that reaches the widget — that is not
readable from GTK's public API — so treat the list as the arrangements that have been
reported, not as proof there are no others.

Design around it the same way you would around a video overlay: give the web view its own
rectangle in the window. A full-page document under a header bar is the shape that works.

### Windows behaviour differences

Each of these is deliberate, and each says so at the call rather than silently doing
something else:

- **A user script carrying an allow-list or block-list of URL patterns is refused.**
  WebView2's injection point has no URL filter, and injecting anyway is exactly the failure
  a block list exists to prevent, so it narrows in the safe direction.
- **Named script worlds are ignored.** There is no public isolated-world API to map them
  onto. `user_script_new_for_world()` still exists so your call site stays portable, and it
  tells you what it did — worth knowing because macOS *does* honour the same argument, so
  the identical call is isolated there and not here.
- **A full-document snapshot returns the viewport.** `takeScreenshot('full')` captures what
  is laid out, not the whole scrollable document. Snapshot options other than the default
  are ignored too.
- **`WebKit.WebView.evaluate_javascript()`, called directly, returns JSON text** where the
  other two platforms return a live value. Strings, numbers and booleans read the same; an
  object comes back as its JSON text, and `null` and `undefined` are not distinguishable
  (`is_null()` is true for both, `is_undefined()` never is). The bridge's own
  `evaluateJavaScript()` is unaffected: it already serialises inside the page.
- **End-of-document script injection is approximated** by a document-start script that
  defers itself to `DOMContentLoaded`.
- **Console forwarding to stdout is not honoured** — use the bridge's own
  `captureConsole` option, which works on every platform.
- **`allow-file-access-from-file-urls` is not offered as a setting**, because the
  equivalent is a process-wide switch rather than a per-view one. An absent property warns
  at the call; a present one that quietly did nothing would not.
- **x64 only.** There is no arm64 GTK for Windows to build against.

### What else has to be on the machine

The Windows backend links GTK, GLib and GObject, and Windows has no system copy of any of
them, so install `@gjsify/gtk-runtime-win32-x64` alongside it — the same bundle every
Windows gjsify app already uses to reach `gi://` at all. It is deliberately not pulled in
for you: a second copy of those DLLs on the process's search path is a worse failure than
the one it would solve.

### The WebView2 runtime has to be on the user's machine

The Evergreen WebView2 runtime ships with Windows 11 and with Edge on Windows 10, but it is
a dependency and not an assumption. On a machine without it, creating the view fails with a
message naming the runtime and the Fixed Version redistributable, rather than a bare error
code.

If you ship an `.msi` with [`gjsify ship windows`](/gjsify/ship/windows/), that is yours to
handle: declare the runtime, detect it at install time, and offer the Fixed Version
redistributable for an application that must not depend on what the machine happens to
have. The generated installer does not do this for you yet.

**And read both registry views if you write that detection.** On 64-bit Windows the
Evergreen runtime's client key lives only under
`HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\…`; the 64-bit view of the same path
does not have it. A detector that checks only the 64-bit path reports "not installed" on a
machine that has the runtime — a check that looks green everywhere it is tested and is
wrong at the user. Read both views, or call
`GetAvailableCoreWebView2BrowserVersionString`, which is view-independent.

### What is proven on Windows, and what is not

The Windows view has been exercised without an application window on screen: `gi://WebKit`
6.0 resolves, the view is a real `Gtk.Widget`, a page loads to completion,
`evaluate_javascript` reads a value back **out of the DOM**, a snapshot comes back as a
texture, and the page's own `postMessage` arrives on the app side.

What has not been verified is the same view re-parented under a real application window:
tracking its bounds as the window moves and resizes, hiding when the widget is unmapped,
and input and focus arriving from the OS. If you are deciding whether to depend on the
Windows web view today, that is the line — the engine, the loading, the scripting and the
snapshots are demonstrated; the widget-in-a-window behaviour is not yet.

## macOS notes

macOS gets Apple's WebKit through `@gjsify/webkit-native`, which gjsify ships as a
prebuild. There is no WebKitGTK to install and no Homebrew formula to look for: upstream's
GTK port is Linux-only by decision, not by omission.

The widget is *built* rather than embedded. GTK 4 has no foreign-window embedding, so the
page renders offscreen and is presented as a texture, refreshed on a tick while the widget
is mapped. Measured at 1024×768 on a GPU-less Intel VM a snapshot averages 15.8 ms, so
expect a ceiling around 63 fps before any GPU is involved. Mouse, scroll and keyboard input
are forwarded from the GTK widget into the page, and a click focuses the element under it.

What the macOS backend deliberately does not do:

- **`document.hasFocus()` is always `false`**, so `window.onfocus` and `onblur` never fire
  and no caret blinks. It comes from a responder chain a windowless view has no place in.
- **The pointer cursor never changes** over links or text, for the same reason.
- **App Sandbox is unanswered.** The hardened runtime works, so a notarised app has no
  web-view-specific obstacle; a sandboxed one has not been shown to work.

The minimum deployment target is macOS 11.

## Related

- [Bridge Widgets](/gjsify/patterns/bridges/#embed-a-web-page) — where `IFrameBridge` sits
  next to the canvas, WebGL and video bridges, and when to reach for each
- [Minimalist Browser](/gjsify/showcases/minimalist-browser/) — a URL bar, history and
  `postMessage`, in one small app
- [Platform Support](/gjsify/platform-support/) — what reaches your operating system
- [Ship your app](/gjsify/ship/) — packaging for Linux, macOS and Windows
