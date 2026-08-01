// SPDX-License-Identifier: MIT
// Ported from npm undici tests — `test/websocket/` in the upstream repo
// (excluded from the npm tarball) — re-derived against undici's documented
// `WebSocket` export:
// https://github.com/nodejs/undici/blob/v7.x/docs/docs/api/WebSocket.md
// Original: Copyright (c) Matteo Collina + undici contributors. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.
//
// Server-side uses the npm `ws` package; under GJS the resolve-npm alias
// layer routes `ws` to `@gjsify/ws` (Soup-backed WebSocketServer), so the
// same source covers both runtimes without conditional imports.

import { describe, it, expect } from '@gjsify/unit';
import { WebSocket as UndiciWebSocket } from 'undici';
import { WebSocketServer } from 'ws';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

interface WsTestServer {
    readonly url: string;
    readonly wss: WebSocketServer;
    close: () => Promise<void>;
}

async function startWsServer(): Promise<WsTestServer> {
    const httpServer: Server = createServer();
    const wss = new WebSocketServer({ server: httpServer });

    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const addr = httpServer.address() as AddressInfo;
    const url = `ws://127.0.0.1:${addr.port}`;

    return {
        url,
        wss,
        async close() {
            // Close every client then the server.
            for (const client of wss.clients) {
                try {
                    client.terminate?.();
                } catch {
                    /* ignore */
                }
            }
            await new Promise<void>((resolve) => wss.close(() => resolve()));
            await new Promise<void>((resolve, reject) => httpServer.close((err) => (err ? reject(err) : resolve())));
        },
    };
}

async function waitOpen(ws: UndiciWebSocket): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        const onOpen = () => {
            cleanup();
            resolve();
        };
        const onError = (e: Event) => {
            cleanup();
            reject(new Error('ws open error: ' + (e as ErrorEvent).message));
        };
        const cleanup = () => {
            ws.removeEventListener('open', onOpen);
            ws.removeEventListener('error', onError);
        };
        ws.addEventListener('open', onOpen);
        ws.addEventListener('error', onError);
    });
}

async function closeClient(ws: UndiciWebSocket): Promise<void> {
    if (ws.readyState === ws.CLOSED) return;
    await new Promise<void>((resolve) => {
        const done = () => resolve();
        ws.addEventListener('close', done, { once: true });
        try {
            ws.close();
        } catch {
            resolve();
        }
        // Safety timeout — never hang the test if close races.
        setTimeout(done, 2000);
    });
}

export default async () => {
    await describe('undici.WebSocket — client API against a local server', async () => {
        await it('opens a connection, exchanges a text message, closes cleanly', async () => {
            const server = await startWsServer();
            try {
                server.wss.on('connection', (sock) => {
                    sock.on('message', (data) => {
                        // ws emits Buffer for binary or text — echo as text.
                        sock.send(typeof data === 'string' ? data : data.toString());
                    });
                });

                const ws = new UndiciWebSocket(server.url);
                await waitOpen(ws);

                const received = await new Promise<string>((resolve) => {
                    ws.addEventListener('message', (ev: MessageEvent) => resolve(String(ev.data)), { once: true });
                    ws.send('ping');
                });

                expect(received).toBe('ping');
                await closeClient(ws);
                expect(ws.readyState).toBe(ws.CLOSED);
            } finally {
                await server.close();
            }
        });

        await it('reports CONNECTING then OPEN readyState during handshake', async () => {
            const server = await startWsServer();
            try {
                server.wss.on('connection', () => {
                    /* hold open */
                });
                const ws = new UndiciWebSocket(server.url);
                // CONNECTING (0) before open
                expect(ws.readyState).toBe(ws.CONNECTING);
                await waitOpen(ws);
                expect(ws.readyState).toBe(ws.OPEN);
                await closeClient(ws);
            } finally {
                await server.close();
            }
        });

        await it('echoes binary frames via ArrayBuffer round-trip', async () => {
            const server = await startWsServer();
            try {
                server.wss.on('connection', (sock) => {
                    sock.on('message', (data, isBinary) => {
                        // Echo back as binary when received as binary.
                        if (isBinary && Buffer.isBuffer(data)) {
                            sock.send(data, { binary: true });
                        } else {
                            sock.send(data);
                        }
                    });
                });

                const ws = new UndiciWebSocket(server.url);
                ws.binaryType = 'arraybuffer';
                await waitOpen(ws);

                const payload = new Uint8Array([1, 2, 3, 4, 5]);

                const received = await new Promise<ArrayBuffer | string>((resolve) => {
                    ws.addEventListener('message', (ev: MessageEvent) => resolve(ev.data as ArrayBuffer | string), {
                        once: true,
                    });
                    ws.send(payload);
                });

                expect(received instanceof ArrayBuffer).toBe(true);
                const bytes = new Uint8Array(received as ArrayBuffer);
                expect(Array.from(bytes)).toStrictEqual([1, 2, 3, 4, 5]);

                await closeClient(ws);
            } finally {
                await server.close();
            }
        });

        await it('close event surfaces wasClean + code', async () => {
            const server = await startWsServer();
            try {
                server.wss.on('connection', (sock) => {
                    // Close the connection cleanly from the server side once
                    // we get any message, with a custom code+reason.
                    sock.on('message', () => sock.close(1000, 'bye'));
                });

                const ws = new UndiciWebSocket(server.url);
                await waitOpen(ws);

                const closeEv = await new Promise<CloseEvent>((resolve) => {
                    ws.addEventListener('close', (ev) => resolve(ev as CloseEvent), { once: true });
                    ws.send('triggers-close');
                });

                expect(closeEv.code).toBe(1000);
                expect(closeEv.wasClean).toBe(true);
            } finally {
                await server.close();
            }
        });

        await it('rejecting target URL surfaces an error event', async () => {
            // Bind a port + immediately close it to guarantee ECONNREFUSED.
            const httpServer = createServer();
            await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
            const port = (httpServer.address() as AddressInfo).port;
            await new Promise<void>((resolve) => httpServer.close(() => resolve()));

            const ws = new UndiciWebSocket(`ws://127.0.0.1:${port}`);
            const errored = await new Promise<boolean>((resolve) => {
                const finish = () => resolve(true);
                ws.addEventListener('error', finish, { once: true });
                ws.addEventListener('close', finish, { once: true });
                setTimeout(() => resolve(false), 2000);
            });
            expect(errored).toBe(true);
        });
    });
};
