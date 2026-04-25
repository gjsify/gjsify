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

  });
};
