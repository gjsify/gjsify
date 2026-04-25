// MCP Server example — stdio transport.
// Demonstrates tool, resource, and prompt registration using @modelcontextprotocol/sdk.
// Runs on both Node.js and GJS via @gjsify/*.
//
// Usage (stdio — connect via MCP client):
//   node dist/index.node.mjs
//   gjsify run dist/index.gjs.mjs

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({
  name: 'gjsify-example-server',
  version: '1.0.0',
});

// --- Tools ---

server.registerTool('echo', {
  description: 'Echoes back the provided message',
  inputSchema: z.object({
    message: z.string().describe('The message to echo'),
  }),
}, async ({ message }) => ({
  content: [{ type: 'text', text: message }],
}));

server.registerTool('add', {
  description: 'Adds two numbers',
  inputSchema: z.object({
    a: z.number().describe('First number'),
    b: z.number().describe('Second number'),
  }),
}, async ({ a, b }) => ({
  content: [{ type: 'text', text: String(a + b) }],
}));

// --- Resources ---

server.registerResource(
  'server-info',
  'info://server',
  { description: 'Server metadata', mimeType: 'application/json' },
  async () => ({
    contents: [{
      uri: 'info://server',
      text: JSON.stringify({
        name: 'gjsify-example-server',
        version: '1.0.0',
        tools: ['echo', 'add'],
        runtime: typeof globalThis.imports !== 'undefined' ? 'gjs' : 'node',
      }, null, 2),
    }],
  }),
);

// --- Prompts ---

server.registerPrompt('greet', {
  description: 'Generate a greeting message',
  argsSchema: { name: z.string().describe('Name to greet') },
}, async ({ name }) => ({
  messages: [{
    role: 'assistant',
    content: { type: 'text', text: `Hello, ${name}! Welcome to the gjsify MCP server.` },
  }],
}));

// --- Start ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('MCP server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error instanceof Error ? error.message : error);
  if (error instanceof Error && error.stack) console.error(error.stack);
  process.exit(1);
});
