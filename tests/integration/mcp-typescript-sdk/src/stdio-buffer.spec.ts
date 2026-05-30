// SPDX-License-Identifier: MIT
// Ported from refs/mcp-typescript-sdk/test/shared/stdio.test.ts (v1.29.0)
// Original: Copyright (c) Anthropic, PBC. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.
//
// Validates the SDK's ReadBuffer + line-framing serializer against @gjsify/buffer
// and @gjsify/string_decoder. ReadBuffer is the parser sitting between
// child_process stdout and the JSON-RPC dispatcher, so any Buffer slicing /
// indexOf bug in @gjsify will surface here as a missing or garbled message.

import { Buffer } from 'node:buffer';
import { describe, it, expect } from '@gjsify/unit';
import { ReadBuffer, deserializeMessage, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

export default async () => {
    await describe('ReadBuffer (stdio line framing)', async () => {
        const testMessage: JSONRPCMessage = {
            jsonrpc: '2.0',
            method: 'foobar',
        };

        await it('should have no messages after initialization', async () => {
            const readBuffer = new ReadBuffer();
            expect(readBuffer.readMessage()).toBeNull();
        });

        await it('should only yield a message after a newline', async () => {
            const readBuffer = new ReadBuffer();

            readBuffer.append(Buffer.from(JSON.stringify(testMessage)));
            expect(readBuffer.readMessage()).toBeNull();

            readBuffer.append(Buffer.from('\n'));
            expect(readBuffer.readMessage()).toStrictEqual(testMessage);
            expect(readBuffer.readMessage()).toBeNull();
        });

        await it('should be reusable after clearing', async () => {
            const readBuffer = new ReadBuffer();

            readBuffer.append(Buffer.from('foobar'));
            readBuffer.clear();
            expect(readBuffer.readMessage()).toBeNull();

            readBuffer.append(Buffer.from(JSON.stringify(testMessage)));
            readBuffer.append(Buffer.from('\n'));
            expect(readBuffer.readMessage()).toStrictEqual(testMessage);
        });

        await it('should yield multiple messages from one append', async () => {
            const readBuffer = new ReadBuffer();
            const a: JSONRPCMessage = { jsonrpc: '2.0', method: 'a', id: 1 };
            const b: JSONRPCMessage = { jsonrpc: '2.0', method: 'b', id: 2 };
            const combined = `${JSON.stringify(a)}\n${JSON.stringify(b)}\n`;

            readBuffer.append(Buffer.from(combined));
            expect(readBuffer.readMessage()).toStrictEqual(a);
            expect(readBuffer.readMessage()).toStrictEqual(b);
            expect(readBuffer.readMessage()).toBeNull();
        });

        await it('should handle messages split across multiple appends', async () => {
            const readBuffer = new ReadBuffer();
            const serialized = JSON.stringify(testMessage);
            // Split the serialized form at every byte; only the trailing '\n'
            // append should yield the parsed message.
            for (let i = 0; i < serialized.length; i++) {
                readBuffer.append(Buffer.from(serialized[i]!));
                expect(readBuffer.readMessage()).toBeNull();
            }
            readBuffer.append(Buffer.from('\n'));
            expect(readBuffer.readMessage()).toStrictEqual(testMessage);
        });

        await it('should preserve UTF-8 characters split across chunks', async () => {
            const readBuffer = new ReadBuffer();
            const message: JSONRPCMessage = {
                jsonrpc: '2.0',
                method: 'unicode',
                id: 1,
                params: { text: 'Grüße aus München — 你好 🚀' },
            };
            const serialized = JSON.stringify(message) + '\n';
            const bytes = Buffer.from(serialized, 'utf-8');

            // Chunk every 3 bytes — guaranteed to land mid-codepoint for the
            // multi-byte UTF-8 sequences. ReadBuffer must not corrupt them.
            for (let i = 0; i < bytes.length; i += 3) {
                readBuffer.append(bytes.subarray(i, Math.min(i + 3, bytes.length)));
            }
            expect(readBuffer.readMessage()).toStrictEqual(message);
        });
    });

    await describe('serializeMessage / deserializeMessage', async () => {
        await it('should round-trip a request through serialize+deserialize', async () => {
            const message: JSONRPCMessage = {
                jsonrpc: '2.0',
                method: 'tools/call',
                id: 7,
                params: { name: 'echo', arguments: { text: 'hi' } },
            };
            const serialized = serializeMessage(message);
            expect(serialized.endsWith('\n')).toBe(true);
            const parsed = deserializeMessage(serialized.slice(0, -1));
            expect(parsed).toStrictEqual(message);
        });

        await it('should throw on malformed JSON', async () => {
            let err: unknown;
            try {
                deserializeMessage('{not json');
            } catch (e) {
                err = e;
            }
            expect(err).toBeDefined();
        });
    });
};
