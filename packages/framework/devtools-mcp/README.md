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

## Profiles

A `DevtoolsToolProfile` maps the generic + app-specific DBus methods to MCP tools:

- **generic** — `get_status`, `screenshot`, `list_actions`, `activate_action`, `resize_window`, `present_window`, and the introspection tools.
- **storybook** — `list_stories`, `get_current_story`, `open_story`, `set_story_arg` (+ generics; screenshot via the generic `screenshot`).
- **browser** — the [`@gjsify/devtools-browser`](../devtools-browser) web-debugging tools: `navigate`, `page_screenshot`, `eval_js`, `inspect_element`, `dom_tree`, `get_network`, … (+ generics).

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
- `DbusDevtoolsClient` — the DBus client (`control()` for raw GVariant replies, `jsonCall()` for `…->s` JSON methods).
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
