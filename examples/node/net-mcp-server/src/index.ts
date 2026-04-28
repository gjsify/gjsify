// MCP Server example — Streamable HTTP transport.
// Demonstrates an HTTP-based MCP server using @modelcontextprotocol/sdk.
// Runs on both Node.js and GJS via @gjsify/*.
//
// Usage:
//   node dist/index.node.mjs       → http://localhost:3000/mcp
//   gjsify run dist/index.gjs.mjs  → http://localhost:3000/mcp

import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
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

  // Use explicit path component (info://server/meta, not info://server) — GJS's
  // URL parser normalises authority-only URIs to add a trailing slash, which
  // breaks string-equality lookup against the registered template on the
  // server side. Node's URL parser preserves the bare authority form.
  server.registerResource(
    'server-info',
    'info://server/meta',
    { description: 'Server metadata', mimeType: 'application/json' },
    async () => ({
      contents: [{
        uri: 'info://server/meta',
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

/** Read the full request body as a string, then parse as JSON. */
function readRequestBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk: any) => { data += String(chunk); });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : undefined);
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

async function main() {
  const transports = new Map<string, StreamableHTTPServerTransport>();
  // Per-session McpServer instances. Held in a map (not just locally scoped
  // inside the request handler) so that GJS's SpiderMonkey GC cannot collect
  // them between requests — collecting an active McpServer pulls down the
  // GLib sources its underlying Soup connection still references, producing
  // `g_source_unref_internal: assertion 'old_ref > 0' failed` and a SIGSEGV
  // on the next request.
  const mcpServers = new Map<string, McpServer>();

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

    if (url.pathname !== '/mcp') {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found. MCP endpoint is at /mcp');
      return;
    }

    if (req.method === 'POST') {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;

      try {
        // Parse the body first — needed to check if this is an initialize request
        const body = await readRequestBody(req);

        if (sessionId && transports.has(sessionId)) {
          // Existing session — route to its transport
          const transport = transports.get(sessionId)!;
          await transport.handleRequest(req, res, body);
        } else if (!sessionId && isInitializeRequest(body)) {
          // New initialization — create transport + server for this session
          const mcpServer = createMcpServer();
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => crypto.randomUUID(),
            onsessioninitialized: (sid: string) => {
              transports.set(sid, transport);
              mcpServers.set(sid, mcpServer);
            },
          });

          transport.onclose = () => {
            const sid = transport.sessionId;
            if (sid) {
              transports.delete(sid);
              mcpServers.delete(sid);
            }
          };

          await mcpServer.connect(transport);
          await transport.handleRequest(req, res, body);
        } else if (sessionId) {
          // Unknown session ID
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32001, message: 'Session not found' },
            id: null,
          }));
        } else {
          // Non-initialize request without session ID
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Bad Request: Server not initialized' },
            id: null,
          }));
        }
      } catch (e) {
        console.error('Error handling POST:', e);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Internal server error');
        }
      }
    } else if (req.method === 'GET') {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      if (sessionId && transports.has(sessionId)) {
        await transports.get(sessionId)!.handleRequest(req, res);
      } else {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Missing or invalid session ID');
      }
    } else if (req.method === 'DELETE') {
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
  console.error('Fatal error:', error instanceof Error ? error.message : error);
  if (error instanceof Error && error.stack) console.error(error.stack);
  process.exit(1);
});
