// SPDX-License-Identifier: MIT
// @gjsify/ws — server-to-client rapid-send fidelity
//
// Reproduces a bug surfaced by pixel-rpg/map-editor's Pair-Editing
// hand-test on 2026-05-31: the host (a `WebSocketServer`-side
// `ServerSideWebSocket`) calls `send()` 13 times in rapid
// succession (12 small ICE-candidate frames + 1 larger SDP-offer
// frame, ~166–1500 bytes each, all TEXT, all on the same JS tick)
// and the joiner's `WebSocket` reports `0 messages delivered`
// before the WS closes.
//
// This shape — burst of small TEXT sends from server right after
// the upgrade callback fires — is exactly what WebRTC signalling
// does: gather ICE candidates in `onicecandidate`, then send the
// SDP via `setLocalDescription` callback. Without main-loop yields
// between each send, the underlying Soup.WebsocketConnection has
// to queue them all and flush in one pass.
//
// The first three describes EACH walk a degree of stress; if any
// of them fail under @gjsify/ws while passing under real npm-ws,
// the bug is in our Soup-backed server implementation.

import { describe, expect, it, on } from '@gjsify/unit';
import { WebSocket, WebSocketServer } from 'ws';

function makeFakeIceCandidate(i: number): string {
    // Match the shape of the actual envelopes pixel-rpg sends:
    // { type: 'ice-candidate', payload: { candidate: 'candidate:N 1 UDP …' } }
    // Sizes: 166-204 bytes when serialized.
    return JSON.stringify({
        type: 'ice-candidate',
        payload: { candidate: `candidate:${i} 1 UDP 2015363327 192.168.0.${i % 254 + 1} ${40000 + i} typ host` },
    });
}

function makeFakeSdpOffer(): string {
    // ~1500-byte envelope mirroring the actual hand-test payload.
    // The 200-line "v=0" SDP body is intentionally ASCII-only so
    // we eliminate UTF-8 boundary effects from the diagnosis.
    const lines: string[] = ['v=0', 'o=- 4611686018427387905 2 IN IP4 0.0.0.0', 's=-', 't=0 0'];
    for (let i = 0; i < 40; i++) lines.push(`a=ice-pwd:${'x'.repeat(20)}${i}`);
    const sdp = lines.join('\r\n') + '\r\n';
    return JSON.stringify({ type: 'sdp', payload: { type: 'offer', sdp } });
}

async function waitForFrames(ws: InstanceType<typeof WebSocket>, count: number, timeoutMs = 3_000): Promise<string[]> {
    const received: string[] = [];
    return new Promise<string[]>((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(
                new Error(
                    `Timed out after ${timeoutMs}ms with ${received.length}/${count} frames received. ` +
                        `Received: ${received.map((f) => f.slice(0, 80)).join(' | ')}`,
                ),
            );
        }, timeoutMs);
        ws.on('message', (raw: Buffer | string) => {
            const text = typeof raw === 'string' ? raw : raw.toString('utf-8');
            received.push(text);
            if (received.length >= count) {
                clearTimeout(timer);
                resolve(received);
            }
        });
    });
}

export default async () => {
    await on('Gjs', async () => {
        await describe('WebSocketServer rapid-send fidelity (2026-05-31 reproducer)', async () => {
            await it('server sends 13 small TEXT frames in one tick — client receives ALL 13', async () => {
                const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
                await new Promise<void>((r) => wss.once('listening', () => r()));
                const port = (wss.address() as { port: number }).port;

                const serverConnected = new Promise<InstanceType<typeof WebSocket>>((resolve) => {
                    wss.on('connection', (peer) => resolve(peer));
                });

                const client = new WebSocket(`ws://127.0.0.1:${port}/`);
                await new Promise<void>((r) => client.on('open', () => r()));
                const server = await serverConnected;

                // Pre-build the frames so the send loop is as tight as possible.
                const frames: string[] = [];
                for (let i = 0; i < 12; i++) frames.push(makeFakeIceCandidate(i + 1));
                frames.push(makeFakeSdpOffer());
                expect(frames.length).toBe(13);

                const allReceived = waitForFrames(client, 13, 5_000);

                // THE actual reproduction: send all 13 frames in one
                // synchronous burst, no `await` / `queueMicrotask`
                // between them — mirroring the pixel-rpg call site.
                for (const frame of frames) server.send(frame);

                const received = await allReceived;
                expect(received.length).toBe(13);
                for (let i = 0; i < 13; i++) expect(received[i]).toBe(frames[i]);

                client.close();
                wss.close();
            });

            await it('server sends 1 mid-size TEXT frame (~1.5 KiB) immediately after connect — client receives it', async () => {
                // Bisects size-vs-burst: send EXACTLY ONE 1.5 KiB
                // frame so any failure here points at frame-size,
                // not burst rate.
                const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
                await new Promise<void>((r) => wss.once('listening', () => r()));
                const port = (wss.address() as { port: number }).port;

                const serverConnected = new Promise<InstanceType<typeof WebSocket>>((resolve) => {
                    wss.on('connection', (peer) => resolve(peer));
                });

                const client = new WebSocket(`ws://127.0.0.1:${port}/`);
                await new Promise<void>((r) => client.on('open', () => r()));
                const server = await serverConnected;

                const sdpEnvelope = makeFakeSdpOffer();
                expect(sdpEnvelope.length).toBeGreaterThan(1_400);
                const got = waitForFrames(client, 1, 3_000);
                server.send(sdpEnvelope);
                const [received] = await got;
                expect(received).toBe(sdpEnvelope);

                client.close();
                wss.close();
            });

            await it('server sends 50 small TEXT frames in one tick — client receives ALL 50', async () => {
                // Pushes the burst rate harder than the maker
                // actually does; if @gjsify/ws can survive 50 we
                // know 13 is well within tolerance.
                const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
                await new Promise<void>((r) => wss.once('listening', () => r()));
                const port = (wss.address() as { port: number }).port;

                const serverConnected = new Promise<InstanceType<typeof WebSocket>>((resolve) => {
                    wss.on('connection', (peer) => resolve(peer));
                });

                const client = new WebSocket(`ws://127.0.0.1:${port}/`);
                await new Promise<void>((r) => client.on('open', () => r()));
                const server = await serverConnected;

                const frames: string[] = [];
                for (let i = 0; i < 50; i++) frames.push(makeFakeIceCandidate(i));
                const got = waitForFrames(client, 50, 5_000);
                for (const frame of frames) server.send(frame);
                const received = await got;
                expect(received.length).toBe(50);

                client.close();
                wss.close();
            });

            await it('DIAGNOSTIC: server sends 1 small TEXT frame AFTER 100ms delay — client receives it', async () => {
                // If THIS one passes while the immediate-send variants fail,
                // the bug is "send too soon after Soup's add_websocket_handler
                // callback fires" — the connection isn't fully OPEN on the
                // wire yet.
                const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
                await new Promise<void>((r) => wss.once('listening', () => r()));
                const port = (wss.address() as { port: number }).port;

                const serverConnected = new Promise<InstanceType<typeof WebSocket>>((resolve) => {
                    wss.on('connection', (peer) => resolve(peer));
                });

                const client = new WebSocket(`ws://127.0.0.1:${port}/`);
                await new Promise<void>((r) => client.on('open', () => r()));
                const server = await serverConnected;

                await new Promise<void>((r) => setTimeout(r, 100));

                const got = waitForFrames(client, 1, 3_000);
                server.send('hello');
                const [received] = await got;
                expect(received).toBe('hello');

                client.close();
                wss.close();
            });

            await it('DIAGNOSTIC: client sends FIRST (server echoes back) — works', async () => {
                // Echo pattern: client opens → client sends → server
                // handler reads → server echoes. This is the pattern
                // the existing tests use, and they pass.
                const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
                await new Promise<void>((r) => wss.once('listening', () => r()));
                const port = (wss.address() as { port: number }).port;
                wss.on('connection', (peer) => {
                    peer.on('message', (msg: Buffer | string) => peer.send(String(msg)));
                });

                const client = new WebSocket(`ws://127.0.0.1:${port}/`);
                await new Promise<void>((r) => client.on('open', () => r()));

                const got = waitForFrames(client, 1, 3_000);
                client.send('ping');
                const [received] = await got;
                expect(received).toBe('ping');

                client.close();
                wss.close();
            });

            await it('DIAGNOSTIC: hypothesis — perMessageDeflate=false client survives', async () => {
                // @gjsify/ws WebSocket client defaults perMessageDeflate
                // to true (matching npm-ws). @gjsify/ws WebSocketServer
                // doesn't register Soup.WebsocketExtensionDeflate, so
                // Soup negotiates deflate one-sidedly and frames get
                // surfaced as raw compressed bytes that no listener
                // decodes — silent drop.
                const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
                await new Promise<void>((r) => wss.once('listening', () => r()));
                const port = (wss.address() as { port: number }).port;

                const serverConnected = new Promise<InstanceType<typeof WebSocket>>((resolve) => {
                    wss.on('connection', (peer) => resolve(peer));
                });

                // perMessageDeflate: false on the client side → no
                // deflate negotiation → server frames flow through
                // un-mangled.
                const client = new WebSocket(`ws://127.0.0.1:${port}/`, undefined, {
                    perMessageDeflate: false,
                });
                await new Promise<void>((r) => client.on('open', () => r()));
                const server = await serverConnected;

                const got = waitForFrames(client, 1, 3_000);
                server.send('hello-no-deflate');
                const [received] = await got;
                expect(received).toBe('hello-no-deflate');

                client.close();
                wss.close();
            });

            await it('DIAGNOSTIC: bisect — { port } mode + raw Soup.Session client (no @gjsify/ws WebSocket)', async () => {
                // If this passes while the @gjsify/ws-client variants fail,
                // the bug is in the @gjsify/ws WebSocket client side.
                // If this also fails, the bug is in the `{ port }` mode
                // server-side `add_websocket_handler` setup.
                const Soup3 = (await import('@girs/soup-3.0')).default;
                const GLib2 = (await import('@girs/glib-2.0')).default;

                const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
                await new Promise<void>((r) => wss.once('listening', () => r()));
                const port = (wss.address() as { port: number }).port;

                let received = ''
                await new Promise<void>((resolve, reject) => {
                    const timer = setTimeout(() => reject(new Error('raw-client timed out')), 3_000)
                    wss.on('connection', (peer) => {
                        peer.on('message', (msg: Buffer | string) => peer.send(String(msg)))
                    })
                    const session = new Soup3.Session()
                    const uri = GLib2.Uri.parse(`ws://127.0.0.1:${port}/`, GLib2.UriFlags.NONE)
                    const soupMsg = new Soup3.Message({ method: 'GET', uri })
                    session.websocket_connect_async(soupMsg, null, null, GLib2.PRIORITY_DEFAULT, null, (_self: unknown, asyncRes: never) => {
                        try {
                            const conn = session.websocket_connect_finish(asyncRes as never)
                            conn.connect('message', (_c: never, type: number, bytes: never) => {
                                const data = (bytes as { get_data(): Uint8Array | null }).get_data()
                                if (type === Soup3.WebsocketDataType.TEXT && data) {
                                    received = new TextDecoder().decode(data)
                                    clearTimeout(timer)
                                    conn.close(1_000, null)
                                    wss.close()
                                    resolve()
                                }
                            })
                            // raw client sends 'rawping' — server echoes
                            conn.send_message(Soup3.WebsocketDataType.TEXT, new GLib2.Bytes(new TextEncoder().encode('rawping')))
                        } catch (err) {
                            clearTimeout(timer)
                            reject(err instanceof Error ? err : new Error(String(err)))
                        }
                    })
                })
                expect(received).toBe('rawping')
            })

            await it('server sends 12 small + 1 large TEXT frame interleaved over multiple ticks — client receives ALL 13', async () => {
                // Closest match to the actual map-editor sequence:
                // libnice fires 12 ICE candidates from main-loop
                // callbacks (each on its own tick), then
                // setLocalDescription completes and we send the
                // SDP. Simulated here with `await Promise.resolve()`
                // between each ICE send.
                const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
                await new Promise<void>((r) => wss.once('listening', () => r()));
                const port = (wss.address() as { port: number }).port;

                const serverConnected = new Promise<InstanceType<typeof WebSocket>>((resolve) => {
                    wss.on('connection', (peer) => resolve(peer));
                });

                const client = new WebSocket(`ws://127.0.0.1:${port}/`);
                await new Promise<void>((r) => client.on('open', () => r()));
                const server = await serverConnected;

                const sdpEnvelope = makeFakeSdpOffer();
                const candidateFrames: string[] = [];
                for (let i = 0; i < 12; i++) candidateFrames.push(makeFakeIceCandidate(i + 1));

                const got = waitForFrames(client, 13, 5_000);
                for (const frame of candidateFrames) {
                    server.send(frame);
                    await Promise.resolve();
                }
                server.send(sdpEnvelope);

                const received = await got;
                expect(received.length).toBe(13);
                expect(received[12]).toBe(sdpEnvelope);

                client.close();
                wss.close();
            });
        });
    });
};
