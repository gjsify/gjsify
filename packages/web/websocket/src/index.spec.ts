// Tests for W3C WebSocket API
// Ported from WHATWG WebSocket spec requirements
// Note: @gjsify/websocket uses Soup 3.0 — tests run only on GJS

import { describe, it, expect } from '@gjsify/unit';
import GLib from '@girs/glib-2.0';
import Gio from '@girs/gio-2.0';
import Soup from '@girs/soup-3.0';
import { WebSocket, MessageEvent, CloseEvent, kAbort } from 'websocket';

export default async () => {
    // --- WebSocket class ---
    await describe('WebSocket', async () => {
        await it('should be a constructor', async () => {
            expect(typeof WebSocket).toBe('function');
        });

        await it('should have readyState constants', async () => {
            expect(WebSocket.CONNECTING).toBe(0);
            expect(WebSocket.OPEN).toBe(1);
            expect(WebSocket.CLOSING).toBe(2);
            expect(WebSocket.CLOSED).toBe(3);
        });
    });

    // --- MessageEvent ---
    await describe('MessageEvent', async () => {
        await it('should be constructable', async () => {
            const event = new MessageEvent('message', { data: 'hello' });
            expect(event.type).toBe('message');
            expect(event.data).toBe('hello');
        });

        await it('should have origin and lastEventId', async () => {
            const event = new MessageEvent('message', {
                data: 'test',
                origin: 'ws://example.com',
                lastEventId: '42',
            });
            expect(event.origin).toBe('ws://example.com');
            expect(event.lastEventId).toBe('42');
        });

        await it('should default origin and lastEventId to empty string', async () => {
            const event = new MessageEvent('message', { data: 'x' });
            expect(event.origin).toBe('');
            expect(event.lastEventId).toBe('');
        });

        await it('should support ArrayBuffer data', async () => {
            const buffer = new ArrayBuffer(4);
            const event = new MessageEvent('message', { data: buffer });
            expect(event.data).toBe(buffer);
        });
    });

    // --- CloseEvent ---
    await describe('CloseEvent', async () => {
        await it('should be constructable', async () => {
            const event = new CloseEvent('close');
            expect(event.type).toBe('close');
        });

        await it('should have code, reason, wasClean', async () => {
            const event = new CloseEvent('close', {
                code: 1000,
                reason: 'normal',
                wasClean: true,
            });
            expect(event.code).toBe(1000);
            expect(event.reason).toBe('normal');
            expect(event.wasClean).toBe(true);
        });

        await it('should default to 0, empty reason, wasClean=false', async () => {
            const event = new CloseEvent('close');
            expect(event.code).toBe(0);
            expect(event.reason).toBe('');
            expect(event.wasClean).toBe(false);
        });
    });

    // --- WebSocket round-trip ---
    await describe('WebSocket round-trip', async () => {
        await it('should connect, send, receive, and close', async () => {
            const server = new Soup.Server({});
            server.add_websocket_handler(
                '/ws',
                null,
                null,
                (_srv: Soup.Server, _msg: Soup.ServerMessage, _path: string, connection: Soup.WebsocketConnection) => {
                    connection.connect(
                        'message',
                        (_conn: Soup.WebsocketConnection, _type: number, message: GLib.Bytes) => {
                            const text = new TextDecoder().decode(message.toArray());
                            connection.send_text(text);
                        },
                    );
                },
            );
            server.listen_local(0, Soup.ServerListenOptions.IPV4_ONLY);
            const port = (server.get_listeners()[0].get_local_address() as Gio.InetSocketAddress).get_port();

            const result = await new Promise<string>((resolve, reject) => {
                const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
                ws.onopen = () => ws.send('hello websocket');
                ws.onmessage = (event: MessageEvent<string>) => {
                    ws.close();
                    resolve(event.data);
                };
                ws.onerror = () => reject(new Error('WebSocket error'));
                setTimeout(() => reject(new Error('Timeout')), 5000);
            });

            expect(result).toBe('hello websocket');
            server.disconnect();
        });

        await it('should handle binary data', async () => {
            const server = new Soup.Server({});
            server.add_websocket_handler(
                '/ws',
                null,
                null,
                (_srv: Soup.Server, _msg: Soup.ServerMessage, _path: string, connection: Soup.WebsocketConnection) => {
                    connection.connect(
                        'message',
                        (_conn: Soup.WebsocketConnection, _type: number, message: GLib.Bytes) => {
                            connection.send_binary(message.toArray());
                        },
                    );
                },
            );
            server.listen_local(0, Soup.ServerListenOptions.IPV4_ONLY);
            const port = (server.get_listeners()[0].get_local_address() as Gio.InetSocketAddress).get_port();

            const result = await new Promise<ArrayBuffer>((resolve, reject) => {
                const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
                ws.binaryType = 'arraybuffer';
                ws.onopen = () => ws.send(new Uint8Array([1, 2, 3, 4, 5]).buffer);
                ws.onmessage = (event: MessageEvent<ArrayBuffer>) => {
                    ws.close();
                    resolve(event.data);
                };
                ws.onerror = () => reject(new Error('WebSocket error'));
                setTimeout(() => reject(new Error('Timeout')), 5000);
            });

            const arr = new Uint8Array(result);
            expect(arr.length).toBe(5);
            expect(arr[0]).toBe(1);
            expect(arr[4]).toBe(5);
            server.disconnect();
        });

        await it('should connect when the URL has no path (normalizes to "/")', async () => {
            // Regression: `ws://host:port` (no trailing slash) reached the
            // server with an EMPTY request path — GLib.Uri doesn't normalize a
            // missing path to "/" the way WHATWG URL (and upstream ws) does.
            // The server's handler is registered at "/", the default path, so
            // an unnormalized empty-path request never matched it and the
            // handshake was rejected (close 1006).
            const server = new Soup.Server({});
            server.add_websocket_handler(
                '/',
                null,
                null,
                (_srv: Soup.Server, _msg: Soup.ServerMessage, _path: string, connection: Soup.WebsocketConnection) => {
                    connection.send_text('no-path-ok');
                },
            );
            server.listen_local(0, Soup.ServerListenOptions.IPV4_ONLY);
            const port = (server.get_listeners()[0].get_local_address() as Gio.InetSocketAddress).get_port();

            const result = await new Promise<string>((resolve, reject) => {
                // No path, no trailing slash — the exact form that failed.
                const ws = new WebSocket(`ws://127.0.0.1:${port}`);
                ws.onmessage = (event: MessageEvent<string>) => {
                    ws.close();
                    resolve(event.data);
                };
                ws.onerror = () => reject(new Error('WebSocket error'));
                setTimeout(() => reject(new Error('Timeout')), 5000);
            });

            expect(result).toBe('no-path-ok');
            server.disconnect();
        });

        await it('should report close code', async () => {
            const server = new Soup.Server({});
            server.add_websocket_handler(
                '/ws',
                null,
                null,
                (_srv: Soup.Server, _msg: Soup.ServerMessage, _path: string, connection: Soup.WebsocketConnection) => {
                    connection.close(1000, 'server done');
                },
            );
            server.listen_local(0, Soup.ServerListenOptions.IPV4_ONLY);
            const port = (server.get_listeners()[0].get_local_address() as Gio.InetSocketAddress).get_port();

            const result = await new Promise<number>((resolve, reject) => {
                const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
                ws.onclose = (event: CloseEvent) => resolve(event.code);
                ws.onerror = () => reject(new Error('WebSocket error'));
                setTimeout(() => reject(new Error('Timeout')), 5000);
            });

            expect(result).toBe(1000);
            server.disconnect();
        });
    });

    // --- WebSocket client options ---
    // Ref: refs/ws/test/websocket.test.js §"options" (headers, origin, handshakeTimeout)
    await describe('WebSocket client options', async () => {
        await it('should send custom headers with the upgrade request', async () => {
            const server = new Soup.Server({});
            let receivedCookieHeader: string | null = null;

            server.add_websocket_handler(
                '/ws',
                null,
                null,
                (_srv: Soup.Server, msg: Soup.ServerMessage, _path: string, connection: Soup.WebsocketConnection) => {
                    receivedCookieHeader = msg.get_request_headers().get_one('Cookie') ?? null;
                    connection.close(1000, 'done');
                },
            );
            server.listen_local(0, Soup.ServerListenOptions.IPV4_ONLY);
            const port = (server.get_listeners()[0].get_local_address() as Gio.InetSocketAddress).get_port();

            await new Promise<void>((resolve, reject) => {
                const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, undefined, {
                    headers: { Cookie: 'foo=bar' },
                });
                ws.addEventListener('close', () => resolve(), { once: true });
                ws.addEventListener('error', () => reject(new Error('WebSocket error')), { once: true });
                setTimeout(() => reject(new Error('Timeout')), 5000);
            });

            expect(receivedCookieHeader).toBe('foo=bar');
            server.disconnect();
        });

        await it('should set the Origin header when the origin option is given', async () => {
            const server = new Soup.Server({});
            let receivedOrigin: string | null = null;

            server.add_websocket_handler(
                '/ws',
                null,
                null,
                (_srv: Soup.Server, msg: Soup.ServerMessage, _path: string, connection: Soup.WebsocketConnection) => {
                    receivedOrigin = msg.get_request_headers().get_one('Origin') ?? null;
                    connection.close(1000, 'done');
                },
            );
            server.listen_local(0, Soup.ServerListenOptions.IPV4_ONLY);
            const port = (server.get_listeners()[0].get_local_address() as Gio.InetSocketAddress).get_port();

            await new Promise<void>((resolve, reject) => {
                const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, undefined, {
                    origin: 'https://example.com:8000',
                });
                ws.addEventListener('close', () => resolve(), { once: true });
                ws.addEventListener('error', () => reject(new Error('WebSocket error')), { once: true });
                setTimeout(() => reject(new Error('Timeout')), 5000);
            });

            expect(receivedOrigin).toBe('https://example.com:8000');
            server.disconnect();
        });

        await it('should fire error with "Opening handshake has timed out" when handshakeTimeout expires', async () => {
            // Use a raw TCP listener that accepts connections but never sends a 101.
            // Soup's websocket_connect_async will wait for the upgrade response; after
            // handshakeTimeout ms we cancel via Gio.Cancellable.
            const service = new Gio.SocketService();
            const port = service.add_any_inet_port(null);
            const heldConns: Gio.SocketConnection[] = [];
            service.connect('incoming', (_svc: Gio.SocketService, conn: Gio.SocketConnection) => {
                heldConns.push(conn); // Hold reference — never write back
                return true;
            });
            service.start();

            const error = await new Promise<Error>((resolve, reject) => {
                const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, undefined, {
                    handshakeTimeout: 200,
                });
                // The W3C `Event` doesn't model `error`/`message`; the impl attaches them so
                // wrappers (e.g. @gjsify/ws) can surface a typed error. Cast through `unknown`
                // because the consumer's global `Event` and dom-events' internal `Event` are
                // structurally compatible but TS treats them as distinct nominal types.
                const onError = (ev: Event & { error?: Error; message?: string }) => {
                    resolve(ev.error instanceof Error ? ev.error : new Error(ev.message ?? 'unknown'));
                };
                ws.addEventListener('error', onError as unknown as Parameters<typeof ws.addEventListener>[1], {
                    once: true,
                });
                ws.addEventListener('open', () => reject(new Error('Unexpected open')), { once: true });
                setTimeout(() => reject(new Error('Test timeout')), 5000);
            });

            expect(error instanceof Error).toBe(true);
            expect(error.message).toBe('Opening handshake has timed out');

            service.stop();
        });
    });

    // --- Closing handshake ---
    // Regression: Soup answers a peer's Close frame on its own, but 'closed'
    // only fires once the TCP stream ends. readyState stayed OPEN in that
    // window, so a close() or send() reached Soup after its Close frame —
    // `libsoup-CRITICAL: soup_websocket_connection_close: assertion
    // '!priv->close_sent' failed`, ~24 per socket.io suite run (engine.io's
    // failed upgrade probe closes its transport exactly there).
    await describe('WebSocket closing handshake', async () => {
        await it('is CLOSING after the peer closed, and close()/send() stay off Soup', async () => {
            // A hand-rolled server that sends its Close frame and then holds the
            // TCP stream open: the client sits in the closing window for as
            // long as the test needs instead of one loopback round trip.
            const service = new Gio.SocketService();
            const port = service.add_any_inet_port(null);
            const held: Gio.SocketConnection[] = [];
            service.connect('incoming', (_svc: Gio.SocketService, conn: Gio.SocketConnection) => {
                held.push(conn);
                let request = '';
                const readMore = () =>
                    conn.get_input_stream().read_bytes_async(4096, GLib.PRIORITY_DEFAULT, null, (_s, res) => {
                        request += new TextDecoder().decode(conn.get_input_stream().read_bytes_finish(res).toArray());
                        if (!request.includes('\r\n\r\n')) return readMore();
                        const key = /Sec-WebSocket-Key: *(\S+)/i.exec(request)?.[1] ?? '';
                        const sha1 = new GLib.Checksum(GLib.ChecksumType.SHA1);
                        sha1.update(new TextEncoder().encode(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'));
                        const hex = sha1.get_string() ?? '';
                        const digest = new Uint8Array(hex.length / 2).map((_, i) =>
                            parseInt(hex.slice(i * 2, i * 2 + 2), 16),
                        );
                        const head =
                            'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
                            `Sec-WebSocket-Accept: ${GLib.base64_encode(digest)}\r\n\r\n`;
                        // Close frame, code 4001, reason "bye".
                        const frame = [0x88, 0x05, 0x0f, 0xa1, 0x62, 0x79, 0x65];
                        conn.get_output_stream().write_all(
                            new Uint8Array([...new TextEncoder().encode(head), ...frame]),
                            null,
                        );
                    });
                readMore();
                return true;
            });
            service.start();

            let criticals = 0;
            const levels = GLib.LogLevelFlags.LEVEL_CRITICAL | GLib.LogLevelFlags.LEVEL_WARNING;
            const handler = GLib.log_set_handler('libsoup', levels, () => {
                criticals++;
            });
            // A failed expectation must not leave the handler installed for the
            // specs after this one.
            try {
                const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
                const closed = new Promise<CloseEvent>((resolve) => {
                    ws.onclose = (event: CloseEvent) => resolve(event);
                });
                await new Promise<void>((resolve, reject) => {
                    ws.onopen = () => resolve();
                    ws.onerror = () => reject(new Error('WebSocket error'));
                });
                // Soup's own close timeout is 5 s; give up well before it.
                const deadline = Date.now() + 2000;
                while (ws.readyState === WebSocket.OPEN && Date.now() < deadline) {
                    await new Promise((r) => setTimeout(r, 5));
                }
                expect(ws.readyState).toBe(WebSocket.CLOSING);

                ws.close();
                ws.send('late');
                expect(ws.bufferedAmount).toBe(4);

                for (const conn of held) conn.close(null);
                const event = await closed;

                expect(event.code).toBe(4001);
                expect(event.reason).toBe('bye');
                // The handshake completed; a non-1000 code is still clean.
                expect(event.wasClean).toBe(true);
                expect(criticals).toBe(0);
            } finally {
                GLib.log_remove_handler('libsoup', handler);
                service.stop();
            }
        });

        await it('[kAbort] drops the connection without a Close frame (1006)', async () => {
            const server = new Soup.Server({});
            const serverClosed = new Promise<number>((resolve) => {
                server.add_websocket_handler(
                    '/ws',
                    null,
                    null,
                    (_srv: Soup.Server, _msg: Soup.ServerMessage, _path: string, conn: Soup.WebsocketConnection) => {
                        conn.connect('closed', () => resolve(conn.get_close_code()));
                    },
                );
            });
            server.listen_local(0, Soup.ServerListenOptions.IPV4_ONLY);
            const port = (server.get_listeners()[0].get_local_address() as Gio.InetSocketAddress).get_port();

            let criticals = 0;
            const levels = GLib.LogLevelFlags.LEVEL_CRITICAL | GLib.LogLevelFlags.LEVEL_WARNING;
            const handler = GLib.log_set_handler('libsoup', levels, () => {
                criticals++;
            });
            try {
                const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
                let closeCount = 0;
                const closed = new Promise<CloseEvent>((resolve) => {
                    ws.onclose = (event: CloseEvent) => {
                        closeCount++;
                        resolve(event);
                    };
                });
                await new Promise<void>((resolve, reject) => {
                    ws.onopen = () => resolve();
                    ws.onerror = () => reject(new Error('WebSocket error'));
                });
                ws[kAbort]();
                expect(ws.readyState).toBe(WebSocket.CLOSING);
                const event = await closed;
                // No Close frame reached the server: Soup reports no code.
                expect(await serverClosed).toBe(0);
                await new Promise((r) => setTimeout(r, 50));

                expect(event.code).toBe(1006);
                expect(event.wasClean).toBe(false);
                expect(closeCount).toBe(1);
                expect(criticals).toBe(0);
            } finally {
                GLib.log_remove_handler('libsoup', handler);
                server.disconnect();
            }
        });
    });

    // --- Module exports ---
    await describe('WebSocket module exports', async () => {
        await it('should export WebSocket class', async () => {
            expect(typeof WebSocket).toBe('function');
        });

        await it('should export MessageEvent class', async () => {
            expect(typeof MessageEvent).toBe('function');
        });

        await it('should export CloseEvent class', async () => {
            expect(typeof CloseEvent).toBe('function');
        });
    });
};
