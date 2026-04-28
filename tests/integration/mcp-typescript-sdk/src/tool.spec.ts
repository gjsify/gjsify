// SPDX-License-Identifier: MIT
// Ported from refs/mcp-typescript-sdk/test/integration/test/server/mcp.test.ts
// Original: Copyright (c) Anthropic, PBC. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { assertMatchObject, yieldEventLoop } from './helpers.js';

export default async () => {
  await describe('MCP tool()', async () => {

    await it('should register zero-argument tool', async () => {
      const mcpServer = new McpServer({ name: 'test server', version: '1.0' });
      const notifications: any[] = [];
      const client = new Client({ name: 'test client', version: '1.0' });
      client.fallbackNotificationHandler = async (notification: any) => {
        notifications.push(notification);
      };

      mcpServer.registerTool('test', {}, async () => ({
        content: [{ type: 'text', text: 'Test response' }],
      }));

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await Promise.all([client.connect(clientTransport), mcpServer.connect(serverTransport)]);

      const result = await client.listTools();
      expect(result.tools.length).toBe(1);
      expect(result.tools[0].name).toBe('test');

      // Tool registered before connection — no notification expected
      expect(notifications.length).toBe(0);

      // Adding another tool triggers the update notification
      mcpServer.registerTool('test2', {}, async () => ({
        content: [{ type: 'text', text: 'Test response' }],
      }));

      await yieldEventLoop();

      assertMatchObject(notifications, [
        { method: 'notifications/tools/list_changed' },
      ]);

      await client.close();
      await mcpServer.close();
    });

    await it('should register tool with params', async () => {
      const mcpServer = new McpServer({ name: 'test server', version: '1.0' });
      const client = new Client({ name: 'test client', version: '1.0' });

      mcpServer.registerTool('test', {
        inputSchema: z.object({
          name: z.string(),
          value: z.number(),
        }),
      }, async ({ name, value }) => ({
        content: [{ type: 'text', text: `${name}: ${value}` }],
      }));

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await Promise.all([client.connect(clientTransport), mcpServer.connect(serverTransport)]);

      const result = await client.listTools();
      const tool = result.tools[0];
      expect(tool.inputSchema.properties?.name).toBeDefined();
      expect(tool.inputSchema.properties?.value).toBeDefined();

      await client.close();
      await mcpServer.close();
    });

    await it('should register tool with description', async () => {
      const mcpServer = new McpServer({ name: 'test server', version: '1.0' });
      const client = new Client({ name: 'test client', version: '1.0' });

      mcpServer.registerTool('test', {
        description: 'Test description',
      }, async () => ({
        content: [{ type: 'text', text: 'Test' }],
      }));

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await Promise.all([client.connect(clientTransport), mcpServer.connect(serverTransport)]);

      const result = await client.listTools();
      expect(result.tools[0].description).toBe('Test description');

      await client.close();
      await mcpServer.close();
    });

    await it('should register tool with annotations', async () => {
      const mcpServer = new McpServer({ name: 'test server', version: '1.0' });
      const client = new Client({ name: 'test client', version: '1.0' });

      mcpServer.registerTool('test', {
        title: 'Test Tool',
        annotations: { readOnlyHint: true, openWorldHint: true },
      }, async () => ({
        content: [{ type: 'text', text: 'Test' }],
      }));

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await Promise.all([client.connect(clientTransport), mcpServer.connect(serverTransport)]);

      const result = await client.listTools();
      const tool = result.tools[0];
      expect(tool.annotations?.readOnlyHint).toBe(true);
      expect(tool.annotations?.openWorldHint).toBe(true);

      await client.close();
      await mcpServer.close();
    });

    await it('should call tool and return result', async () => {
      const mcpServer = new McpServer({ name: 'test server', version: '1.0' });
      const client = new Client({ name: 'test client', version: '1.0' });

      mcpServer.registerTool('greet', {
        inputSchema: z.object({ name: z.string() }),
      }, async ({ name }) => ({
        content: [{ type: 'text', text: `Hello, ${name}!` }],
      }));

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await Promise.all([client.connect(clientTransport), mcpServer.connect(serverTransport)]);

      const result = await client.callTool({ name: 'greet', arguments: { name: 'World' } });
      expect((result.content as any)[0].text).toBe('Hello, World!');

      await client.close();
      await mcpServer.close();
    });

    await it('should validate tool args', async () => {
      const mcpServer = new McpServer({ name: 'test server', version: '1.0' });
      const client = new Client({ name: 'test client', version: '1.0' });

      mcpServer.registerTool('test', {
        inputSchema: z.object({ name: z.string() }),
      }, async ({ name }) => ({
        content: [{ type: 'text', text: name }],
      }));

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await Promise.all([client.connect(clientTransport), mcpServer.connect(serverTransport)]);

      // Pass wrong type — should return isError
      const result = await client.callTool({ name: 'test', arguments: { name: 123 } });
      expect(result.isError).toBe(true);

      await client.close();
      await mcpServer.close();
    });

    await it('should update existing tool', async () => {
      const mcpServer = new McpServer({ name: 'test server', version: '1.0' });
      const client = new Client({ name: 'test client', version: '1.0' });

      const tool = mcpServer.registerTool('test', {}, async () => ({
        content: [{ type: 'text', text: 'Initial response' }],
      }));

      tool.update({
        callback: async () => ({
          content: [{ type: 'text', text: 'Updated response' }],
        }),
      });

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await Promise.all([client.connect(clientTransport), mcpServer.connect(serverTransport)]);

      const result = await client.callTool({ name: 'test' });
      expect((result.content as any)[0].text).toBe('Updated response');

      await client.close();
      await mcpServer.close();
    });

    await it('should send tool list changed notifications when connected', async () => {
      const mcpServer = new McpServer({ name: 'test server', version: '1.0' });
      const notifications: any[] = [];
      const client = new Client({ name: 'test client', version: '1.0' });
      client.fallbackNotificationHandler = async (notification: any) => {
        notifications.push(notification);
      };

      // Register one tool before connecting to set up capabilities
      mcpServer.registerTool('initial', {}, async () => ({
        content: [{ type: 'text', text: 'Initial' }],
      }));

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await Promise.all([client.connect(clientTransport), mcpServer.connect(serverTransport)]);

      // Register tool after connection — should trigger notification
      mcpServer.registerTool('test', {}, async () => ({
        content: [{ type: 'text', text: 'Test' }],
      }));

      await yieldEventLoop();
      expect(notifications.length).toBe(1);
      assertMatchObject(notifications[0], { method: 'notifications/tools/list_changed' });

      // Register another tool — triggers another notification
      mcpServer.registerTool('test2', {}, async () => ({
        content: [{ type: 'text', text: 'Test2' }],
      }));

      await yieldEventLoop();
      expect(notifications.length).toBe(2);

      await client.close();
      await mcpServer.close();
    });

    await it('should default tools.listChanged to true', async () => {
      const mcpServer = new McpServer({ name: 'test server', version: '1.0' });
      const client = new Client({ name: 'test client', version: '1.0' });

      mcpServer.registerTool('test', {}, async () => ({
        content: [{ type: 'text', text: 'Test' }],
      }));

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await Promise.all([client.connect(clientTransport), mcpServer.connect(serverTransport)]);

      const capabilities = client.getServerCapabilities();
      expect(capabilities?.tools?.listChanged).toBe(true);

      await client.close();
      await mcpServer.close();
    });

    await it('should prevent duplicate tool registration', async () => {
      const mcpServer = new McpServer({ name: 'test server', version: '1.0' });

      mcpServer.registerTool('test', {}, async () => ({
        content: [{ type: 'text', text: 'Test' }],
      }));

      let threw = false;
      try {
        mcpServer.registerTool('test', {}, async () => ({
          content: [{ type: 'text', text: 'Duplicate' }],
        }));
      } catch (e) {
        threw = true;
        expect((e as Error).message).toMatch(/already registered/);
      }
      expect(threw).toBe(true);
    });

    await it('should remove tool and send notification', async () => {
      const mcpServer = new McpServer({ name: 'test server', version: '1.0' });
      const notifications: any[] = [];
      const client = new Client({ name: 'test client', version: '1.0' });
      client.fallbackNotificationHandler = async (notification: any) => {
        notifications.push(notification);
      };

      const tool = mcpServer.registerTool('test', {}, async () => ({
        content: [{ type: 'text', text: 'Test' }],
      }));

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await Promise.all([client.connect(clientTransport), mcpServer.connect(serverTransport)]);

      tool.remove();

      await yieldEventLoop();

      expect(notifications.length).toBe(1);
      assertMatchObject(notifications[0], { method: 'notifications/tools/list_changed' });

      // Verify tool is gone from the list
      const result = await client.listTools();
      expect(result.tools.length).toBe(0);

      await client.close();
      await mcpServer.close();
    });

  });
};
