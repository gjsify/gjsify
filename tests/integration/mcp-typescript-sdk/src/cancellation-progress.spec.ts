// SPDX-License-Identifier: MIT
// Inspired by refs/mcp-typescript-sdk/test/shared/protocol.test.ts (v1.29.0)
// — `notifications/cancelled behavior`, `_meta preservation with onprogress`,
// `progress notification timeout behavior`.
// Original: Copyright (c) Anthropic, PBC. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.
//
// End-to-end cancellation and progress flow over InMemoryTransport. Exercises
// AbortSignal plumbing, progress-token routing through @gjsify/events
// (EventEmitter) and the timer subsystem (@gjsify/timers).

import { describe, it, expect } from '@gjsify/unit';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

export default async () => {
    await describe('Request cancellation via AbortSignal', async () => {
        await it('should abort the server-side request handler when the client signals abort', async () => {
            const mcpServer = new McpServer({ name: 'test-server', version: '1.0' });
            const client = new Client({ name: 'test-client', version: '1.0' });

            let serverObservedAbort = false;
            mcpServer.registerTool(
                'slow',
                {
                    description: 'Long-running tool',
                    inputSchema: z.object({}),
                },
                async (_args, extra) => {
                    // Wait up to 1s, but resolve early if aborted.
                    await new Promise<void>((resolve) => {
                        const timer = setTimeout(resolve, 1000);
                        extra.signal.addEventListener('abort', () => {
                            clearTimeout(timer);
                            resolve();
                        });
                    });
                    serverObservedAbort = extra.signal.aborted;
                    return { content: [{ type: 'text', text: 'done' }] };
                },
            );

            const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
            await Promise.all([client.connect(clientTransport), mcpServer.connect(serverTransport)]);

            const abort = new AbortController();
            const callPromise = client.callTool({ name: 'slow', arguments: {} }, undefined, { signal: abort.signal });
            // Give the request a moment to land on the server, then abort.
            await new Promise<void>((r) => setTimeout(r, 20));
            abort.abort();

            let caught: unknown;
            try {
                await callPromise;
            } catch (e) {
                caught = e;
            }
            expect(caught).toBeDefined();

            // The handler should have seen its signal flip — give the
            // cancellation notification a moment to flow back to the server.
            await new Promise<void>((r) => setTimeout(r, 100));
            expect(serverObservedAbort).toBe(true);

            await client.close();
            await mcpServer.close();
        });

        await it('should reject a pre-aborted request immediately', async () => {
            const mcpServer = new McpServer({ name: 'test-server', version: '1.0' });
            const client = new Client({ name: 'test-client', version: '1.0' });
            mcpServer.registerTool('echo', { inputSchema: z.object({}) }, async () => ({
                content: [{ type: 'text', text: 'ok' }],
            }));

            const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
            await Promise.all([client.connect(clientTransport), mcpServer.connect(serverTransport)]);

            const abort = new AbortController();
            abort.abort();

            let caught: unknown;
            try {
                await client.callTool({ name: 'echo', arguments: {} }, undefined, { signal: abort.signal });
            } catch (e) {
                caught = e;
            }
            expect(caught).toBeDefined();

            await client.close();
            await mcpServer.close();
        });
    });

    await describe('Progress notifications', async () => {
        await it('should deliver progress notifications to onprogress callback', async () => {
            const mcpServer = new McpServer({ name: 'test-server', version: '1.0' });
            const client = new Client({ name: 'test-client', version: '1.0' });

            mcpServer.registerTool('progressive', { inputSchema: z.object({}) }, async (_args, extra) => {
                // Emit a few progress notifications back to the caller via
                // the request-scoped helper. sendNotification routes the
                // payload back over the same transport with the right
                // request correlation.
                const progressToken = extra._meta?.progressToken;
                if (progressToken !== undefined) {
                    await extra.sendNotification({
                        method: 'notifications/progress',
                        params: {
                            progressToken,
                            progress: 50,
                            total: 100,
                        },
                    });
                    await extra.sendNotification({
                        method: 'notifications/progress',
                        params: {
                            progressToken,
                            progress: 100,
                            total: 100,
                        },
                    });
                }
                return { content: [{ type: 'text', text: 'finished' }] };
            });

            const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
            await Promise.all([client.connect(clientTransport), mcpServer.connect(serverTransport)]);

            const progressEvents: Array<{ progress: number; total?: number }> = [];
            const result = await client.callTool({ name: 'progressive', arguments: {} }, undefined, {
                onprogress: (event) => {
                    progressEvents.push(event);
                },
            });

            expect((result.content as Array<{ text: string }>)[0]!.text).toBe('finished');
            expect(progressEvents.length).toBeGreaterThanOrEqual(1);
            // Final event should report 100%.
            const last = progressEvents[progressEvents.length - 1]!;
            expect(last.progress).toBe(100);

            await client.close();
            await mcpServer.close();
        });

        await it('should reject a request that exceeds the timeout', async () => {
            const mcpServer = new McpServer({ name: 'test-server', version: '1.0' });
            const client = new Client({ name: 'test-client', version: '1.0' });

            mcpServer.registerTool('slow', { inputSchema: z.object({}) }, async () => {
                await new Promise<void>((r) => setTimeout(r, 500));
                return { content: [{ type: 'text', text: 'ok' }] };
            });

            const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
            await Promise.all([client.connect(clientTransport), mcpServer.connect(serverTransport)]);

            let caught: unknown;
            try {
                await client.callTool({ name: 'slow', arguments: {} }, undefined, { timeout: 50 });
            } catch (e) {
                caught = e;
            }
            expect(caught).toBeDefined();
            if (caught instanceof McpError) {
                expect(caught.code).toBe(ErrorCode.RequestTimeout);
            } else {
                // Fall back to message-text check if the SDK surfaces a wrapped error.
                expect(String((caught as Error).message).toLowerCase()).toContain('time');
            }

            await client.close();
            await mcpServer.close();
        });
    });
};
