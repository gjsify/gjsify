// SPDX-License-Identifier: MIT
// Shared test helpers for MCP TypeScript SDK integration tests.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { expect } from '@gjsify/unit';

export { InMemoryTransport };

/**
 * Creates a connected McpServer + Client pair using InMemoryTransport.
 * Returns the pair and a cleanup function.
 */
export async function createClientServerPair(
  serverOptions?: { name?: string; version?: string; capabilities?: Record<string, any> },
  clientOptions?: { name?: string; version?: string; capabilities?: Record<string, any> },
) {
  const mcpServer = new McpServer(
    {
      name: serverOptions?.name ?? 'test server',
      version: serverOptions?.version ?? '1.0',
    },
    serverOptions?.capabilities ? { capabilities: serverOptions.capabilities } : undefined,
  );

  const client = new Client(
    {
      name: clientOptions?.name ?? 'test client',
      version: clientOptions?.version ?? '1.0',
    },
    clientOptions?.capabilities ? { capabilities: clientOptions.capabilities } : undefined,
  );

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([
    client.connect(clientTransport),
    mcpServer.connect(serverTransport),
  ]);

  const cleanup = async () => {
    await client.close();
    await mcpServer.close();
  };

  return { mcpServer, client, cleanup };
}

/**
 * Subset match — checks that all keys in `expected` are present in `actual`
 * with matching values (recursive for nested objects).
 * Replacement for vitest's `toMatchObject`.
 */
export function assertMatchObject(actual: any, expected: any, path = ''): void {
  if (expected === null || expected === undefined) {
    expect(actual).toBe(expected);
    return;
  }

  if (typeof expected !== 'object') {
    expect(actual).toBe(expected);
    return;
  }

  if (Array.isArray(expected)) {
    expect(Array.isArray(actual)).toBe(true);
    expect(actual.length).toBe(expected.length);
    for (let i = 0; i < expected.length; i++) {
      assertMatchObject(actual[i], expected[i], `${path}[${i}]`);
    }
    return;
  }

  for (const key of Object.keys(expected)) {
    const fullPath = path ? `${path}.${key}` : key;
    if (actual === null || actual === undefined || !(key in actual)) {
      throw new Error(`Expected key "${fullPath}" to exist in actual object`);
    }
    assertMatchObject(actual[key], expected[key], fullPath);
  }
}

/**
 * Yield the event loop to let notifications fly.
 * Replaces `await new Promise(process.nextTick)` from upstream tests.
 */
export function yieldEventLoop(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}
