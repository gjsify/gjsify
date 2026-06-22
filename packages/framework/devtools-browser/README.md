# @gjsify/devtools-browser

A minimalist **Adwaita web browser** for debugging the web apps you build with gjsify — remotely controllable over MCP. Open a URL (or a `page:*` built-in page), then drive it from an AI agent: navigate, screenshot the rendered page, evaluate JS in the page, inspect elements, and read the DOM / network / accessibility trees.

It is built on [`@gjsify/iframe`](../iframe) (a `WebKit.WebView` postMessage bridge) and exposes the [`@gjsify/devtools`](../devtools) control plane through a **browser tool profile**, so the same `gjsify debug` MCP bridge that drives GTK apps drives the browser too.

## Quick start — `gjsify browse`

```bash
gjsify browse                                     # open page:welcome
gjsify browse https://localhost:8080              # open your gjsify web app
gjsify browse https://localhost:8080 --devtools   # + the MCP control plane
```

With `--devtools`, point an MCP client at the browser profile:

```jsonc
// .mcp.json
{ "mcpServers": { "browser": { "command": "gjsify", "args": ["debug", "--profile", "browser"] } } }
```

## Programmatic launch

```ts
import { runBrowserDevtools } from '@gjsify/devtools-browser';

await runBrowserDevtools({
    applicationId: 'org.example.Browser',
    homeUrl: 'https://localhost:8080',
    // title: 'My Debug Browser',
    // devtools: true,   // force-enable; otherwise gated on GJSIFY_DEVTOOLS
});
```

## The browser MCP tools (profile `browser`)

On top of the generic devtools tools (`get_status`, `screenshot`, …), the browser profile adds:

- **Navigation:** `navigate`, `back`, `forward`, `reload`, `get_page_info`, `wait_for_load`
- **Capture:** `page_screenshot` (PNG of the rendered **web content** via the WebKit compositor — the generic `screenshot` is blank because WebKit composites out-of-process; `region=full|visible`), `set_viewport`
- **Scripting / DOM:** `eval_js`, `get_links`, `follow_link`, `query_dom`, `get_console`
- **Inspector data (Tier B):** `inspect_element` (tag/id/class + attributes + bounding rect + box model + curated computed styles), `dom_tree`, `get_network` (Resource Timing API), `get_accessibility`
- **Inspector panel:** `open_inspector`, `close_inspector` (toggle the WebKit Web Inspector)

Because the apps you debug are themselves gjsify-built, you can render one here and assert against its real output in-page — no separate browser-automation stack. See the [Debugging & remote control guide](https://gjsify.github.io/gjsify/guides/devtools/).

## Inspector-data builders (Tier B)

The inspector tools are powered by **pure JS-expression builders** handed to `IFrameBridge.evaluateJavaScript` — the same headless-testable pattern as `@gjsify/iframe`'s DOM helpers. They are exported so you can reuse them:

```ts
import { buildInspectElementExpression, buildDomTreeExpression } from '@gjsify/devtools-browser';

const expr = buildInspectElementExpression('main .card');
const data = await bridge.evaluateJavaScript(expr); // { found, tagName, boxModel, computedStyle, … }
```

`buildInspectElementExpression`, `buildDomTreeExpression`, `buildNetworkExpression`, `buildAccessibilityExpression` (selectors are `JSON.stringify`'d so they can't break out of the generated expression).

## Exports

- `runBrowserDevtools(options)` / `BrowserApplication` — the one-call launcher + the `Adw.Application` host.
- `BrowserWindow` — the Adwaita shell (URL bar + the `IFrameBridge` content area).
- `BrowserCore` — the platform-agnostic navigation core (history stack, `navigate` / `back` / `forward` / `reload`, `onStateChange` / `onPageLoaded`); `BUILTIN_PAGE_URLS`, `DEFAULT_HOME_URL`.
- `browserDevtoolsExtension(...)` — the `DevtoolsExtension` that adds the `Browser*` methods to the control plane.
- the inspector-data expression builders + their result types (`InspectedElement`, `DomNode`, `AccessibilityNode`, `NetworkEntry`, `BoxModel`, …).

## Build / test

```bash
gjsify workspace @gjsify/devtools-browser build
gjsify workspace @gjsify/devtools-browser test
```

Requires `webkitgtk-6.0` (via `@gjsify/iframe`). The inspector-expression builders are covered by `src/inspector.spec.ts`; the navigation core by `src/browser-core.spec.ts`.
