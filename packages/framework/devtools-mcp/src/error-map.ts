// @gjsify/devtools-mcp — map a DBus failure to a clear MCP tool result.
// Original implementation; classification adapted from the map-editor bridge.

import { parseDbusErrorMessage } from '@gjsify/devtools-protocol';
import { fail, type ToolResult } from './tool-result.js';

const NOT_RUNNING = /ServiceUnknown|NameHasNoOwner|was not provided by any|StartServiceByName/;

/**
 * Map a DBus call failure to a clear MCP tool result. Distinguishes:
 * (1) the app isn't reachable, (2) a typed devtools rejection the
 * app threw — its `<code>: message` survives as a GDBus remote error (see
 * `formatDbusErrorMessage`), so the original, actionable message is surfaced,
 * (3) any other DBus failure.
 *
 * `target` names WHERE the bridge was dialling (`client.describeTarget()`).
 * Without it the not-running message said "on the session bus" unconditionally,
 * which is wrong — and confusing — in peer mode, where there is no bus at all.
 */
export function dbusError(
    error: unknown,
    resolved: { busName: string; instance: string },
    target?: string,
): ToolResult {
    const message = error instanceof Error ? error.message : String(error);
    if (NOT_RUNNING.test(message)) {
        const where = target ?? `session bus name ${resolved.busName}`;
        return fail(
            `No devtools-enabled app at ${where} (instance "${resolved.instance}"). ` +
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
