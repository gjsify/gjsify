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
  await describe('MCP prompt()', async () => {

    await it('should register zero-argument prompt', async () => {
      const mcpServer = new McpServer({ name: 'test server', version: '1.0' });
      const client = new Client({ name: 'test client', version: '1.0' });

      mcpServer.registerPrompt('greeting', {}, async () => ({
        messages: [
          { role: 'assistant', content: { type: 'text', text: 'Hello! How can I help you?' } },
        ],
      }));

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await Promise.all([client.connect(clientTransport), mcpServer.connect(serverTransport)]);

      const result = await client.listPrompts();
      expect(result.prompts.length).toBe(1);
      expect(result.prompts[0].name).toBe('greeting');

      await client.close();
      await mcpServer.close();
    });

    await it('should register prompt with argsSchema', async () => {
      const mcpServer = new McpServer({ name: 'test server', version: '1.0' });
      const client = new Client({ name: 'test client', version: '1.0' });

      mcpServer.registerPrompt('greet', {
        argsSchema: { name: z.string() },
      }, async ({ name }) => ({
        messages: [
          { role: 'assistant', content: { type: 'text', text: `Hello, ${name}!` } },
        ],
      }));

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await Promise.all([client.connect(clientTransport), mcpServer.connect(serverTransport)]);

      const result = await client.listPrompts();
      const prompt = result.prompts[0];
      expect(prompt.name).toBe('greet');
      expect(prompt.arguments).toBeDefined();

      await client.close();
      await mcpServer.close();
    });

    await it('should get prompt with arguments', async () => {
      const mcpServer = new McpServer({ name: 'test server', version: '1.0' });
      const client = new Client({ name: 'test client', version: '1.0' });

      mcpServer.registerPrompt('greet', {
        argsSchema: { name: z.string() },
      }, async ({ name }) => ({
        messages: [
          { role: 'assistant', content: { type: 'text', text: `Hello, ${name}!` } },
        ],
      }));

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await Promise.all([client.connect(clientTransport), mcpServer.connect(serverTransport)]);

      const result = await client.getPrompt({ name: 'greet', arguments: { name: 'World' } });
      expect(result.messages.length).toBe(1);
      expect(result.messages[0].content.type).toBe('text');
      expect((result.messages[0].content as any).text).toBe('Hello, World!');

      await client.close();
      await mcpServer.close();
    });

    await it('should register prompt with description', async () => {
      const mcpServer = new McpServer({ name: 'test server', version: '1.0' });
      const client = new Client({ name: 'test client', version: '1.0' });

      mcpServer.registerPrompt('test', {
        description: 'A test prompt',
      }, async () => ({
        messages: [
          { role: 'assistant', content: { type: 'text', text: 'Test' } },
        ],
      }));

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await Promise.all([client.connect(clientTransport), mcpServer.connect(serverTransport)]);

      const result = await client.listPrompts();
      expect(result.prompts[0].description).toBe('A test prompt');

      await client.close();
      await mcpServer.close();
    });

    await it('should send prompt list changed notification', async () => {
      const mcpServer = new McpServer({ name: 'test server', version: '1.0' });
      const notifications: any[] = [];
      const client = new Client({ name: 'test client', version: '1.0' });
      client.fallbackNotificationHandler = async (notification: any) => {
        notifications.push(notification);
      };

      // Register one prompt before connecting to set up capabilities
      mcpServer.registerPrompt('initial', {}, async () => ({
        messages: [
          { role: 'assistant', content: { type: 'text', text: 'Initial' } },
        ],
      }));

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await Promise.all([client.connect(clientTransport), mcpServer.connect(serverTransport)]);

      // Register another prompt after connection — should trigger notification
      mcpServer.registerPrompt('test', {}, async () => ({
        messages: [
          { role: 'assistant', content: { type: 'text', text: 'Test' } },
        ],
      }));

      await yieldEventLoop();

      expect(notifications.length).toBe(1);
      assertMatchObject(notifications[0], { method: 'notifications/prompts/list_changed' });

      await client.close();
      await mcpServer.close();
    });

    await it('should prevent duplicate prompt registration', async () => {
      const mcpServer = new McpServer({ name: 'test server', version: '1.0' });

      mcpServer.registerPrompt('test', {}, async () => ({
        messages: [
          { role: 'assistant', content: { type: 'text', text: 'Test' } },
        ],
      }));

      let threw = false;
      try {
        mcpServer.registerPrompt('test', {}, async () => ({
          messages: [
            { role: 'assistant', content: { type: 'text', text: 'Duplicate' } },
          ],
        }));
      } catch (e) {
        threw = true;
        expect((e as Error).message).toMatch(/already registered/);
      }
      expect(threw).toBe(true);
    });

    await it('should default prompts.listChanged to true', async () => {
      const mcpServer = new McpServer({ name: 'test server', version: '1.0' });
      const client = new Client({ name: 'test client', version: '1.0' });

      mcpServer.registerPrompt('test', {}, async () => ({
        messages: [
          { role: 'assistant', content: { type: 'text', text: 'Test' } },
        ],
      }));

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await Promise.all([client.connect(clientTransport), mcpServer.connect(serverTransport)]);

      const capabilities = client.getServerCapabilities();
      expect(capabilities?.prompts?.listChanged).toBe(true);

      await client.close();
      await mcpServer.close();
    });

  });
};
