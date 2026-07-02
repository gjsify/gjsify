// @gjsify/devtools-mcp — the one-call bridge entry point.
// Original implementation; server/loop wiring adapted from the map-editor bridge.

import GLib from '@girs/glib-2.0';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { DbusDevtoolsClient } from './dbus-client.js';
import { dbusError } from './error-map.js';
import { registerGenericTools } from './generic-tools.js';
import type { DevtoolsToolProfile, McpToolContext } from './profile.js';
import { GjsStdioTransport } from './stdio-transport.js';
import { fail, ok } from './tool-result.js';

/**
 * Run an MCP↔devtools bridge for a profile: build the server, register the
 * generic + app-specific tools, connect a GJS stdio transport, and pump the
 * GLib main loop until the client closes stdin. Logs only to stderr so the
 * JSON-RPC stdout stream stays clean.
 */
export async function runDevtoolsMcp(profile: DevtoolsToolProfile): Promise<void> {
    const client = new DbusDevtoolsClient(profile.busNameBase);
    const server = new McpServer({ name: profile.name, version: profile.version });
    const ctx: McpToolContext = {
        server,
        client,
        ok,
        fail,
        dbusError: (error, instance) => dbusError(error, client.resolve(instance)),
    };

    registerGenericTools(ctx, profile.genericTools ?? 'all');
    // A profile's `registerTools` may be async (e.g. the CDP profile lazily
    // loads its optional `@gjsify/devtools-cdp` peer). Fire it WITHOUT awaiting —
    // awaiting here would push `loop.run()` into a promise continuation and break
    // the nested GJS main loop (see below). Attach a `.catch()` so a missing
    // optional peer surfaces as a clean stderr line, not an unhandled rejection.
    Promise.resolve(profile.registerTools?.(ctx)).catch((error: unknown) =>
        console.error('[gjsify-devtools-mcp] tool registration failed:', error),
    );

    const loop = GLib.MainLoop.new(null, false);
    const transport = new GjsStdioTransport(() => loop.quit());

    // Kick the connect (which starts the stdio read loop) WITHOUT awaiting, then
    // run the GLib main loop SYNCHRONOUSLY. Running `loop.run()` after an `await`
    // (i.e. from inside a promise/microtask continuation) breaks the nested main
    // loop under GJS — the read loop never gets pumped. Same structure as the
    // map-editor bridge: connect fire-and-forget, loop.run() on the sync stack.
    server.connect(transport).then(
        () => console.error(`[gjsify-devtools-mcp] ${profile.name} on stdio (DBus base: ${profile.busNameBase})`),
        (error: unknown) => {
            console.error('[gjsify-devtools-mcp] failed to connect:', error);
            loop.quit();
        },
    );
    loop.run();
}
