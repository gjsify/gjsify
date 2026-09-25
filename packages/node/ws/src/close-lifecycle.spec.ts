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
import { createServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';

interface SoupLogWatch {
    count(): number;
    stop(): void;
}

/** Counts libsoup CRITICAL/WARNING records while active. Node has no libsoup,
 *  so there the count is trivially zero and only the ws semantics are checked. */
function watchSoupLog(): SoupLogWatch {
    const GLib = (globalThis as any).imports?.gi?.GLib;
    if (!GLib) return { count: () => 0, stop: () => {} };
    let records = 0;
    const levels = GLib.LogLevelFlags.LEVEL_CRITICAL | GLib.LogLevelFlags.LEVEL_WARNING;
    const id = GLib.log_set_handler('libsoup', levels, () => {
        records++;
    });
    return { count: () => records, stop: () => GLib.log_remove_handler('libsoup', id) };
}

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
};
