# @gjsify/mcp

Server-side runtime for [MCP](https://modelcontextprotocol.io) servers that run on GJS and Node. It wraps `@modelcontextprotocol/sdk` (a peer dependency) with the lifecycle pieces every stdio server ends up re-writing.

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { applyReadOnlyGate, serveStdio, mcpSuccess } from '@gjsify/mcp';

const server = new McpServer({ name: 'demo', version: '1.0.0' });
applyReadOnlyGate(server, process.env.ALLOW_WRITE === '1'); // BEFORE any registerTool
server.registerTool('ping', { annotations: { readOnlyHint: true } }, async () => mcpSuccess({ pong: true }));
await serveStdio(server, 'demo');
```

## API

| Export | Purpose |
|---|---|
| `applyReadOnlyGate(server, allowWrite)` | Default-deny: without `allowWrite`, only tools with `annotations.readOnlyHint === true` are registered. A forgotten annotation drops the tool (visible), it never exposes a mutation (silent). Call it before registering tools. |
| `applyGrantGate(server, grants)` + `requiresCapability(config, { capability, targetOf })` | Per-capability successor ([ADR 0106](../../../docs/adr/0106-mcp-tools-register-per-granted-capability.md)). `grants` is the app's `{ capability, target }[]`. A tool registers if read-only, or if it declares a capability with ≥1 grant. The gate's wrapper also checks each call: the handler runs only when `targetOf(args)` equals a grant's target exactly; otherwise an MCP error names the capability. No capability names live here; no wildcards; empty targets are refused. `applyReadOnlyGate` is unchanged. |
| `serveUntilClosed(server, { label?, stdin?, stdout? })` | Connect over stdio and resolve when the client goes away (stdin `end`/`close` or transport close). The SDK does not report stdin EOF itself, so a server without this outlives its client. Streams are injectable for tests. |
| `serveStdio(server, label?)` | `serveUntilClosed`, then `process.exit(0)` — needed under GJS, where the GLib main loop keeps an idle process alive. |
| `mcpSuccess(data)` / `mcpError(msg)` / `mcpErrorFrom(err)` | One result shape: a single JSON text block. Errors carry the message only, never a stack. |

Logs go to stderr; stdout is the protocol channel.

## License

MIT
