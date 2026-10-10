// @gjsify/mcp — stdio round-trip with a fake client, gate and result helpers. Runs on Node and GJS.

import { describe, expect, it } from '@gjsify/unit';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { PassThrough } from 'node:stream';
import { z } from 'zod';
import {
    applyGrantGate,
    applyReadOnlyGate,
    requiresCapability,
    mcpError,
    mcpErrorFrom,
    mcpSuccess,
    serveUntilClosed,
} from './index.js';

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
async function roundTrip(
    allowWrite: boolean,
    requests: object[],
    make: () => McpServer = () => makeServer(allowWrite),
) {
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
    const served = serveUntilClosed(make(), { label: 'test', stdin, stdout });
    for (const r of [INIT, { jsonrpc: '2.0', method: 'notifications/initialized' }, ...requests]) {
        stdin.write(JSON.stringify(r) + '\n');
    }
    await new Promise((r) => setTimeout(r, 100));
    stdin.end();
    await served; // resolves on EOF — hangs (test timeout) if EOF handling regresses
    return replies;
}

const LIST = { jsonrpc: '2.0', id: 2, method: 'tools/list' };
const call = (name: string, args: object, id = 3) => ({
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name, arguments: args },
});

/** Handlers record into `reached`, so a test can prove the handler did or did not run. */
function makeGrantServer(grants: { capability: string; target: string }[], reached: string[]): () => McpServer {
    return () => {
        const server = new McpServer({ name: 't', version: '0' });
        applyGrantGate(server, grants);
        server.registerTool('read', { annotations: { readOnlyHint: true } }, async () => mcpSuccess({ v: 1 }));
        server.registerTool('bare', {}, async () => {
            reached.push('bare');
            return mcpSuccess({});
        });
        server.registerTool('unhinted', { annotations: { readOnlyHint: false } }, async () => {
            reached.push('unhinted');
            return mcpSuccess({});
        });
        server.registerTool(
            'send',
            requiresCapability(
                { annotations: { readOnlyHint: false }, inputSchema: { to: z.string() } },
                { capability: 'x.send', targetOf: (a: { to: string }) => a.to },
            ),
            async (a: { to: string }) => {
                reached.push(`send:${a.to}`);
                return mcpSuccess({ sent: a.to });
            },
        );
        server.registerTool(
            'noschema',
            requiresCapability(
                { annotations: { readOnlyHint: false } },
                { capability: 'x.send', targetOf: (a: { to?: string }) => a?.to ?? '' },
            ),
            async () => {
                reached.push('noschema');
                return mcpSuccess({});
            },
        );
        server.registerTool(
            'throws',
            requiresCapability(
                { annotations: { readOnlyHint: false }, inputSchema: { to: z.string() } },
                {
                    capability: 'x.send',
                    targetOf: () => {
                        throw new Error('boom');
                    },
                },
            ),
            async () => {
                reached.push('throws');
                return mcpSuccess({});
            },
        );
        server.registerTool(
            'other',
            requiresCapability(
                { annotations: { readOnlyHint: false } },
                { capability: 'y.write', targetOf: () => 'a' },
            ),
            async () => {
                reached.push('other');
                return mcpSuccess({});
            },
        );
        return server;
    };
}

const names = (r: Map<number, { result: { tools: { name: string }[] } }>) =>
    r
        .get(2)!
        .result.tools.map((t) => t.name)
        .sort();

export default async () => {
    await describe('applyGrantGate', async () => {
        await it('registers read-only and granted capability tools, drops the rest', async () => {
            const r = await roundTrip(false, [LIST], makeGrantServer([{ capability: 'x.send', target: 'a' }], []));
            expect(names(r)).toStrictEqual(['noschema', 'read', 'send', 'throws']);
        });
        await it('with no grants only read-only tools register', async () => {
            const r = await roundTrip(false, [LIST], makeGrantServer([], []));
            expect(names(r)).toStrictEqual(['read']);
        });
        await it('a granted target reaches the handler', async () => {
            const reached: string[] = [];
            const r = await roundTrip(
                false,
                [call('send', { to: 'a' })],
                makeGrantServer([{ capability: 'x.send', target: 'a' }], reached),
            );
            expect(r.get(3).result.isError).toBeUndefined();
            expect(reached).toStrictEqual(['send:a']);
        });
        await it('a wrong target is refused with the capability named, handler not reached', async () => {
            const reached: string[] = [];
            const r = await roundTrip(
                false,
                [call('send', { to: 'b' })],
                makeGrantServer([{ capability: 'x.send', target: 'a' }], reached),
            );
            expect(r.get(3).result.isError).toBe(true);
            expect(r.get(3).result.content[0].text).toContain('x.send');
            expect(reached.length).toBe(0);
        });
        await it('matches exactly: no prefix, no case folding, no wildcard', async () => {
            const reached: string[] = [];
            const make = makeGrantServer(
                [
                    { capability: 'x.send', target: 'a' },
                    { capability: 'x.send', target: '*' },
                ],
                reached,
            );
            const r = await roundTrip(
                false,
                [call('send', { to: 'ab' }, 3), call('send', { to: 'A' }, 4), call('send', { to: 'anything' }, 5)],
                make,
            );
            for (const id of [3, 4, 5]) expect(r.get(id).result.isError).toBe(true);
            expect(reached.length).toBe(0);
        });
        await it('an empty target is refused even if derived', async () => {
            const reached: string[] = [];
            const r = await roundTrip(
                false,
                [call('send', { to: '' })],
                makeGrantServer([{ capability: 'x.send', target: 'a' }], reached),
            );
            expect(r.get(3).result.isError).toBe(true);
            expect(reached.length).toBe(0);
        });
        await it('a targetOf that throws, or a tool without input, is refused', async () => {
            const reached: string[] = [];
            const make = makeGrantServer([{ capability: 'x.send', target: 'a' }], reached);
            const r = await roundTrip(false, [call('throws', { to: 'a' }, 3), call('noschema', {}, 4)], make);
            expect(r.get(3).result.isError).toBe(true);
            expect(r.get(4).result.isError).toBe(true);
            expect(reached.length).toBe(0);
        });
        await it('unregistered tools cannot be called', async () => {
            const reached: string[] = [];
            const make = makeGrantServer([{ capability: 'x.send', target: 'a' }], reached);
            const r = await roundTrip(
                false,
                [call('bare', {}, 3), call('unhinted', {}, 4), call('other', {}, 5)],
                make,
            );
            for (const id of [3, 4, 5])
                expect(r.get(id).error !== undefined || r.get(id).result?.isError === true).toBe(true);
            expect(reached.length).toBe(0);
        });
        await it('read-only tools keep working', async () => {
            const r = await roundTrip(false, [call('read', {})], makeGrantServer([], []));
            expect(JSON.parse(r.get(3).result.content[0].text)).toStrictEqual({ v: 1 });
        });
        await it('a handler is only reachable through the check', async () => {
            // The registered handler is the wrapper, not the one passed in: calling the stored
            // handler directly with a bad target must refuse without running the original.
            const server = new McpServer({ name: 't', version: '0' });
            applyGrantGate(server, [{ capability: 'x.send', target: 'a' }]);
            let ran = false;
            server.registerTool(
                'send',
                requiresCapability(
                    { annotations: { readOnlyHint: false }, inputSchema: { to: z.string() } },
                    { capability: 'x.send', targetOf: (a: { to: string }) => a.to },
                ),
                async () => {
                    ran = true;
                    return mcpSuccess({});
                },
            );
            const registered = (
                server as unknown as {
                    _registeredTools: Record<string, { handler: (...a: unknown[]) => Promise<{ isError?: boolean }> }>;
                }
            )._registeredTools.send;
            const refused = await registered.handler({ to: 'b' }, {});
            expect(refused.isError).toBe(true);
            expect(ran).toBe(false);
            await registered.handler({ to: 'a' }, {});
            expect(ran).toBe(true);
        });
        await it('rejects an empty capability or target at apply time', async () => {
            const server = new McpServer({ name: 't', version: '0' });
            expect(() => applyGrantGate(server, [{ capability: 'x.send', target: '' }])).toThrow();
            expect(() => applyGrantGate(server, [{ capability: '', target: 'a' }])).toThrow();
        });
        await it('later edits to the grant array do not apply', async () => {
            const grants = [{ capability: 'x.send', target: 'a' }];
            const reached: string[] = [];
            const server = makeGrantServer(grants, reached)();
            grants.push({ capability: 'x.send', target: 'b' });
            const r = await roundTrip(false, [call('send', { to: 'b' })], () => server);
            expect(r.get(3).result.isError).toBe(true);
        });
    });
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
