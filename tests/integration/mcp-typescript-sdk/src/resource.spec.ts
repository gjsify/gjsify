// SPDX-License-Identifier: MIT
// Ported from refs/mcp-typescript-sdk/test/integration/test/server/mcp.test.ts
// Original: Copyright (c) Anthropic, PBC. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { assertMatchObject, yieldEventLoop } from './helpers.js';

export default async () => {
  await describe('MCP resource()', async () => {

    await it('should register resource with uri and readCallback', async () => {
      const mcpServer = new McpServer({ name: 'test server', version: '1.0' });
      const client = new Client({ name: 'test client', version: '1.0' });

      mcpServer.registerResource('test', 'test://resource', {},
        async () => ({ contents: [{ uri: 'test://resource', text: 'Test content' }] }),
      );

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await Promise.all([client.connect(clientTransport), mcpServer.connect(serverTransport)]);

      const result = await client.listResources();
      expect(result.resources.length).toBe(1);
      expect(result.resources[0].name).toBe('test');
      expect(result.resources[0].uri).toBe('test://resource');

      await client.close();
      await mcpServer.close();
    });

    await it('should read resource contents', async () => {
      const mcpServer = new McpServer({ name: 'test server', version: '1.0' });
      const client = new Client({ name: 'test client', version: '1.0' });

      // Use authority+path URI to avoid GJS URL normalization
      // (GJS normalizes test:///x → test:/x and test://x → test://x/)
      mcpServer.registerResource('test', 'test://localhost/resource', {},
        async () => ({ contents: [{ uri: 'test://localhost/resource', text: 'Hello from resource' }] }),
      );

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await Promise.all([client.connect(clientTransport), mcpServer.connect(serverTransport)]);

      const result = await client.readResource({ uri: 'test://localhost/resource' });
      expect(result.contents.length).toBe(1);
      expect((result.contents[0] as any).text).toBe('Hello from resource');

      await client.close();
      await mcpServer.close();
    });

    await it('should register resource with metadata', async () => {
      const mcpServer = new McpServer({ name: 'test server', version: '1.0' });
      const client = new Client({ name: 'test client', version: '1.0' });

      mcpServer.registerResource('test', 'test://resource', {
        description: 'A test resource',
        mimeType: 'text/plain',
      }, async () => ({ contents: [{ uri: 'test://resource', text: 'Test' }] }));

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await Promise.all([client.connect(clientTransport), mcpServer.connect(serverTransport)]);

      const result = await client.listResources();
      const resource = result.resources[0];
      expect(resource.description).toBe('A test resource');
      expect(resource.mimeType).toBe('text/plain');

      await client.close();
      await mcpServer.close();
    });

    await it('should register resource template', async () => {
      const mcpServer = new McpServer({ name: 'test server', version: '1.0' });
      const client = new Client({ name: 'test client', version: '1.0' });

      mcpServer.registerResource(
        'test-template',
        new ResourceTemplate('test://resource/{id}', { list: undefined }),
        {},
        async (uri: URL, { id }: { id: string }) => ({
          contents: [{ uri: uri.href, text: `Resource ${id}` }],
        }),
      );

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await Promise.all([client.connect(clientTransport), mcpServer.connect(serverTransport)]);

      const result = await client.listResourceTemplates();
      expect(result.resourceTemplates.length).toBe(1);
      expect(result.resourceTemplates[0].uriTemplate).toBe('test://resource/{id}');

      await client.close();
      await mcpServer.close();
    });

    await it('should read resource via template', async () => {
      const mcpServer = new McpServer({ name: 'test server', version: '1.0' });
      const client = new Client({ name: 'test client', version: '1.0' });

      mcpServer.registerResource(
        'test-template',
        new ResourceTemplate('test://resource/{id}', { list: undefined }),
        {},
        async (uri: URL, { id }: { id: string }) => ({
          contents: [{ uri: uri.href, text: `Content for ${id}` }],
        }),
      );

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await Promise.all([client.connect(clientTransport), mcpServer.connect(serverTransport)]);

      const result = await client.readResource({ uri: 'test://resource/42' });
      expect((result.contents[0] as any).text).toBe('Content for 42');

      await client.close();
      await mcpServer.close();
    });

    await it('should send resource list changed notification', async () => {
      const mcpServer = new McpServer({ name: 'test server', version: '1.0' });
      const notifications: any[] = [];
      const client = new Client({ name: 'test client', version: '1.0' });
      client.fallbackNotificationHandler = async (notification: any) => {
        notifications.push(notification);
      };

      // Register one resource before connecting to set up capabilities
      mcpServer.registerResource('initial', 'test://initial', {},
        async () => ({ contents: [{ uri: 'test://initial', text: 'Initial' }] }),
      );

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await Promise.all([client.connect(clientTransport), mcpServer.connect(serverTransport)]);

      // Register after connection — should trigger notification
      mcpServer.registerResource('test', 'test://resource', {},
        async () => ({ contents: [{ uri: 'test://resource', text: 'Test' }] }),
      );

      await yieldEventLoop();

      expect(notifications.length).toBe(1);
      assertMatchObject(notifications[0], { method: 'notifications/resources/list_changed' });

      await client.close();
      await mcpServer.close();
    });

    await it('should prevent duplicate resource registration', async () => {
      const mcpServer = new McpServer({ name: 'test server', version: '1.0' });

      mcpServer.registerResource('test', 'test://resource', {},
        async () => ({ contents: [{ uri: 'test://resource', text: 'Test' }] }),
      );

      let threw = false;
      try {
        mcpServer.registerResource('test', 'test://resource', {},
          async () => ({ contents: [{ uri: 'test://resource', text: 'Duplicate' }] }),
        );
      } catch (e) {
        threw = true;
        expect((e as Error).message).toMatch(/already registered/);
      }
      expect(threw).toBe(true);
    });

    await it('should default resources.listChanged to true', async () => {
      const mcpServer = new McpServer({ name: 'test server', version: '1.0' });
      const client = new Client({ name: 'test client', version: '1.0' });

      mcpServer.registerResource('test', 'test://resource', {},
        async () => ({ contents: [{ uri: 'test://resource', text: 'Test' }] }),
      );

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await Promise.all([client.connect(clientTransport), mcpServer.connect(serverTransport)]);

      const capabilities = client.getServerCapabilities();
      expect(capabilities?.resources?.listChanged).toBe(true);

      await client.close();
      await mcpServer.close();
    });

  });
};
