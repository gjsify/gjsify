// @gjsify/mcp — stdio round-trip with a fake client, gate and result helpers. Runs on Node and GJS.

import { describe, expect, it } from '@gjsify/unit';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { PassThrough } from 'node:stream';
import { applyReadOnlyGate, mcpError, mcpErrorFrom, mcpSuccess, serveUntilClosed } from './index.js';

const INIT = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'fake', version: '0' } },
};

function makeServer(allowWrite: boolean): McpServer {
    const server = new McpServer({ name: 't', version: '0' });
    applyReadOnlyGate(server, allowWrite);
    server.registerTool('read', { annotations: { readOnlyHint: true } }, async () => mcpSuccess({ v: 1 }));
    server.registerTool('write', { annotations: { readOnlyHint: false } }, async () => mcpSuccess({}));
    server.registerTool('bare', {}, async () => mcpSuccess({}));
    return server;
}

/** Fake client: send JSON lines, collect replies by id, then close stdin (EOF). */
async function roundTrip(allowWrite: boolean, requests: object[]) {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const replies = new Map<number, any>();
    let buf = '';
    stdout.on('data', (c: Buffer | string) => {
        buf += c.toString();
        let i: number;
        while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i);
            buf = buf.slice(i + 1);
            if (line.trim()) {
                const m = JSON.parse(line);
                if (m.id !== undefined) replies.set(m.id, m);
            }
        }
    });
    const served = serveUntilClosed(makeServer(allowWrite), { label: 'test', stdin, stdout });
    for (const r of [INIT, { jsonrpc: '2.0', method: 'notifications/initialized' }, ...requests]) {
        stdin.write(JSON.stringify(r) + '\n');
    }
    await new Promise((r) => setTimeout(r, 100));
    stdin.end();
    await served; // resolves on EOF — hangs (test timeout) if EOF handling regresses
    return replies;
}

export default async () => {
    await describe('serveUntilClosed', async () => {
        await it('answers requests over stdio and resolves on stdin EOF', async () => {
            const r = await roundTrip(false, [{ jsonrpc: '2.0', id: 2, method: 'tools/list' }]);
            expect(r.get(1).result.serverInfo.name).toBe('t');
            expect(r.get(2).result.tools.map((t: any) => t.name)).toStrictEqual(['read']);
        });
        await it('serves a tool call', async () => {
            const r = await roundTrip(false, [
                { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'read', arguments: {} } },
            ]);
            expect(JSON.parse(r.get(2).result.content[0].text)).toStrictEqual({ v: 1 });
        });
    });

    await describe('applyReadOnlyGate', async () => {
        await it('drops mutating AND unannotated tools by default', async () => {
            const r = await roundTrip(false, [{ jsonrpc: '2.0', id: 2, method: 'tools/list' }]);
            expect(r.get(2).result.tools.length).toBe(1);
        });
        await it('registers everything when writes are allowed', async () => {
            const r = await roundTrip(true, [{ jsonrpc: '2.0', id: 2, method: 'tools/list' }]);
            expect(r.get(2).result.tools.length).toBe(3);
        });
    });

    await describe('tool results', async () => {
        await it('mcpSuccess is pretty JSON, no isError', async () => {
            const r = mcpSuccess({ a: 1 });
            expect(r.content[0].text).toBe('{\n  "a": 1\n}');
            expect(r.isError).toBeUndefined();
        });
        await it('mcpError carries the message only', async () => {
            const r = mcpErrorFrom(new Error('boom'));
            expect(r.isError).toBe(true);
            expect(r.content[0].text).toBe(JSON.stringify({ error: 'boom' }));
            expect(mcpError('x').isError).toBe(true);
            expect(mcpErrorFrom('str').content[0].text).toBe('{"error":"str"}');
        });
    });
};
