// @gjsify/mcp — default-deny gate for mutating tools.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Gate mutating tools, DEFAULT-DENY.
 *
 * Unless writes are explicitly allowed, a tool is registered ONLY if it proves it is read-only
 * (`annotations.readOnlyHint === true`). A tool that omits the annotation, or mis-sets it, is
 * DROPPED.
 *
 * The direction is the whole point: the obvious spelling — drop only when `readOnlyHint === false`
 * — fails OPEN, silently exposing every tool whose author forgot the annotation. This one fails
 * CLOSED: the failure mode is a tool missing from `tools/list`, which gets noticed and fixed,
 * instead of a mutation quietly reachable. Tools identify themselves by their own annotation, so
 * there is no second name list to drift.
 *
 * Call this BEFORE registering anything — it wraps `registerTool`, so tools registered earlier
 * are already through.
 */
export function applyReadOnlyGate(server: McpServer, allowWrite: boolean): void {
    if (allowWrite) return;
    const orig = server.registerTool.bind(server);
    server.registerTool = ((name: string, config: { annotations?: { readOnlyHint?: boolean } }, ...rest: unknown[]) =>
        config?.annotations?.readOnlyHint === true
            ? (orig as (...a: unknown[]) => unknown)(name, config, ...rest)
            : undefined) as typeof server.registerTool;
}
