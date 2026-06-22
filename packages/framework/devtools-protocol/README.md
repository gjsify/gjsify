# @gjsify/devtools-protocol

The **transport-agnostic contract** for the gjsify devtools control plane — pure TypeScript, no platform imports, no side effects. It defines the method surface, the pause classification, the JSON envelope, the server/client transport interfaces, instance routing, and the well-known DBus interface name.

Every adapter and bridge imports it so they always agree:

- [`@gjsify/devtools`](../devtools) — the in-app **DBus** adapter (GTK/GJS).
- [`@gjsify/devtools-mcp`](../devtools-mcp) — the **MCP bridge** an agent talks to.
- A future `@gjsify/devtools-web` — a **WebSocket** adapter for web apps.

Because it is pure, browser web apps can import it too — the same envelope maps 1:1 onto WebSocket-JSON-RPC.

## The contract

The surface is **commands + state + introspection**, not "GActions" — so it is toolkit-neutral.

```ts
import { DEVTOOLS_INTERFACE, GENERIC_METHODS, type MethodKind } from '@gjsify/devtools-protocol';

DEVTOOLS_INTERFACE; // 'org.gjsify.Devtools' — constant across apps; each app uses its own bus name + path
```

### Generic methods and the pause policy

Each method carries a **kind** that the pause guard enforces. When a host pauses external control, `mutating` methods are rejected; `read-only` and `presence` always pass.

| Kind | Meaning | While paused |
|---|---|---|
| `read-only` | Observation / diagnostics (`GetStatus`, `Screenshot`, `DumpTree`, …) | allowed |
| `presence` | An external driver's own awareness channel (cursor / label) | allowed |
| `mutating` | Edits app state or the user's UI (`ActivateAction`, `SetProperty`, `SwapCss`, …) | rejected |

`GENERIC_METHODS` is the toolkit-neutral baseline (core control + full introspection). Adapters implement the subset they support; the bridge advertises only the implemented ones. App-specific methods are added via extensions with their own kinds — **the registry rejects an unclassified method name**, so a new method cannot silently bypass the pause policy.

## Exports

- `DEVTOOLS_INTERFACE` — the well-known interface name.
- `GENERIC_METHODS`, `MethodKind`, `GenericMethodName` — the method surface + classification.
- `DevtoolsServerTransport` / `DevtoolsClientTransport` — the app-side (`serve(handler)` / `close()`) and bridge-side (`connect()` / `request(req)` / `close()`) transport seams, plus the `DevtoolsHandler` type.
- envelope + error types, the method registry, instance-routing helpers, and shared introspection types.

## Build / test

```bash
gjsify workspace @gjsify/devtools-protocol build
gjsify workspace @gjsify/devtools-protocol test
```
