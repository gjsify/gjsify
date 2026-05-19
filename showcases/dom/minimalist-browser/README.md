# @gjsify/example-dom-minimalist-browser

Minimalist browser showcase — URL bar + Back/Forward/Reload buttons + iframe content area. Runs in both a real browser (using a native `<iframe>`) and natively under GJS (using `@gjsify/iframe`'s `IFrameBridge` over `WebKit.WebView`). The same shared core (`src/browser-demo.ts`) drives both variants — only the platform-specific UI shell differs.

Purpose: stress-test `@gjsify/iframe`'s feature-completeness against a non-trivial application. Any gap surfaces here and lands in the same workstream.

## What it demonstrates

| Feature | Browser variant | GJS variant |
|---|---|---|
| Iframe content area | Real `<iframe>` element | `IFrameBridge` → `WebKit.WebView` |
| URL bar navigation | Set `iframe.src` | `IFrameBridge.loadUri()` / `loadHtml()` |
| Back / Forward / Reload | Application-side history stack + `iframe.src = url` | Same — symmetric code path |
| postMessage (page → parent) | Native `window.parent.postMessage()` | WebKit script-message-handler → `MessageBridge` → `MessageEvent` |
| Built-in srcdoc pages | `iframe.srcdoc = html` | `IFrameBridge.loadHtml(html)` (calls through to `WebKit.WebView.load_html`) |
| Adwaita design language | `@gjsify/adwaita-web` web components | Native Adw widgets (`Gtk.ApplicationWindow`, `Adw.HeaderBar`, `Gtk.Entry`, `Gtk.Button`) |

The application-side history stack keeps both variants symmetric — browsers won't allow cross-origin `iframe.contentWindow.history.go(-1)` programmatically, so both variants pop the parent-tracked stack and re-load the URL the same way. (`IFrameBridge` also exposes WebKit's internal `goBack` / `goForward` / `reload` / `canGoBack` / `canGoForward` for apps that prefer the WebKit-side back/forward list — see the API table below.)

## Run

```bash
yarn build
yarn start           # GJS / GTK4 native window
yarn start:browser   # http-server dist; open localhost:8080
```

Both variants:

1. Open with `page:welcome` loaded
2. Quick-nav strip lists built-in pages: `page:welcome`, `page:about`, `page:postmessage`, `page:adwaita`
3. URL bar accepts both the `page:<name>` scheme (loads from in-memory page library via `srcdoc` / `loadHtml`) and real URLs like `https://example.com` (GJS variant: loads via WebKit; browser variant: loaded by the browser's iframe)
4. Each built-in page sends a `{type: 'page-loaded', title, url}` postMessage on `DOMContentLoaded`; the parent's status line displays it

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
  - `IFrameBridge` — `WebKit.WebView` subclass with the iframe-element wrapper, message bridge, ready callbacks, `.loadUri()` / `.loadHtml()` / `.postMessage()`, plus new `.goBack()` / `.goForward()` / `.canGoBack` / `.canGoForward` (this PR) — and `.reload()` inherited from `WebKit.WebView` natively
  - `HTMLIFrameElement` — `.src`, `.srcdoc`, `.contentWindow`, `.contentDocument` (stub)
  - `IFrameWindowProxy` — `.postMessage()` + `addEventListener('message')`
  - `MessageBridge` — bidirectional postMessage transport via WebKit's script-message-handler
- W3C surface (same on both variants):
  - `iframe.contentWindow.postMessage(data, '*')`
  - `iframe.contentWindow.addEventListener('message', handler)`
  - `iframe.src = url` / `iframe.srcdoc = html`

## Architecture note

The cross-variant goal is that the same `browser-demo.ts` runs unchanged in both targets. `BrowserCore` operates on an `IFrameHandle` duck-typed against `HTMLIFrameElement` — real `<iframe>` and `IFrameBridge.iframeElement` both satisfy it (because `IFrameBridge.iframeElement` IS an `HTMLIFrameElement`).

The one platform-specific concern: in the GJS variant, `IFrameWindowProxy` is lazy — `contentWindow` is null until the first navigation produces a `LoadEvent.FINISHED`. The GJS bootstrap re-attaches the BrowserCore listener via `iframeWidget.onReady(() => core.reattachListener())` after every load. The browser variant doesn't need this — a real `<iframe>` keeps `contentWindow` across navigations.

## Related

- [`examples/dom/iframe-basic/`](../../../examples/dom/iframe-basic/) — minimal bidirectional postMessage example (167 LOC, single file). The minimalist-browser showcase is a more substantive build on the same primitives.
- [`@gjsify/iframe`](../../../packages/framework/iframe/) — the IFrameBridge implementation.
- [`@gjsify/message-channel`](../../../packages/web/message-channel/) — the W3C MessageChannel + MessagePort surface backing the postMessage transport (PR #196 / #198).
