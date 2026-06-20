// @gjsify/devtools-mcp — MCP tool-result shapes + constructors.
// Original implementation.

export interface ToolResult {
    content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>;
    isError?: boolean;
    // MCP's CallToolResult extends its `Result` base, which carries an index
    // signature; the SDK's registerTool handler return type requires it.
    [key: string]: unknown;
}

export const ok = (text: string): ToolResult => ({ content: [{ type: 'text', text }] });

export const fail = (text: string): ToolResult => ({ content: [{ type: 'text', text }], isError: true });

export const image = (base64: string, mimeType = 'image/png'): ToolResult => ({
    content: [{ type: 'image', data: base64, mimeType }],
});
