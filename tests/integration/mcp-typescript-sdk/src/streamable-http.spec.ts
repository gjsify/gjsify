// SPDX-License-Identifier: MIT
// Ported from refs/mcp-typescript-sdk/test/integration/test/stateManagementStreamableHttp.test.ts
// Original: Copyright (c) Anthropic, PBC. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.
//
// Streamable HTTP transport end-to-end tests.
// Tests @gjsify/http Server + @gjsify/fetch client + @gjsify/streams ReadableStream + SSE.

import { describe, it, expect } from '@gjsify/unit';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

function listenOnRandomPort(server: Server): Promise<URL> {
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Could not get server address'));
        return;
      }
      resolve(new URL(`http://127.0.0.1:${addr.port}/mcp`));
    });
    server.on('error', reject);
  });
}

async function setupServer() {
  const httpServer = createServer();
  const mcpServer = new McpServer(
    { name: 'test-http-server', version: '1.0.0' },
  );

  mcpServer.registerTool('greet', {
    description: 'A greeting tool',
    inputSchema: z.object({
      name: z.string().describe('Name to greet'),
    }),
  }, async ({ name }) => ({
    content: [{ type: 'text', text: `Hello, ${name}!` }],
  }));

  mcpServer.registerResource('test', 'test://localhost/info', {},
    async () => ({
      contents: [{ uri: 'test://localhost/info', text: 'HTTP transport works!' }],
    }),
  );

  const serverTransport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
  });

  await mcpServer.connect(serverTransport);

  httpServer.on('request', async (req, res) => {
    await serverTransport.handleRequest(req, res);
  });

  const baseUrl = await listenOnRandomPort(httpServer);
  return { httpServer, mcpServer, serverTransport, baseUrl };
}

export default async () => {
  await describe('MCP Streamable HTTP Transport', async () => {

    await it('should connect client to HTTP server and list tools', async () => {
      const { httpServer, mcpServer, serverTransport, baseUrl } = await setupServer();

      try {
        const client = new Client({ name: 'test-client', version: '1.0.0' });
        const clientTransport = new StreamableHTTPClientTransport(baseUrl);
        await client.connect(clientTransport);

        const { tools } = await client.listTools();
        expect(tools.length).toBe(1);
        expect(tools[0].name).toBe('greet');

        await client.close();
      } finally {
        await mcpServer.close().catch(() => {});
        await serverTransport.close().catch(() => {});
        httpServer.close();
      }
    });

    await it('should call tool over HTTP', async () => {
      const { httpServer, mcpServer, serverTransport, baseUrl } = await setupServer();

      try {
        const client = new Client({ name: 'test-client', version: '1.0.0' });
        const clientTransport = new StreamableHTTPClientTransport(baseUrl);
        await client.connect(clientTransport);

        const result = await client.callTool({ name: 'greet', arguments: { name: 'HTTP' } });
        expect((result.content as any)[0].text).toBe('Hello, HTTP!');

        await client.close();
      } finally {
        await mcpServer.close().catch(() => {});
        await serverTransport.close().catch(() => {});
        httpServer.close();
      }
    });

    await it('should read resource over HTTP', async () => {
      const { httpServer, mcpServer, serverTransport, baseUrl } = await setupServer();

      try {
        const client = new Client({ name: 'test-client', version: '1.0.0' });
        const clientTransport = new StreamableHTTPClientTransport(baseUrl);
        await client.connect(clientTransport);

        const result = await client.readResource({ uri: 'test://localhost/info' });
        expect((result.contents[0] as any).text).toBe('HTTP transport works!');

        await client.close();
      } finally {
        await mcpServer.close().catch(() => {});
        await serverTransport.close().catch(() => {});
        httpServer.close();
      }
    });

    await it('should assign session ID with session management', async () => {
      const { httpServer, mcpServer, serverTransport, baseUrl } = await setupServer();

      try {
        const client = new Client({ name: 'session-client', version: '1.0.0' });
        const clientTransport = new StreamableHTTPClientTransport(baseUrl);
        await client.connect(clientTransport);

        // Session ID should be assigned
        expect(clientTransport.sessionId).toBeDefined();
        expect(typeof clientTransport.sessionId).toBe('string');

        await client.close();
      } finally {
        await mcpServer.close().catch(() => {});
        await serverTransport.close().catch(() => {});
        httpServer.close();
      }
    });

    // Regression: server must survive after the first tool call. Previously a
    // SIGSEGV occurred after the first response because (a) Soup's HTTP1 IO layer
    // auto-pauses between chunks without re-unpause, and (b) GJS's GC could free
    // the Soup.ServerMessage while Soup was still using it.
    await it('should handle multiple sequential tool calls without crashing', async () => {
      const { httpServer, mcpServer, serverTransport, baseUrl } = await setupServer();

      try {
        const client = new Client({ name: 'test-client', version: '1.0.0' });
        const clientTransport = new StreamableHTTPClientTransport(baseUrl);
        await client.connect(clientTransport);

        for (let i = 1; i <= 3; i++) {
          const result = await client.callTool({ name: 'greet', arguments: { name: `Call${i}` } });
          expect((result.content as any)[0].text).toBe(`Hello, Call${i}!`);
        }

        await client.close();
      } finally {
        await mcpServer.close().catch(() => {});
        await serverTransport.close().catch(() => {});
        httpServer.close();
      }
    });

    // Mirrors examples/node/net-mcp-server: one transport per session, dispatched
    // by mcp-session-id header. Reproduces the inspector-style usage pattern that
    // crashes the standalone server.
    await it('should serve multiple sessions with per-session transports (real-world pattern)', async () => {
      const httpServer = createServer();
      const transports = new Map<string, StreamableHTTPServerTransport>();
      const mcpServers = new Set<McpServer>();

      const buildServer = () => {
        const m = new McpServer({ name: 'multi-session-server', version: '1.0.0' });
        m.registerTool('greet', {
          description: 'A greeting tool',
          inputSchema: z.object({ name: z.string() }),
        }, async ({ name }) => ({
          content: [{ type: 'text', text: `Hello, ${name}!` }],
        }));
        mcpServers.add(m);
        return m;
      };

      httpServer.on('request', async (req, res) => {
        try {
          const sessionId = req.headers['mcp-session-id'] as string | undefined;
          if (sessionId && transports.has(sessionId)) {
            await transports.get(sessionId)!.handleRequest(req, res);
            return;
          }
          // New session — initialize-style request
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => crypto.randomUUID(),
            onsessioninitialized: (sid: string) => { transports.set(sid, transport); },
          });
          transport.onclose = () => {
            if (transport.sessionId) transports.delete(transport.sessionId);
          };
          const m = buildServer();
          await m.connect(transport);
          await transport.handleRequest(req, res);
        } catch (e) {
          console.error('[test] request handler error:', e);
          if (!res.headersSent) { res.writeHead(500); res.end('error'); }
        }
      });

      const baseUrl = await listenOnRandomPort(httpServer);
      try {
        for (let i = 1; i <= 3; i++) {
          const client = new Client({ name: `client-${i}`, version: '1.0.0' });
          const clientTransport = new StreamableHTTPClientTransport(baseUrl);
          await client.connect(clientTransport);

          const result = await client.callTool({ name: 'greet', arguments: { name: `Sess${i}` } });
          expect((result.content as any)[0].text).toBe(`Hello, Sess${i}!`);

          await client.close();
        }
      } finally {
        for (const t of transports.values()) await t.close().catch(() => {});
        for (const m of mcpServers) await m.close().catch(() => {});
        httpServer.close();
      }
    });

    // Pure HTTP-layer regression — no MCP, no Hono. Drives the server with raw
    // fetch() to isolate whether the multi-connection bug is in @gjsify/http or
    // in higher layers.
    await it('should accept many sequential raw HTTP connections without hanging', async () => {
      const httpServer = createServer((req, res) => {
        let body = '';
        req.on('data', (chunk: any) => { body += String(chunk); });
        req.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, echoed: body, url: req.url }));
        });
      });
      const baseUrl = await listenOnRandomPort(httpServer);

      try {
        for (let i = 1; i <= 5; i++) {
          const r = await fetch(baseUrl.toString(), {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: `req-${i}`,
          });
          expect(r.status).toBe(200);
          const json = await r.json() as any;
          expect(json.ok).toBe(true);
          expect(json.echoed).toBe(`req-${i}`);
        }
      } finally {
        httpServer.close();
      }
    });

    // GC-stress test for the use-after-free guard. Forces SpiderMonkey to GC
    // between every tool call — exposes any GObject reference that depends on
    // JS-side reachability of ServerResponse/IncomingMessage. Reproduces the
    // long-running inspector scenario where GC runs while connections cycle.
    await it('should survive forced GC between tool calls', async () => {
      const { httpServer, mcpServer, serverTransport, baseUrl } = await setupServer();

      // imports.system.gc() exists only on GJS — Node.js test silently skips
      // the gc step but still exercises the call sequence.
      const sysGc: (() => void) | undefined = ((): (() => void) | undefined => {
        try {
          const sys = (globalThis as any).imports?.system;
          return typeof sys?.gc === 'function' ? () => sys.gc() : undefined;
        } catch { return undefined; }
      })();

      try {
        const client = new Client({ name: 'gc-client', version: '1.0.0' });
        const clientTransport = new StreamableHTTPClientTransport(baseUrl);
        await client.connect(clientTransport);

        for (let i = 1; i <= 5; i++) {
          if (sysGc) sysGc();
          const r = await client.callTool({ name: 'greet', arguments: { name: `GC${i}` } });
          expect((r.content as any)[0].text).toBe(`Hello, GC${i}!`);
          if (sysGc) sysGc();
        }

        await client.close();
      } finally {
        await mcpServer.close().catch(() => {});
        await serverTransport.close().catch(() => {});
        httpServer.close();
      }
    });

    // Inspector-style: full multi-session lifecycle with notifications, list
    // operations, and explicit DELETE cleanup interleaved across sessions.
    // Reproduces the standalone-server pattern used in
    // examples/node/net-mcp-server with realistic load shape.
    await it('should sustain inspector-like mixed workload across sessions', async () => {
      const httpServer = createServer();
      const transports = new Map<string, StreamableHTTPServerTransport>();
      const mcpServers = new Set<McpServer>();

      const buildMcpServer = () => {
        const m = new McpServer({ name: 'inspector-server', version: '1.0.0' });
        m.registerTool('echo', {
          description: 'Echo a message',
          inputSchema: z.object({ message: z.string() }),
        }, async ({ message }) => ({
          content: [{ type: 'text', text: message }],
        }));
        m.registerResource('info', 'info://server/meta', {},
          async () => ({ contents: [{ uri: 'info://server/meta', text: 'inspector-server' }] }),
        );
        mcpServers.add(m);
        return m;
      };

      httpServer.on('request', async (req, res) => {
        try {
          const sessionId = req.headers['mcp-session-id'] as string | undefined;
          if (sessionId && transports.has(sessionId)) {
            await transports.get(sessionId)!.handleRequest(req, res);
            if (req.method === 'DELETE') transports.delete(sessionId);
            return;
          }
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => crypto.randomUUID(),
            onsessioninitialized: (sid: string) => { transports.set(sid, transport); },
          });
          transport.onclose = () => {
            if (transport.sessionId) transports.delete(transport.sessionId);
          };
          const m = buildMcpServer();
          await m.connect(transport);
          await transport.handleRequest(req, res);
        } catch (e) {
          console.error('[test] handler error:', e);
          if (!res.headersSent) { res.writeHead(500); res.end('error'); }
        }
      });

      const baseUrl = await listenOnRandomPort(httpServer);
      try {
        // Three sessions, each performing a list+call+call+close cycle —
        // the same shape the MCP inspector produces while a user clicks around.
        for (let s = 1; s <= 3; s++) {
          const client = new Client({ name: `inspector-${s}`, version: '1.0.0' });
          const clientTransport = new StreamableHTTPClientTransport(baseUrl);
          await client.connect(clientTransport);

          const { tools } = await client.listTools();
          expect(tools.length).toBe(1);

          const r1 = await client.callTool({ name: 'echo', arguments: { message: `s${s}-1` } });
          expect((r1.content as any)[0].text).toBe(`s${s}-1`);

          const r2 = await client.callTool({ name: 'echo', arguments: { message: `s${s}-2` } });
          expect((r2.content as any)[0].text).toBe(`s${s}-2`);

          const info = await client.readResource({ uri: 'info://server/meta' });
          expect((info.contents[0] as any).text).toBe('inspector-server');

          await client.close();
        }
      } finally {
        for (const t of transports.values()) await t.close().catch(() => {});
        for (const m of mcpServers) await m.close().catch(() => {});
        httpServer.close();
      }
    });

  });
};
