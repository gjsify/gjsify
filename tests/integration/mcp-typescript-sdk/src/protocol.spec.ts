// SPDX-License-Identifier: MIT
// Ported from refs/mcp-typescript-sdk/test/integration/test/server/mcp.test.ts
// Original: Copyright (c) Anthropic, PBC. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { assertMatchObject } from './helpers.js';

export default async () => {
  await describe('MCP Protocol', async () => {

    await describe('McpServer basics', async () => {

      await it('should expose underlying Server instance', async () => {
        const mcpServer = new McpServer({
          name: 'test server',
          version: '1.0',
        });
        expect(mcpServer.server).toBeDefined();
      });

      await it('should connect client and server via InMemoryTransport', async () => {
        const mcpServer = new McpServer({
          name: 'test server',
          version: '1.0',
        });
        const client = new Client({
          name: 'test client',
          version: '1.0',
        });

        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        await Promise.all([
          client.connect(clientTransport),
          mcpServer.connect(serverTransport),
        ]);

        const capabilities = client.getServerCapabilities();
        expect(capabilities).toBeDefined();

        await client.close();
        await mcpServer.close();
      });

    });

    await describe('Notifications', async () => {

      await it('should allow sending notifications via Server', async () => {
        const mcpServer = new McpServer(
          { name: 'test server', version: '1.0' },
          { capabilities: { logging: {} } },
        );

        const notifications: any[] = [];
        const client = new Client({ name: 'test client', version: '1.0' });
        client.fallbackNotificationHandler = async (notification: any) => {
          notifications.push(notification);
        };

        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        await Promise.all([
          client.connect(clientTransport),
          mcpServer.server.connect(serverTransport),
        ]);

        await mcpServer.server.sendLoggingMessage({
          level: 'info',
          data: 'Test log message',
        });

        assertMatchObject(notifications, [
          {
            method: 'notifications/message',
            params: {
              level: 'info',
              data: 'Test log message',
            },
          },
        ]);

        await client.close();
        await mcpServer.close();
      });

    });

    await describe('Extensions', async () => {

      await it('should register and advertise server extensions capability', async () => {
        const mcpServer = new McpServer({
          name: 'test server',
          version: '1.0',
        });
        const client = new Client({
          name: 'test client',
          version: '1.0',
        });

        mcpServer.server.registerCapabilities({
          extensions: {
            'io.modelcontextprotocol/test-extension': { listChanged: true },
          },
        });

        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        await Promise.all([
          client.connect(clientTransport),
          mcpServer.connect(serverTransport),
        ]);

        const capabilities = client.getServerCapabilities();
        expect(capabilities?.extensions).toBeDefined();
        const ext = (capabilities?.extensions as any)?.['io.modelcontextprotocol/test-extension'];
        expect(ext).toBeDefined();
        expect(ext.listChanged).toBe(true);

        await client.close();
        await mcpServer.close();
      });

      await it('should advertise client extensions capability to server', async () => {
        const mcpServer = new McpServer({
          name: 'test server',
          version: '1.0',
        });
        const client = new Client(
          { name: 'test client', version: '1.0' },
          {
            capabilities: {
              extensions: {
                'io.modelcontextprotocol/test-extension': { streaming: true },
              },
            },
          },
        );

        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        await Promise.all([
          client.connect(clientTransport),
          mcpServer.connect(serverTransport),
        ]);

        const capabilities = mcpServer.server.getClientCapabilities();
        expect(capabilities?.extensions).toBeDefined();
        const ext = (capabilities?.extensions as any)?.['io.modelcontextprotocol/test-extension'];
        expect(ext).toBeDefined();
        expect(ext.streaming).toBe(true);

        await client.close();
        await mcpServer.close();
      });

    });

  });
};
