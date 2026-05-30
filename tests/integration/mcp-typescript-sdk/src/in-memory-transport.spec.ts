// SPDX-License-Identifier: MIT
// Ported from refs/mcp-typescript-sdk/test/inMemory.test.ts (v1.29.0)
// Original: Copyright (c) Anthropic, PBC. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.
//
// Exercises the pure-JS in-memory transport (no subprocess, no network) — validates
// the JSON-RPC plumbing inside the SDK against @gjsify/buffer, @gjsify/process, and
// the structured-clone path used to ship payloads between client and server halves.

import { describe, it, expect } from '@gjsify/unit';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

export default async () => {
    await describe('InMemoryTransport', async () => {
        await it('should create linked pair', async () => {
            const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
            expect(clientTransport).toBeDefined();
            expect(serverTransport).toBeDefined();
        });

        await it('should start without error', async () => {
            const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
            await clientTransport.start();
            await serverTransport.start();
            await clientTransport.close();
            await serverTransport.close();
        });

        await it('should send message from client to server', async () => {
            const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
            const message: JSONRPCMessage = {
                jsonrpc: '2.0',
                method: 'test',
                id: 1,
            };

            let receivedMessage: JSONRPCMessage | undefined;
            serverTransport.onmessage = (msg) => {
                receivedMessage = msg;
            };

            await clientTransport.send(message);
            expect(receivedMessage).toStrictEqual(message);

            await clientTransport.close();
        });

        await it('should send message with auth info from client to server', async () => {
            const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
            const message: JSONRPCMessage = {
                jsonrpc: '2.0',
                method: 'test',
                id: 1,
            };

            const authInfo = {
                token: 'test-token',
                clientId: 'test-client',
                scopes: ['read', 'write'],
                expiresAt: Date.now() / 1000 + 3600,
            };

            let receivedMessage: JSONRPCMessage | undefined;
            let receivedAuthInfo: unknown;
            serverTransport.onmessage = (msg, extra) => {
                receivedMessage = msg;
                receivedAuthInfo = (extra as { authInfo?: unknown } | undefined)?.authInfo;
            };

            await clientTransport.send(message, { authInfo });
            expect(receivedMessage).toStrictEqual(message);
            expect(receivedAuthInfo).toStrictEqual(authInfo);

            await clientTransport.close();
        });

        await it('should send message from server to client', async () => {
            const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
            const message: JSONRPCMessage = {
                jsonrpc: '2.0',
                method: 'test',
                id: 1,
            };

            let receivedMessage: JSONRPCMessage | undefined;
            clientTransport.onmessage = (msg) => {
                receivedMessage = msg;
            };

            await serverTransport.send(message);
            expect(receivedMessage).toStrictEqual(message);

            await clientTransport.close();
        });

        await it('should propagate close from one end to the other', async () => {
            const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
            let clientClosed = false;
            let serverClosed = false;

            clientTransport.onclose = () => {
                clientClosed = true;
            };
            serverTransport.onclose = () => {
                serverClosed = true;
            };

            await clientTransport.close();
            expect(clientClosed).toBe(true);
            expect(serverClosed).toBe(true);
        });

        await it('should throw when sending after close', async () => {
            const [clientTransport] = InMemoryTransport.createLinkedPair();
            await clientTransport.close();

            let err: unknown;
            try {
                await clientTransport.send({ jsonrpc: '2.0', method: 'test', id: 1 });
            } catch (e) {
                err = e;
            }
            expect(err).toBeDefined();
            expect(String((err as Error).message)).toContain('Not connected');
        });

        await it('should queue messages sent before start', async () => {
            const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
            const message: JSONRPCMessage = {
                jsonrpc: '2.0',
                method: 'test',
                id: 1,
            };

            let receivedMessage: JSONRPCMessage | undefined;
            serverTransport.onmessage = (msg) => {
                receivedMessage = msg;
            };

            // Send before the server side has explicitly started — must be queued
            // and delivered when start() flushes the buffered queue.
            await clientTransport.send(message);
            await serverTransport.start();
            expect(receivedMessage).toStrictEqual(message);

            await clientTransport.close();
        });

        await it('should round-trip a JSON-RPC error response', async () => {
            const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
            const errorResponse: JSONRPCMessage = {
                jsonrpc: '2.0',
                id: 42,
                error: {
                    code: -32601,
                    message: 'Method not found',
                },
            };

            let received: JSONRPCMessage | undefined;
            clientTransport.onmessage = (msg) => {
                received = msg;
            };

            await serverTransport.send(errorResponse);
            expect(received).toStrictEqual(errorResponse);

            await clientTransport.close();
        });

        await it('should round-trip a JSON-RPC notification (no id)', async () => {
            const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
            const notification: JSONRPCMessage = {
                jsonrpc: '2.0',
                method: 'notifications/progress',
                params: { progressToken: 1, progress: 50, total: 100 },
            };

            let received: JSONRPCMessage | undefined;
            serverTransport.onmessage = (msg) => {
                received = msg;
            };

            await clientTransport.send(notification);
            expect(received).toStrictEqual(notification);
            // Notifications have no `id`; verify the property never materialised.
            expect('id' in (received as Record<string, unknown>)).toBe(false);

            await clientTransport.close();
        });
    });
};
