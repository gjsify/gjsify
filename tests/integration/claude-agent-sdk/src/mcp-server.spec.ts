// SPDX-License-Identifier: MIT
// Tests for createSdkMcpServer() + tool() from @anthropic-ai/claude-agent-sdk.
//
// createSdkMcpServer() builds an in-process MCP server whose `.instance` is a
// real @modelcontextprotocol/sdk McpServer.  We connect it to a Client over an
// InMemoryTransport pair and drive a full tool round-trip.  This exercises a
// large slice of the runtime surface WITHOUT a Claude API key or the `claude`
// binary:
//   - zod v4 schema construction + JSON-Schema conversion + input validation
//   - the MCP JSON-RPC protocol (initialize, tools/list, tools/call)
//   - async generators / structured clone of the transport messages
//
// On GJS this stresses @gjsify's zod compatibility and the MCP SDK end-to-end.

import { describe, expect, it } from '@gjsify/unit';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { z } from 'zod';

/** Build a Client wired to the given SDK MCP server instance over an in-memory pair. */
async function connectClient(serverInstance: { connect(t: unknown): Promise<void> }): Promise<Client> {
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport as never), serverInstance.connect(serverTransport as never)]);
    return client;
}

export default async () => {
    await describe('createSdkMcpServer + tool', async () => {
        await describe('server construction', async () => {
            await it('returns an sdk-typed config with a live instance', async () => {
                const server = createSdkMcpServer({
                    name: 'calc',
                    version: '0.1.0',
                    tools: [],
                });
                expect(server.type).toBe('sdk');
                expect(server.name).toBe('calc');
                expect(server.instance).toBeDefined();
                expect(typeof server.instance.connect).toBe('function');
            });
        });

        await describe('tool definition', async () => {
            await it('tool() produces a well-formed definition', async () => {
                const add = tool('add', 'Add two numbers', { a: z.number(), b: z.number() }, async (args) => ({
                    content: [{ type: 'text', text: String(args.a + args.b) }],
                }));
                expect(add.name).toBe('add');
                expect(add.description).toBe('Add two numbers');
                expect(typeof add.handler).toBe('function');
                expect(add.inputSchema).toBeDefined();
            });
        });

        await describe('protocol round-trip via InMemoryTransport', async () => {
            await it('lists the registered tool', async () => {
                const add = tool('add', 'Add two numbers', { a: z.number(), b: z.number() }, async (args) => ({
                    content: [{ type: 'text', text: String(args.a + args.b) }],
                }));
                const server = createSdkMcpServer({ name: 'calc', version: '0.1.0', tools: [add] });
                const client = await connectClient(server.instance);
                try {
                    const { tools } = await client.listTools();
                    const names = tools.map((t) => t.name);
                    expect(names).toContain('add');

                    const addDef = tools.find((t) => t.name === 'add');
                    expect(addDef).toBeDefined();
                    expect(addDef!.description).toBe('Add two numbers');
                    // zod shape must have been converted to a JSON Schema object.
                    expect(addDef!.inputSchema).toBeDefined();
                    expect(addDef!.inputSchema.type).toBe('object');
                } finally {
                    await client.close();
                }
            });

            await it('calls the tool and returns the computed result', async () => {
                const add = tool('add', 'Add two numbers', { a: z.number(), b: z.number() }, async (args) => ({
                    content: [{ type: 'text', text: String(args.a + args.b) }],
                }));
                const server = createSdkMcpServer({ name: 'calc', version: '0.1.0', tools: [add] });
                const client = await connectClient(server.instance);
                try {
                    const result = await client.callTool({
                        name: 'add',
                        arguments: { a: 2, b: 40 },
                    });
                    const content = result.content as Array<{ type: string; text: string }>;
                    expect(Array.isArray(content)).toBe(true);
                    expect(content[0].type).toBe('text');
                    expect(content[0].text).toBe('42');
                } finally {
                    await client.close();
                }
            });

            await it('rejects a call with input that violates the zod schema', async () => {
                const add = tool('add', 'Add two numbers', { a: z.number(), b: z.number() }, async (args) => ({
                    content: [{ type: 'text', text: String(args.a + args.b) }],
                }));
                const server = createSdkMcpServer({ name: 'calc', version: '0.1.0', tools: [add] });
                const client = await connectClient(server.instance);
                try {
                    // `a` is a string where a number is required → MCP returns an error result
                    // (isError) or throws. Either way the handler must NOT succeed silently.
                    let failed = false;
                    try {
                        const result = await client.callTool({
                            name: 'add',
                            arguments: { a: 'not-a-number', b: 1 },
                        });
                        if (result.isError) failed = true;
                    } catch {
                        failed = true;
                    }
                    expect(failed).toBe(true);
                } finally {
                    await client.close();
                }
            });

            await it('supports multiple tools with distinct schemas', async () => {
                const add = tool('add', 'Add two numbers', { a: z.number(), b: z.number() }, async (args) => ({
                    content: [{ type: 'text', text: String(args.a + args.b) }],
                }));
                const greet = tool('greet', 'Greet a person', { name: z.string() }, async (args) => ({
                    content: [{ type: 'text', text: `Hello, ${args.name}!` }],
                }));
                const server = createSdkMcpServer({
                    name: 'multi',
                    version: '0.1.0',
                    tools: [add, greet],
                });
                const client = await connectClient(server.instance);
                try {
                    const { tools } = await client.listTools();
                    expect(tools.map((t) => t.name).sort()).toStrictEqual(['add', 'greet']);

                    const greetResult = await client.callTool({
                        name: 'greet',
                        arguments: { name: 'GNOME' },
                    });
                    const content = greetResult.content as Array<{ type: string; text: string }>;
                    expect(content[0].text).toBe('Hello, GNOME!');
                } finally {
                    await client.close();
                }
            });
        });
    });
};
