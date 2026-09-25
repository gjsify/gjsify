// oxlint-disable typescript/no-explicit-any -- ws-API-shape spec: the http 'upgrade' triple and ws's 'connection'/'close' payloads are typed `any` because that is what an npm `ws` consumer writes (same rationale as stream.spec.ts), and `globalThis.imports` is the GJS bootstrap object, which has no Node-side type.
// SPDX-License-Identifier: MIT
// Close-lifecycle regression spec for the server-side WebSocket — original.
//
// Regression: the socket.io suite printed libsoup-CRITICALs
// (`soup_websocket_connection_close: assertion '!priv->close_sent' failed`)
// because the Soup wrappers called close() on a connection Soup had already
// sent its Close frame on. A CRITICAL is a programming error and aborts the
// process under G_DEBUG=fatal-criticals, so on GJS every case here also counts
// libsoup log records and requires none. The same assertions run against the
// real npm `ws` on Node, which pins the semantics we mirror.

import { describe, it, expect } from '@gjsify/unit';
// isGJS, not `imports.gi`: node-gi injects that on Node too, where `ws` is still
// npm ws, so the libsoup markers and log watch must not apply there.
import { isGJS } from '@gjsify/runtime';
import { createServer } from 'node:http';
import { createServer as createNetServer, type Socket } from 'node:net';
import { createHash } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';

interface SoupLogWatch {
    count(): number;
    stop(): void;
}

/** Counts libsoup CRITICAL/WARNING records while active. Node has no libsoup,
 *  so there the count is trivially zero and only the ws semantics are checked. */
function watchSoupLog(): SoupLogWatch {
    const GLib = isGJS ? (globalThis as any).imports.gi.GLib : null;
    if (!GLib) return { count: () => 0, stop: () => {} };
    let records = 0;
    const levels = GLib.LogLevelFlags.LEVEL_CRITICAL | GLib.LogLevelFlags.LEVEL_WARNING;
    const id = GLib.log_set_handler('libsoup', levels, () => {
        records++;
    });
    return { count: () => records, stop: () => GLib.log_remove_handler('libsoup', id) };
}

/** Close codes ws sends that libsoup will not put on the wire from that role. */
const SOUP_UNSENDABLE = { client: [1011, 1012, 1013, 1014], server: [1010, 1012, 1013, 1014] };

type Mode = 'port' | 'noServer';

interface Pair {
    server: any;
    client: WebSocket;
    teardown(): void;
}

/** One connected client/server pair. `port` rides Soup.Server's own upgrade on
 *  GJS; `noServer` hands a net.Socket's stream to Soup — the two owners of the
 *  TCP connection differ, and terminate() has to reach both. */
async function connectPair(mode: Mode): Promise<Pair> {
    let wss: WebSocketServer;
    let http: ReturnType<typeof createServer> | null = null;
    const port = await new Promise<number>((resolve) => {
        if (mode === 'port') {
            wss = new WebSocketServer({ port: 0 });
            wss.on('listening', () => resolve((wss.address() as any).port));
        } else {
            wss = new WebSocketServer({ noServer: true });
            http = createServer();
            http.on('upgrade', (req: any, socket: any, head: any) => {
                wss.handleUpgrade(req, socket, head, (ws: any) => wss.emit('connection', ws, req));
            });
            http.listen(0, () => resolve((http!.address() as any).port));
        }
    });
    const client = new WebSocket(`ws://127.0.0.1:${port}/`);
    client.on('error', () => {});
    const server = await new Promise<any>((resolve) => wss.on('connection', (ws: any) => resolve(ws)));
    await new Promise<void>((resolve) => {
        if (client.readyState === WebSocket.OPEN) resolve();
        else client.once('open', () => resolve());
    });
    return {
        server,
        client,
        teardown() {
            wss.close();
            http?.close();
        },
    };
}

function closeEvents(ws: any): Promise<Array<{ code: number; reason: string }>> {
    const seen: Array<{ code: number; reason: string }> = [];
    return new Promise((resolve) => {
        ws.on('close', (code: number, reason: Buffer) => {
            seen.push({ code, reason: String(reason) });
            // A second 'close' would land within this window.
            setTimeout(() => resolve(seen), 50);
        });
    });
}

/** Runs one case on a fresh pair with the libsoup log watched, and always
 *  restores the default log handler and closes the servers — a failed
 *  expectation must not leave the handler counting in the next spec. */
async function withPair(mode: Mode, body: (pair: Pair, log: SoupLogWatch) => Promise<void>): Promise<void> {
    const log = watchSoupLog();
    let pair: Pair | null = null;
    try {
        pair = await connectPair(mode);
        await body(pair, log);
    } finally {
        log.stop();
        pair?.teardown();
    }
}

/** A server that speaks just enough RFC 6455 to open, send one Close frame
 *  with `code`, and read the client's answering Close. The peer must not be
 *  Soup: on GJS a Soup endpoint refuses to send 1012–1014 at all. */
async function rawClosingServer(
    code: number,
    reason: string,
): Promise<{ port: number; echoed: Promise<number | null>; close(): void }> {
    let resolveEcho!: (code: number | null) => void;
    const echoed = new Promise<number | null>((resolve) => (resolveEcho = resolve));
    const sockets: Socket[] = [];
    const server = createNetServer((socket: Socket) => {
        sockets.push(socket);
        let buf = Buffer.alloc(0);
        let upgraded = false;
        socket.on('data', (chunk: Buffer) => {
            buf = Buffer.concat([buf, chunk]);
            if (!upgraded) {
                const end = buf.indexOf('\r\n\r\n');
                if (end < 0) return;
                const key = /sec-websocket-key: *(\S+)/i.exec(buf.subarray(0, end).toString())?.[1] ?? '';
                buf = buf.subarray(end + 4);
                upgraded = true;
                const accept = createHash('sha1')
                    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
                    .digest('base64');
                socket.write(
                    'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
                        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
                );
                const payload = Buffer.concat([Buffer.from([code >> 8, code & 0xff]), Buffer.from(reason)]);
                socket.write(Buffer.concat([Buffer.from([0x88, payload.length]), payload]));
            }
            // The client's frame is masked: 2 header bytes, 4 mask bytes, payload.
            if (buf.length < 2 || (buf[0] & 0x0f) !== 0x08) return;
            const len = buf[1] & 0x7f;
            if (buf.length < 6 + len) return;
            const mask = buf.subarray(2, 6);
            const body = Buffer.from(buf.subarray(6, 6 + len).map((b, i) => b ^ mask[i % 4]));
            resolveEcho(len >= 2 ? body.readUInt16BE(0) : null);
            socket.end();
        });
        socket.on('error', () => {});
    });
    const port = await new Promise<number>((resolve) =>
        server.listen(0, '127.0.0.1', () => resolve((server.address() as any).port)),
    );
    return {
        port,
        echoed,
        close() {
            for (const s of sockets) s.destroy();
            server.close();
        },
    };
}

export default async () => {
    for (const mode of ['port', 'noServer'] as Mode[]) {
        await describe(`server-side WebSocket close lifecycle (${mode})`, async () => {
            await it('close() then terminate() closes once, without a second Close frame', async () => {
                await withPair(mode, async ({ server, client }, log) => {
                    const serverClosed = closeEvents(server);
                    const clientClosed = closeEvents(client);
                    server.close(4000, 'done');
                    server.terminate();
                    expect(server.readyState).toBe(WebSocket.CLOSING);
                    const seen = await serverClosed;
                    await clientClosed;
                    expect(seen.length).toBe(1);
                    expect(log.count()).toBe(0);
                });
            });

            await it('terminate() drops the connection without a Close frame (1006)', async () => {
                await withPair(mode, async ({ server, client }, log) => {
                    const serverClosed = closeEvents(server);
                    const clientClosed = closeEvents(client);
                    server.terminate();
                    const seen = await serverClosed;
                    const clientSeen = await clientClosed;
                    expect(seen.length).toBe(1);
                    expect(seen[0].code).toBe(1006);
                    expect(clientSeen[0].code).toBe(1006);
                    expect(log.count()).toBe(0);
                });
            });

            // Regression: the client's terminate() called the W3C close(1006),
            // which throws InvalidAccessError — swallowed, so the connection
            // stayed open until the server went away.
            await it('client terminate() drops the connection without a Close frame (1006)', async () => {
                await withPair(mode, async ({ server, client }, log) => {
                    const serverClosed = closeEvents(server);
                    const clientClosed = closeEvents(client);
                    client.terminate();
                    expect(client.readyState).toBe(WebSocket.CLOSING);
                    const clientSeen = await clientClosed;
                    const seen = await serverClosed;
                    expect(clientSeen.length).toBe(1);
                    expect(clientSeen[0].code).toBe(1006);
                    expect(seen.length).toBe(1);
                    expect(seen[0].code).toBe(1006);
                    expect(log.count()).toBe(0);
                });
            });

            // Regression: Soup's 'error' for a transport failure was re-emitted
            // as the socket's 'error' — ws never does that, and with no
            // listener it threw out of the GLib signal handler.
            await it("a peer's reset ends in 'close' (1006), never 'error'", async () => {
                await withPair(mode, async ({ server, client }, log) => {
                    const serverErrors: Error[] = [];
                    server.on('error', (err: Error) => serverErrors.push(err));
                    const serverClosed = closeEvents(server);
                    // Unread data in the client's receive buffer when its
                    // socket closes makes the kernel answer with a reset.
                    server.send(Buffer.alloc(1024 * 1024));
                    client.terminate();
                    const seen = await serverClosed;
                    expect(seen.length).toBe(1);
                    expect(seen[0].code).toBe(1006);
                    expect(serverErrors.map((e) => e.message).join('; ')).toBe('');
                    expect(log.count()).toBe(0);
                });
            });

            // The client's twin of the case above: the W3C layer rightly fires
            // 'error' for the reset, and the ws wrapper must not pass it on.
            await it("the client, too, sees a server's reset as 'close' (1006) alone", async () => {
                await withPair(mode, async ({ server, client }, log) => {
                    const clientErrors: Error[] = [];
                    client.on('error', (err: Error) => clientErrors.push(err));
                    const clientClosed = closeEvents(client);
                    client.send(Buffer.alloc(1024 * 1024));
                    server.terminate();
                    const seen = await clientClosed;
                    expect(seen.length).toBe(1);
                    expect(seen[0].code).toBe(1006);
                    expect(clientErrors.map((e) => e.message).join('; ')).toBe('');
                    expect(log.count()).toBe(0);
                });
            });

            await it('close() and send() after the peer closed are quiet no-ops', async () => {
                await withPair(mode, async ({ server, client }, log) => {
                    const serverClosed = closeEvents(server);
                    client.close(4001, 'bye');
                    // Hold the server in the peer-closed window: ws is CLOSING
                    // here until the TCP stream ends.
                    await new Promise<void>((resolve) => {
                        const poll = () => (server.readyState === WebSocket.OPEN ? setTimeout(poll, 1) : resolve());
                        poll();
                    });
                    server.close(1000, 'late');
                    const sendErr = await new Promise<Error | undefined>((resolve) => server.send('late', resolve));
                    const seen = await serverClosed;
                    expect(sendErr instanceof Error).toBe(true);
                    expect(seen.length).toBe(1);
                    expect(seen[0].code).toBe(4001);
                    expect(seen[0].reason).toBe('bye');
                    expect(log.count()).toBe(0);
                });
            });
        });
    }

    // Regression: the client delegated to the W3C close(), which admits only
    // 1000 and 3000–4999 from script, so close(1001) — a code ws sends —
    // emitted an error and left the socket CLOSING for good.
    await describe('close() takes every code ws sends', async () => {
        for (const side of ['client', 'server'] as const) {
            for (const code of [1001, 1008, 1010, 1011, 1014]) {
                const title = `${side} close(${code}) reaches the peer with its reason`;
                const body = () =>
                    withPair('port', async ({ server, client }, log) => {
                        const [closer, peer] = side === 'client' ? [client, server] : [server, client];
                        const closerClosed = closeEvents(closer);
                        const peerClosed = closeEvents(peer);
                        let closerError: Error | null = null;
                        closer.on('error', (err: Error) => {
                            closerError = err;
                        });
                        closer.close(code, 'going');
                        expect(closer.readyState).toBe(WebSocket.CLOSING);
                        const seen = await peerClosed;
                        const closerSeen = await closerClosed;
                        expect(seen[0].code).toBe(code);
                        expect(seen[0].reason).toBe('going');
                        expect(closerSeen[0].code).toBe(code);
                        expect(closerError).toBe(null);
                        expect(log.count()).toBe(0);
                    });
                if (SOUP_UNSENDABLE[side].includes(code)) {
                    await it.failing(
                        title,
                        body,
                        "libsoup's soup_websocket_connection_close() refuses 1011 from a client and 1010 " +
                            'from a server, and close_connection() 1012-1014 from either; soupCloseCode() ' +
                            'sends 1002 instead (status/upstream-patch-candidates.md)',
                        { when: isGJS },
                    );
                } else {
                    await it(title, body);
                }
            }
        }

        // ws throws these to the caller. (It has already moved to CLOSING by
        // then and never leaves it; we validate first and stay OPEN, so the
        // state after the throw is not asserted.)
        for (const code of [999, 1004, 1005, 1006, 1015, 2000, 5000]) {
            await it(`close(${code}) throws a TypeError on either side`, async () => {
                await withPair('port', async ({ server, client }, log) => {
                    const serverErrors: Error[] = [];
                    server.on('error', (err: Error) => serverErrors.push(err));
                    const serverClosed = closeEvents(server);
                    expect(() => client.close(code)).toThrow(TypeError);
                    expect(() => server.close(code)).toThrow(TypeError);
                    client.terminate();
                    expect((await serverClosed)[0].code).toBe(1006);
                    // A peer's abrupt end is a transport event: ws reports
                    // it as 'close' alone.
                    expect(serverErrors.map((e) => e.message).join('; ')).toBe('');
                    expect(log.count()).toBe(0);
                });
            });
        }

        await it('a reason over 123 bytes throws a RangeError; 123 bytes close', async () => {
            await withPair('port', async ({ server, client }) => {
                expect(() => client.close(1000, 'x'.repeat(124))).toThrow(RangeError);
                expect(() => server.close(1000, 'x'.repeat(124))).toThrow(RangeError);
                client.terminate();
            });
            await withPair('port', async ({ server, client }, log) => {
                const serverClosed = closeEvents(server);
                client.close(1000, 'x'.repeat(123));
                expect((await serverClosed)[0].reason.length).toBe(123);
                expect(log.count()).toBe(0);
            });
        });
    });

    // Regression: close() while CONNECTING reported 'close' at once but let the
    // handshake run on, so 'open' could still follow a 'close'.
    await describe('client close() and terminate() while CONNECTING', async () => {
        for (const method of ['close', 'terminate'] as const) {
            await it(`${method}() aborts the handshake: 'error', then 'close' 1006, never 'open'`, async () => {
                const wss = new WebSocketServer({ port: 0 });
                const log = watchSoupLog();
                try {
                    const port = await new Promise<number>((resolve) =>
                        wss.on('listening', () => resolve((wss.address() as any).port)),
                    );
                    const client = new WebSocket(`ws://127.0.0.1:${port}/`);
                    const events: string[] = [];
                    let error: Error | null = null;
                    client.on('open', () => events.push('open'));
                    client.on('error', (err: Error) => {
                        events.push('error');
                        error = err;
                    });
                    const closed = closeEvents(client);
                    client.on('close', () => events.push('close'));
                    client[method]();
                    expect(client.readyState).toBe(WebSocket.CLOSING);
                    const seen = await closed;
                    // Long enough for a handshake that kept running to open.
                    await new Promise((r) => setTimeout(r, 100));
                    expect(events.join(',')).toBe('error,close');
                    expect((error as Error | null)?.message).toBe(
                        'WebSocket was closed before the connection was established',
                    );
                    expect(seen.length).toBe(1);
                    expect(seen[0].code).toBe(1006);
                    expect(seen[0].reason).toBe('');
                    expect(client.readyState).toBe(WebSocket.CLOSED);
                    expect(log.count()).toBe(0);
                } finally {
                    log.stop();
                    wss.close();
                }
            });
        }
    });
    // Regression: libsoup answers a peer's Close by echoing its code through
    // the same close_connection() that refuses 1012–1014, so a server's
    // "service restart" reached the ws client as an 'error' as well.
    await describe("a peer's close(1012..1014)", async () => {
        for (const code of [1012, 1013, 1014]) {
            await it(`the client reports ${code} as 'close' alone`, async () => {
                const peer = await rawClosingServer(code, 'restart');
                const log = watchSoupLog();
                try {
                    const client = new WebSocket(`ws://127.0.0.1:${peer.port}/`);
                    const errors: Error[] = [];
                    client.on('error', (err: Error) => errors.push(err));
                    const seen = await closeEvents(client);
                    expect(seen.length).toBe(1);
                    expect(seen[0].code).toBe(code);
                    expect(seen[0].reason).toBe('restart');
                    expect(errors.map((e) => e.message).join('; ')).toBe('');
                    expect(log.count()).toBe(0);
                } finally {
                    log.stop();
                    peer.close();
                }
            });

            await it.failing(
                `the client echoes ${code} back`,
                async () => {
                    const peer = await rawClosingServer(code, 'restart');
                    try {
                        const client = new WebSocket(`ws://127.0.0.1:${peer.port}/`);
                        client.on('error', () => {});
                        expect(await peer.echoed).toBe(code);
                    } finally {
                        peer.close();
                    }
                },
                "libsoup's close_connection() (soup-websocket-connection.c) rejects 1012-1014 and " +
                    'echoes 1002 instead (status/upstream-patch-candidates.md)',
                { when: isGJS },
            );
        }
    });
};
