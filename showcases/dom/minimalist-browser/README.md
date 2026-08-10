# @gjsify/example-dom-minimalist-browser

A minimalist web browser — URL bar, back/forward/reload navigation and an iframe content area — running in a real browser (native `<iframe>`) and natively under GJS (`@gjsify/iframe`'s `IFrameBridge` over `WebKit.WebView`) from one shared core. An Epiphany-style Adwaita header bar looks identical in both variants; only the platform UI shell differs.

Purpose: stress-test `@gjsify/iframe`'s feature-completeness against a non-trivial application. Any gap surfaces here and lands in the same workstream.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Targets

| Target | Bundle | Platform glue |
|---|---|---|
| GJS / GTK 4 | `dist/gjs.js` (`--app gjs`) | `@gjsify/iframe` `IFrameBridge` → `WebKit.WebView` + native `Adw.*` widgets |
| Browser | `dist/browser-main.js` (`--app browser`) | a real `<iframe>` + `@gjsify/adwaita-web` |

Both targets drive the same `BrowserCore` in `src/browser-demo.ts`. GJS-only by design (`gjsify.example.runtimes: ["gjs"]`) — the content area is a WebKit view, so there is no `--app node` bundle.

## Prerequisites

GJS ≥ 1.86 with GTK 4 and WebKitGTK 6.0. `gjsify system-check` reports what is missing.

## Run

```bash
# Build first (gjs + browser bundles and the assets)
gjsify run build

# GJS / GTK4 native window
gjsify showcase minimalist-browser
# or: gjsify run start

# Browser (serves dist/ on localhost:8080)
gjsify run start:browser
```

Both variants:

1. Open with `page:welcome` loaded
2. Quick-nav strip lists built-in pages: `page:welcome`, `page:about`, `page:postmessage`, `page:adwaita`
3. URL bar accepts both the `page:<name>` scheme (loads from the in-memory page library via `srcdoc` / `loadHtml`) and real URLs like `https://example.com` (GJS variant: loads via WebKit; browser variant: loaded by the browser's iframe)
4. Each built-in page sends a `{type: 'page-loaded', title, url}` postMessage on `DOMContentLoaded`; the parent's status line displays it

## What it demonstrates

- A W3C `HTMLIFrameElement` surface on GJS, backed by `WebKit.WebView` — `src`, `srcdoc`, `contentWindow`, navigation
- Bidirectional `postMessage` across the frame boundary on GJS, through WebKit's script-message-handler and `@gjsify/message-channel`'s `MessageEvent`
- One unchanged application core (`src/browser-demo.ts`) driving both a real `<iframe>` and `IFrameBridge` — duck-typed on an `IFrameHandle`
- Adwaita design language in both variants (`Adw.ApplicationWindow` / `Adw.HeaderBar` / `Adw.ToolbarView` on GJS, `@gjsify/adwaita-web` in the browser)
- `gjsify build --app gjs` and `--app browser` dual-target build

### Feature-by-feature

| Feature | Browser variant | GJS variant |
|---|---|---|
| Iframe content area | Real `<iframe>` element | `IFrameBridge` → `WebKit.WebView` |
| URL bar navigation | Set `iframe.src` | `IFrameBridge.loadUri()` / `loadHtml()` |
| Back / Forward / Reload | Application-side history stack + `iframe.src = url` | Same — symmetric code path |
| postMessage (page → parent) | Native `window.parent.postMessage()` | WebKit script-message-handler → `MessageBridge` → `MessageEvent` |
| Built-in srcdoc pages | `iframe.srcdoc = html` | `IFrameBridge.loadHtml(html)` (calls through to `WebKit.WebView.load_html`) |
| Adwaita design language | `@gjsify/adwaita-web` web components | Native Adw widgets (`Adw.ApplicationWindow`, `Adw.HeaderBar` with flat nav buttons + a `Gtk.Entry` URL title-widget + home button, `Adw.ToolbarView` bottom status bar) |

The application-side history stack keeps both variants symmetric — browsers won't allow cross-origin `iframe.contentWindow.history.go(-1)` programmatically, so both variants pop the parent-tracked stack and re-load the URL the same way. (`IFrameBridge` also exposes WebKit's internal `goBack` / `goForward` / `reload` / `canGoBack` / `canGoForward` for apps that prefer the WebKit-side back/forward list — see the API table below.)

## Built-in pages

Defined in `src/browser-demo.ts` as srcdoc templates. Each carries an inline `<script>` that calls `window.parent.postMessage(...)` on load.

| URL | Title | Demonstrates |
|---|---|---|
| `page:welcome` | Welcome | Landing page with quick-nav guidance |
| `page:about` | About | Cross-variant architecture explanation |
| `page:postmessage` | postMessage round-trip | The postMessage code that runs on every page |
| `page:adwaita` | Adwaita design | Note on the Adwaita design language across variants |

## API surface exercised

- `@gjsify/iframe` exports:
  - `IFrameBridge` — `WebKit.WebView` subclass with the iframe-element wrapper, message bridge, ready callbacks, `.loadUri()` / `.loadHtml()` / `.postMessage()`, `.goBack()` / `.goForward()` / `.canGoBack` / `.canGoForward` — and `.reload()` inherited from `WebKit.WebView` natively
  - `HTMLIFrameElement` — `.src`, `.srcdoc`, `.contentWindow`, `.contentDocument` (stub)
  - `IFrameWindowProxy` — `.postMessage()` + `addEventListener('message')`
  - `MessageBridge` — bidirectional postMessage transport via WebKit's script-message-handler
- W3C surface (same on both variants):
  - `iframe.contentWindow.postMessage(data, '*')`
  - `iframe.contentWindow.addEventListener('message', handler)`
  - `iframe.src = url` / `iframe.srcdoc = html`

## Layout

```
src/
  browser-demo.ts      shared BrowserCore + the built-in srcdoc page library
  gjs/                 Adw.Application shell (header bar, URL entry, status bar)
  browser/             adwaita-web shell + index.html
```

## Architecture note

The cross-variant goal is that the same `browser-demo.ts` runs unchanged in both targets. `BrowserCore` operates on an `IFrameHandle` duck-typed against `HTMLIFrameElement` — a real `<iframe>` and `IFrameBridge.iframeElement` both satisfy it (because `IFrameBridge.iframeElement` IS an `HTMLIFrameElement`).

The one platform-specific concern: in the GJS variant, `IFrameWindowProxy` is lazy — `contentWindow` is null until the first navigation produces a `LoadEvent.FINISHED`. The GJS bootstrap re-attaches the BrowserCore listener via `iframeWidget.onReady(() => core.reattachListener())` after every load. The browser variant doesn't need this — a real `<iframe>` keeps `contentWindow` across navigations.

## Related

- [`@gjsify/iframe`](../../../packages/framework/iframe) — the `IFrameBridge` implementation this stress-tests
- [`@gjsify/message-channel`](../../../packages/web/message-channel) — the W3C MessageChannel + MessagePort surface backing the postMessage transport
- [`@gjsify/adwaita-web`](../../../packages/web/adwaita-web) — the Adwaita web components of the browser variant
- [`examples/dom/iframe-basic/`](../../../examples/dom/iframe-basic/) — the minimal bidirectional postMessage example on the same primitives

## License

MIT
