# @gjsify/integration-devtools-cdp

Integration test for [`@gjsify/devtools-cdp`](../../../packages/framework/devtools-cdp)'s
`InspectorProtocolClient` against a **live WebKit remote inspector**.

WebKit's remote inspector protocol is CDP-shaped (JSON-RPC over a per-target
WebSocket) but it is *not* headless — it needs a real WebKitGTK WebView with a
display. So, like [`tests/integration/autobahn`](../autobahn), this suite is
**opt-in** and **skips itself** when no inspector is reachable: with
`GJSIFY_CDP_INSPECTOR_PORT` unset (the CI default) it registers a single passing
"skipped" test and exits 0.

## Running it against a live browser

Two terminals.

**Terminal 1 — launch the Adwaita browser with the inspector enabled:**

```sh
gjsify browse https://example.org --inspector-port 9222
```

`gjsify browse --inspector-port` sets `WEBKIT_INSPECTOR_HTTP_SERVER=127.0.0.1:9222`
in the launcher env *before* spawning gjs (WebKit reads it once, at
`WebKitInitialize`, before the app constructor runs) and turns on
`developer-extras` so the remote inspector server binds.

**Terminal 2 — run the suite, pointing it at that port:**

```sh
GJSIFY_CDP_INSPECTOR_PORT=9222 \
  gjsify workspace @gjsify/integration-devtools-cdp test
```

The suite polls `discoverInspectorTargets(9222)` until a `web-page` target shows
up (the browser may still be starting), connects to it, enables the
`Inspector`/`Runtime`/`DOM`/`Console` domains, and then asserts real protocol
round-trips:

- **Runtime** — `Runtime.evaluate('1 + 1', returnByValue)` → `2`; `({x:1})`
  yields an object handle with an `objectId`; an undefined reference sets
  `wasThrown`.
- **DOM** — `DOM.getDocument` returns the `#document` root (`nodeType` 9);
  `DOM.querySelector('body')` + `DOM.getOuterHTML` returns `<body…>`;
  `DOM.querySelectorAll('div')` returns a `nodeIds` array.

These are ported from `refs/webkit/LayoutTests/inspector/{runtime,dom}`.
