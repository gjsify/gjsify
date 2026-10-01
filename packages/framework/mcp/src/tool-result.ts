// @gjsify/mcp — one result shape for success and failure alike.

/**
 * Every tool answers with a single JSON text block, so a client never has to guess. Errors carry
 * the message only: the underlying failures are protocol errors whose stack traces contain
 * hostnames and paths, and an MCP error string ends up in a transcript that outlives the request.
 */
export interface McpTextResult {
    content: Array<{ type: 'text'; text: string }>;
    isError?: boolean;
    // The SDK's `registerTool` handler return type extends a `Result` base with an index signature.
    [key: string]: unknown;
}

export function mcpSuccess(data: unknown): McpTextResult {
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

export function mcpError(message: string): McpTextResult {
    return { content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true };
}

/** Error result from a caught value (the common `catch` handler). */
export function mcpErrorFrom(err: unknown): McpTextResult {
    return mcpError(err instanceof Error ? err.message : String(err));
}
