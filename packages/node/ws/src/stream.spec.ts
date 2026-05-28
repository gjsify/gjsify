// oxlint-disable typescript/no-explicit-any -- ws-API-shape spec: the http 'upgrade' handler signature (`(req, socket, head) => void`) and the ws's `'connection'`/`'message'` listener payloads are deliberately accepted as `any` here because npm `ws`'s drop-in surface explicitly accepts the Node `http.IncomingMessage`/`net.Socket`/`Buffer` triple AND any ws-compatible client (the wrapper exposes a narrower structural type internally — see UpgradeRequest/UpgradeSocket in websocket-server.ts — but the spec exercises real-world consumer code that does NOT import those internal types); narrowing per-callback here would mean shipping shadow type aliases into the test file and break the "this is exactly what an npm `ws` consumer writes" demonstration value. `server.address() as any` is the same pattern Node's own `net` tests use for the `string | AddressInfo | null` union (port-bearing AddressInfo is the only path test hits).
// SPDX-License-Identifier: MIT
// Ported from refs/ws/test/websocket-stream.test.js
// Original: Copyright (c) 2011+ Einar Otto Stangvik. MIT.
// Rewritten for @gjsify/unit.

import { describe, it, expect, on } from '@gjsify/unit';
import { createServer } from 'node:http';
import { WebSocket, WebSocketServer, createWebSocketStream } from 'ws';

export default async () => {
    await describe('createWebSocketStream', async () => {
        await it('is a function', async () => {
            expect(typeof createWebSocketStream).toBe('function');
        });
    });

    await on('Gjs', async () => {
        await describe('createWebSocketStream — server side', async () => {
            await it('pipes data from client through server duplex and back', async () => {
                const server = createServer();
                const wss = new WebSocketServer({ noServer: true });

                server.on('upgrade', (req: any, socket: any, head: any) => {
                    wss.handleUpgrade(req, socket, head, (ws: any) => wss.emit('connection', ws, req));
                });

                await new Promise<void>((resolve, reject) => {
                    wss.on('connection', (ws: any) => {
                        const stream = createWebSocketStream(ws);
                        stream.pipe(stream); // echo: readable piped back into writable
                    });

                    server.listen(0, () => {
                        const addr = server.address() as any;
                        const client = new WebSocket(`ws://127.0.0.1:${addr.port}/`);

                        client.on('open', () => client.send('hello stream'));

                        client.on('message', (data: any) => {
                            expect(String(data)).toBe('hello stream');
                            client.close();
                            server.close();
                            wss.close();
                            resolve();
                        });

                        client.on('error', reject);
                    });
                });
            });

            await it('push(null) on WebSocket close ends the readable side', async () => {
                const server = createServer();
                const wss = new WebSocketServer({ noServer: true });

                server.on('upgrade', (req: any, socket: any, head: any) => {
                    wss.handleUpgrade(req, socket, head, (ws: any) => wss.emit('connection', ws, req));
                });

                await new Promise<void>((resolve, reject) => {
                    wss.on('connection', (ws: any) => {
                        const stream = createWebSocketStream(ws);
                        const chunks: Buffer[] = [];

                        stream.on('data', (chunk: Buffer) =>
                            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
                        );
                        stream.on('end', () => {
                            expect(Buffer.concat(chunks).toString()).toBe('end-test');
                            server.close();
                            wss.close();
                            resolve();
                        });
                        stream.on('error', reject);
                    });

                    server.listen(0, () => {
                        const addr = server.address() as any;
                        const client = new WebSocket(`ws://127.0.0.1:${addr.port}/`);

                        client.on('open', () => {
                            client.send('end-test');
                            client.close();
                        });

                        client.on('error', reject);
                    });
                });
            });

            await it('writes to the duplex are sent as WebSocket messages', async () => {
                const server = createServer();
                const wss = new WebSocketServer({ noServer: true });

                server.on('upgrade', (req: any, socket: any, head: any) => {
                    wss.handleUpgrade(req, socket, head, (ws: any) => wss.emit('connection', ws, req));
                });

                await new Promise<void>((resolve, reject) => {
                    wss.on('connection', (ws: any) => {
                        const stream = createWebSocketStream(ws);
                        stream.write('from server via stream');
                    });

                    server.listen(0, () => {
                        const addr = server.address() as any;
                        const client = new WebSocket(`ws://127.0.0.1:${addr.port}/`);

                        client.on('message', (data: any) => {
                            expect(String(data)).toBe('from server via stream');
                            client.close();
                            server.close();
                            wss.close();
                            resolve();
                        });

                        client.on('error', reject);
                    });
                });
            });
        });
    });
};
