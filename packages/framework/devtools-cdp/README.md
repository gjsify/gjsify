# @gjsify/devtools-cdp

A client for the **WebKit Remote Inspector Protocol** — the CDP-shaped (Chrome DevTools Protocol-shaped) JSON-RPC protocol that WebKitGTK speaks over a per-target WebSocket. It is the foundation for driving a real WebKitGTK page's deep devtools (Runtime / DOM / CSS / Network / Console / Debugger) from an agent over MCP — the deep-protocol companion to [`@gjsify/devtools-browser`](../devtools-browser)'s in-page-eval inspector tools.

> **CDP?** WebKit's protocol is *shaped like* Chrome's CDP (same domain/command/event structure, many identical names) but is **not** CDP — it's WebKit's own "Remote Inspector Protocol", with real differences (`DOM.getOuterHTML`, no `Page.navigate`, …). The `-cdp` name is the widely-recognized shorthand for "this family of protocols".

It ships three layers: the **transport-pure** protocol client + target discovery (usable standalone), the **in-app `DevtoolsExtension`** that exposes the protocol over the `org.gjsify.Devtools` control plane, and the **protocol→MCP tool generator**. The curated `cdpProfile` that registers those tools (driven by `gjsify debug --profile cdp`) lives in [`@gjsify/devtools-mcp`](../devtools-mcp), where zod lives.

## Protocol client

```ts
import { InspectorProtocolClient } from '@gjsify/devtools-cdp';

const client = new InspectorProtocolClient('ws://127.0.0.1:9222/socket/1/1/web-page');
await client.connect();
await client.enableDomains(['Inspector', 'Runtime', 'DOM', 'Console']);

const result = await client.send('Runtime.evaluate', { expression: '1 + 1', returnByValue: true });
// → { result: { type: 'number', value: 2 }, wasThrown: false }

client.on('Console.messageAdded', (params) => console.log('console:', params));
const events = client.drainEvents(); // poll buffered events (for a stateless MCP bridge)
client.close();
```

- **`send(method, params?)`** — id-correlated request; resolves with the `result`, rejects with a `ProtocolError` on a protocol error or on timeout.
- **`on(method, cb)` / `awaitEvent(method, predicate?, timeoutMs?)`** — subscribe to pushed events.
- **`drainEvents()`** — return + clear a bounded ring buffer of events (the poll a request/response MCP transport uses for pushed notifications).
- **`enableDomains([...])`** — send `<Domain>.enable` for each (tolerates domains with no `enable`).

One client == one WebSocket == one target (WebKit has no session multiplexing). The client is written against a minimal `WebSocketLike` surface with an injectable factory, so it is **fully unit-testable headless** — and under GJS it uses the global `WebSocket` from [`@gjsify/websocket`](../../web/websocket) (libsoup).

## Target discovery

WebKit's inspector HTTP server (enabled with `WEBKIT_INSPECTOR_HTTP_SERVER=host:port`) has **no `/json` endpoint** — `GET /` returns an HTML listing of `<a href="/socket/{conn}/{target}/{type}">` anchors. This package parses them:

```ts
import { discoverInspectorTargets } from '@gjsify/devtools-cdp';

const targets = await discoverInspectorTargets(9222); // [{ connectionId, targetId, targetType, wsUrl, title }]
const page = targets.find((t) => t.targetType === 'web-page');
const client = new InspectorProtocolClient(page!.wsUrl);
```

Targets only appear once a page has begun loading, so a caller racing startup should poll — an empty array is a valid "not ready yet". `parseInspectorTargetsHtml(html, host, port)` is the pure, exported core (`fetch` is injectable for tests).

## In-app bridge

`inspectorProtocolExtension({ port })` returns a [`DevtoolsExtension`](../devtools) that adds four methods to the app's `org.gjsify.Devtools` control plane:

| DBus method | MCP-facing | Kind |
|---|---|---|
| `CdpDiscoverTargets()` | list inspectable targets | read-only |
| `CdpConnect(target_json)` | connect (defaults to the first `web-page`) + auto-`enable` Inspector/Runtime/DOM/Console | read-only |
| `CdpSend(method, params_json)` | the universal escape hatch to any `Domain.command` | mutating |
| `CdpDrainEvents()` | poll + clear buffered protocol events | read-only |

The WebSocket(s) live **in the app process** (one client per connected target, cached) — never in the MCP bridge — so the bridge runs no second GLib main loop; it just calls these DBus methods.

`@gjsify/devtools-browser` wires this in automatically: **`gjsify browse --inspector-port 9222 --devtools`** sets `WEBKIT_INSPECTOR_HTTP_SERVER=127.0.0.1:9222` before the WebView, marks the view inspectable, and adds the extension. Then **`gjsify debug --profile cdp`** bridges it to MCP — the `cdp_send` escape hatch + the curated typed tools.

## Protocol spec + tool generation

The 27 WebKit protocol domains are embedded as a **pruned snapshot** in `src/spec-data.ts` (generated from `refs/webkit` by `scripts/generate-spec-data.mjs`), so the package needs no `refs/webkit` at runtime. `generateCdpTools(PROTOCOL_SPEC)` turns it into MCP-tool descriptors — one per command (248 of them):

```ts
import { PROTOCOL_SPEC, generateCdpTools } from '@gjsify/devtools-cdp';

const tools = generateCdpTools(PROTOCOL_SPEC);
// [{ name: 'cdp_runtime_evaluate', method: 'Runtime.evaluate', domain, command,
//    description, parameters: [{ name, jsType, optional, description, enum? }] }, …]

const curated = generateCdpTools(PROTOCOL_SPEC, { include: (d, c) => d === 'Runtime' && c === 'evaluate' });
```

Each descriptor flattens the command's parameters to simplified JS types (`$ref` resolved one level to its base type) — no zod/MCP dependency here, so it stays pure + headless-testable. The curated `cdpProfile` (in `@gjsify/devtools-mcp`, where zod lives) turns these descriptors into registered MCP tools; regenerate the snapshot with `node scripts/generate-spec-data.mjs <protocolDir>` after a WebKit protocol bump.

## Exports

- `InspectorProtocolClient`, `ProtocolError` (+ types `InspectorProtocolClientOptions`, `ProtocolEvent`, `ProtocolEventListener`, `WebSocketLike`, `WebSocketFactory`)
- `discoverInspectorTargets`, `parseInspectorTargetsHtml` (+ types `InspectorTarget`, `DiscoverInspectorTargetsOptions`)
- `inspectorProtocolExtension` (+ type `InspectorProtocolExtensionOptions`)
- `PROTOCOL_SPEC`, `PROTOCOL_SOURCE`, `buildTypeIndex`, `resolveRef` (+ protocol types `ProtocolDomain` / `ProtocolCommand` / `ProtocolType` / `ProtocolParameter`)
- `generateCdpTools`, `cdpToolName`, `snakeCase` (+ types `CdpToolDescriptor`, `CdpToolParam`, `CdpJsType`, `GenerateCdpToolsOptions`)

## Build / test

```bash
gjsify workspace @gjsify/devtools-cdp build
gjsify workspace @gjsify/devtools-cdp test
```

86 headless tests: `inspector-protocol-client.spec.ts` (mock WebSocket — id correlation, events, timeout, close), `target-discovery.spec.ts` (captured WebKit listing + injected fetch), `inspector-protocol-extension.spec.ts` (auto-replying mock WS driving the `Cdp*` handlers), `tool-generator.spec.ts` (fixture domain + the embedded spec).
