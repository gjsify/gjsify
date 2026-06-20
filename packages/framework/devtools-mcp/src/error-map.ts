// @gjsify/devtools-mcp — map a DBus failure to a clear MCP tool result.
// Original implementation; classification adapted from the map-editor bridge.

import { parseDbusErrorMessage } from '@gjsify/devtools-protocol';
import { fail, type ToolResult } from './tool-result.js';

const NOT_RUNNING = /ServiceUnknown|NameHasNoOwner|was not provided by any|StartServiceByName/;

/**
 * Map a DBus call failure to a clear MCP tool result. Distinguishes:
 * (1) the app isn't running on the bus, (2) a typed devtools rejection the
 * app threw — its `<code>: message` survives as a GDBus remote error (see
 * `formatDbusErrorMessage`), so the original, actionable message is surfaced,
 * (3) any other DBus failure.
 */
export function dbusError(error: unknown, resolved: { busName: string; instance: string }): ToolResult {
    const message = error instanceof Error ? error.message : String(error);
    if (NOT_RUNNING.test(message)) {
        return fail(
            `No devtools-enabled app on the session bus (${resolved.busName}, instance "${resolved.instance}"). ` +
                'Launch the app with GJSIFY_DEVTOOLS=1. ' +
                `(D-Bus error: ${message})`,
        );
    }
    const remote = message.match(/GDBus\.Error:[^\s:]*:\s*([\s\S]+)/)?.[1]?.trim();
    if (remote) {
        const parsed = parseDbusErrorMessage(remote);
        return fail(parsed.code === 'internal' ? `D-Bus call failed: ${remote}` : `${parsed.code}: ${parsed.message}`);
    }
    return fail(`D-Bus call failed: ${message}`);
}
