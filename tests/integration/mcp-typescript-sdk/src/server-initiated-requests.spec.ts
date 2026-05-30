// SPDX-License-Identifier: MIT
// Inspired by refs/mcp-typescript-sdk/test/server/elicitation.test.ts (v1.29.0)
// and refs/mcp-typescript-sdk/test/server/index.test.ts.
// Original: Copyright (c) Anthropic, PBC. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.
//
// Server-initiated requests (sampling + elicitation) flow the *opposite*
// direction from client→server tool calls: the server calls a client method
// that the client implements via setRequestHandler. Exercises the full
// bidirectional protocol over InMemoryTransport, including capability
// negotiation, request schema parsing, and result routing.

import { describe, it, expect } from '@gjsify/unit';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CreateMessageRequestSchema, ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';

export default async () => {
    await describe('Server-initiated sampling (createMessage)', async () => {
        await it('should round-trip a createMessage request to a client sampling handler', async () => {
            const mcpServer = new McpServer({ name: 'test-server', version: '1.0' });
            const client = new Client(
                { name: 'test-client', version: '1.0' },
                { capabilities: { sampling: {} } },
            );

            let receivedParams: unknown;
            client.setRequestHandler(CreateMessageRequestSchema, async (request) => {
                receivedParams = request.params;
                return {
                    model: 'gjsify-test-model',
                    role: 'assistant',
                    content: { type: 'text', text: 'Test sampling response' },
                };
            });

            const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
            await Promise.all([client.connect(clientTransport), mcpServer.connect(serverTransport)]);

            const result = await mcpServer.server.createMessage({
                messages: [
                    {
                        role: 'user',
                        content: { type: 'text', text: 'Hello, can you respond?' },
                    },
                ],
                maxTokens: 100,
            });

            expect(result.model).toBe('gjsify-test-model');
            expect(result.role).toBe('assistant');
            expect((result.content as { type: string; text: string }).type).toBe('text');
            expect((result.content as { type: string; text: string }).text).toBe('Test sampling response');

            // Server's params arrived intact on the client side.
            const params = receivedParams as { messages: unknown[]; maxTokens: number };
            expect(params.maxTokens).toBe(100);
            expect(Array.isArray(params.messages)).toBe(true);
            expect(params.messages.length).toBe(1);

            await client.close();
            await mcpServer.close();
        });

        await it('should propagate handler errors back to the server caller', async () => {
            const mcpServer = new McpServer({ name: 'test-server', version: '1.0' });
            const client = new Client(
                { name: 'test-client', version: '1.0' },
                { capabilities: { sampling: {} } },
            );

            client.setRequestHandler(CreateMessageRequestSchema, async () => {
                throw new Error('sampling refused');
            });

            const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
            await Promise.all([client.connect(clientTransport), mcpServer.connect(serverTransport)]);

            let caught: unknown;
            try {
                await mcpServer.server.createMessage({
                    messages: [{ role: 'user', content: { type: 'text', text: 'hi' } }],
                    maxTokens: 10,
                });
            } catch (e) {
                caught = e;
            }
            expect(caught).toBeDefined();
            expect(String((caught as Error).message)).toContain('sampling refused');

            await client.close();
            await mcpServer.close();
        });
    });

    await describe('Server-initiated elicitation (elicitInput)', async () => {
        await it('should round-trip a form elicitation to a client handler', async () => {
            const mcpServer = new McpServer({ name: 'test-server', version: '1.0' });
            const client = new Client(
                { name: 'test-client', version: '1.0' },
                { capabilities: { elicitation: { form: {} } } },
            );

            client.setRequestHandler(ElicitRequestSchema, async (request) => {
                const params = request.params as { message: string; requestedSchema?: unknown };
                expect(params.message).toBe('What is your name?');
                return {
                    action: 'accept',
                    content: { name: 'Alice' },
                };
            });

            const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
            await Promise.all([client.connect(clientTransport), mcpServer.connect(serverTransport)]);

            const result = await mcpServer.server.elicitInput({
                message: 'What is your name?',
                requestedSchema: {
                    type: 'object',
                    properties: {
                        name: { type: 'string' },
                    },
                    required: ['name'],
                },
            });

            expect(result.action).toBe('accept');
            expect((result.content as { name?: string } | undefined)?.name).toBe('Alice');

            await client.close();
            await mcpServer.close();
        });

        await it('should accept a cancel action from the client', async () => {
            const mcpServer = new McpServer({ name: 'test-server', version: '1.0' });
            const client = new Client(
                { name: 'test-client', version: '1.0' },
                { capabilities: { elicitation: { form: {} } } },
            );

            client.setRequestHandler(ElicitRequestSchema, async () => ({
                action: 'cancel',
            }));

            const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
            await Promise.all([client.connect(clientTransport), mcpServer.connect(serverTransport)]);

            const result = await mcpServer.server.elicitInput({
                message: 'Confirm?',
                requestedSchema: { type: 'object', properties: {} },
            });

            expect(result.action).toBe('cancel');

            await client.close();
            await mcpServer.close();
        });
    });
};
