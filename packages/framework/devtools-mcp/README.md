# @gjsify/devtools-mcp

The **MCP bridge** for the gjsify devtools control plane. It speaks JSON-RPC on stdio to an MCP client (Claude Code, the MCP Inspector, …) and translates each tool call to the app's `org.gjsify.Devtools` DBus interface. The result: an AI agent can inspect, screenshot, and drive any [`@gjsify/devtools`](../devtools)-enabled GJS app.

You usually don't import this directly — `gjsify debug` generates a bridge entry that calls `runDevtoolsMcp(profile)` and builds/launches it. Reach for the library API only when wiring a custom bridge.

## Quick start — `gjsify debug`

1. Enable devtools in your app (see [`@gjsify/devtools`](../devtools)) and run it with `GJSIFY_DEVTOOLS=1`.
2. Point your MCP client at the bridge. The CLI builds it on demand:

```jsonc
// .mcp.json
{
  "mcpServers": {
    "my-app": { "command": "gjsify", "args": ["debug", "--bus-name", "org.example.App"] }
  }
}
```

The bridge auto-selects a **tool profile** from your `package.json` deps: `storybook` if `@gjsify/storybook` is present, `browser` if `@gjsify/devtools-browser` is, else the `generic` profile. Override with `--profile`.

For a fixed binary path (no rebuild per launch), build once and point at the bundle:

```bash
gjsify debug --build-only --out dist/bridge.gjs.mjs
# .mcp.json → { "command": "dist/bridge.gjs.mjs" }
```

## No session bus? (macOS, Windows)

The bridge dials a **peer address** when there is no session bus — see [`@gjsify/devtools`](../devtools#no-session-bus-macos-windows) for the app side and the `dbus-run-session` trap. Precedence, mirroring the app's:

1. `--address <addr>` (equivalently `gjsify.devtools.address` in `package.json`, `profile.address`, or `new DbusDevtoolsClient(base, { address })`)
2. `GJSIFY_DEVTOOLS_ADDRESS`
3. the address file the app publishes under `<runtime-dir>/gjsify-devtools/` — it outranks the bus because it is meant to be evidence that an app of exactly this id is listening right now, so the bridge **checks** it: the address is dialled, and if nothing answers the file is deleted and resolution continues at step 4. Ctrl-C, `SIGKILL` and a crash all leave the file behind (and on macOS/Windows `GLib.get_user_runtime_dir()` degrades to the user cache dir, where it survives reboots), so a claim that is merely *present* proves nothing
4. the session bus (Linux default, unchanged: with nothing in peer mode no address file exists, so step 3 is a `stat` that misses — and a stale one degrades to exactly this row)
5. otherwise a hard error naming all three ways in, rather than a client that cannot call anything

An **explicit** address (steps 1–2) deliberately does *not* fall back: it is pinned on both sides, so a dead one fails with a message naming that address instead of quietly talking to something else.

In peer mode a call carries **no destination bus name** (a peer connection has no name registry), `list_instances` reports the single connected app instead of enumerating the bus, and a failure names the address rather than a bus name.

```bash
gjsify debug --bus-name org.example.App --address unix:path=/tmp/myapp-devtools.sock
```

## Profiles

A `DevtoolsToolProfile` maps the generic + app-specific DBus methods to MCP tools:

- **generic** — `get_status`, `screenshot`, `list_actions`, `activate_action`, `resize_window`, `present_window`, and the introspection tools.
- **storybook** — `list_stories`, `get_current_story`, `open_story`, `set_story_arg` (+ generics; screenshot via the generic `screenshot`).
- **browser** — the [`@gjsify/devtools-browser`](../devtools-browser) web-debugging tools: `navigate`, `page_screenshot`, `eval_js`, `inspect_element`, `dom_tree`, `get_network`, … (+ generics).
- **cdp** — the [`@gjsify/devtools-cdp`](../devtools-cdp) WebKit-remote-inspector tools: `cdp_send` (any `Domain.command`), `cdp_connect` / `cdp_discover_targets` / `cdp_drain_events`, plus ~13 curated typed tools (`cdp_runtime_evaluate`, `cdp_dom_get_document`, `cdp_css_get_computed_style_for_node`, …) generated from the protocol spec (+ generics).

## Library API

```ts
import { runDevtoolsMcp, storybookProfile } from '@gjsify/devtools-mcp';

// A built-in profile:
await runDevtoolsMcp(storybookProfile('org.example.Storybook'));

// Or the generic profile for any devtools-enabled app:
await runDevtoolsMcp({ name: 'my-app-devtools', version: '0.10.0', busNameBase: 'org.example.App' });
```

## Exports

- `runDevtoolsMcp(profile)` — build the MCP server, register the profile's tools, serve over `GjsStdioTransport`.
- `DbusDevtoolsClient` — the DBus client (`control()` for raw GVariant replies, `jsonCall()` for `…->s` JSON methods, `transport` for the resolved transport, `describeTarget()` for diagnostics).
- `chooseClientTransport(input)` — the precedence above as a pure function; `connectToDevtools(ctx, deps?)` — that precedence turned into a live connection (dial-then-fallback; `deps` exists so every row is testable on a host with no bus daemon); `ClientTransportChoice`, `DbusDevtoolsClientOptions`, `DevtoolsInstanceRef`.
- `registerGenericTools`, `storybookProfile` / `registerStorybookTools`.
- `GjsStdioTransport` — stdio transport (Node's `StdioServerTransport` does not work under the GJS bundle).
- `ok` / `fail` / `image` (`ToolResult` helpers; `image` takes base64), `dbusError` (error mapping).
- `DevtoolsToolProfile`, `McpToolContext`, `GenericToolName`, and the re-exported `@gjsify/devtools-protocol` contract.

> **MCP gotcha:** stdout is the JSON-RPC channel — the bridge and `gjsify debug` log to **stderr only**. Keep any custom logging off stdout.

## Build / test

```bash
gjsify workspace @gjsify/devtools-mcp build
gjsify workspace @gjsify/devtools-mcp test
```
