// MCP Server example — Streamable HTTP transport.
// Demonstrates an HTTP-based MCP server using @modelcontextprotocol/sdk
// with @hono/node-server for the Node.js HTTP ↔ Web Standard bridge.
// Runs on both Node.js and GJS via @gjsify/*.
//
// Usage:
//   node dist/index.node.mjs       → http://localhost:3000/mcp
//   gjsify run dist/index.gjs.mjs  → http://localhost:3000/mcp

import { createServer } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

const PORT = parseInt(process.env.PORT || '3000', 10);

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'gjsify-http-server',
    version: '1.0.0',
  });

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

  server.registerResource(
    'server-info',
    'info://server',
    { description: 'Server metadata', mimeType: 'application/json' },
    async () => ({
      contents: [{
        uri: 'info://server',
        text: JSON.stringify({
          name: 'gjsify-http-server',
          version: '1.0.0',
          transport: 'streamable-http',
          runtime: typeof globalThis.imports !== 'undefined' ? 'gjs' : 'node',
        }, null, 2),
      }],
    }),
  );

  server.registerPrompt('greet', {
    description: 'Generate a greeting message',
    argsSchema: { name: z.string().describe('Name to greet') },
  }, async ({ name }) => ({
    messages: [{
      role: 'assistant',
      content: { type: 'text', text: `Hello, ${name}! Welcome to the gjsify HTTP MCP server.` },
    }],
  }));

  return server;
}

async function main() {
  // Per-session transport map (stateful mode)
  const transports = new Map<string, StreamableHTTPServerTransport>();

  const httpServer = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

    // Only handle /mcp endpoint
    if (url.pathname !== '/mcp') {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found. MCP endpoint is at /mcp');
      return;
    }

    if (req.method === 'POST') {
      // Check for existing session
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      let transport: StreamableHTTPServerTransport;

      if (sessionId && transports.has(sessionId)) {
        transport = transports.get(sessionId)!;
      } else {
        // New session — create transport and server
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
        });

        transport.onclose = () => {
          if (transport.sessionId) {
            transports.delete(transport.sessionId);
          }
        };

        const mcpServer = createMcpServer();
        await mcpServer.connect(transport);

        if (transport.sessionId) {
          transports.set(transport.sessionId, transport);
        }
      }

      await transport.handleRequest(req, res);
    } else if (req.method === 'GET') {
      // SSE endpoint for server-initiated messages
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      if (sessionId && transports.has(sessionId)) {
        const transport = transports.get(sessionId)!;
        await transport.handleRequest(req, res);
      } else {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Missing or invalid session ID');
      }
    } else if (req.method === 'DELETE') {
      // Session termination
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      if (sessionId && transports.has(sessionId)) {
        const transport = transports.get(sessionId)!;
        await transport.handleRequest(req, res);
        transports.delete(sessionId);
      } else {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Missing or invalid session ID');
      }
    } else {
      res.writeHead(405, { 'Content-Type': 'text/plain' });
      res.end('Method not allowed');
    }
  });

  httpServer.listen(PORT, () => {
    console.log(`MCP HTTP server listening on http://localhost:${PORT}/mcp`);
  });
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
