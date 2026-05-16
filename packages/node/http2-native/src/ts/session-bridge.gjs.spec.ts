// Phase-0 spec for @gjsify/http2-native's SessionBridge.
//
// Drives a server + client SessionBridge pair through the GLib main loop,
// pipes bytes between them with no socket involved, and asserts the full
// HTTP/2 handshake + request/response shape that the Phase-1 dispatcher
// (`@gjsify/http2`'s native-dispatcher.ts) builds on top.
//
// All tests run on GJS only — the bridge is a native typelib.

import { describe, it, expect, on } from '@gjsify/unit';

const PREFACE_BYTES = 24;

export default async function () {
    await on('Gjs', async () => {
        const GjsifyHttp2 = (await import('gi://GjsifyHttp2?version=1.0')).default;
        const GLib = (await import('gi://GLib?version=2.0')).default;

        function bytesToString(b: any): string {
            const data = b.get_data();
            return new TextDecoder().decode(data);
        }

        function bytesFromString(s: string): any {
            return GLib.Bytes.new(new TextEncoder().encode(s));
        }

        // Pipe the two bridges until neither side has pending output or events.
        // Synchronous: we drive `dispatch_pending()` instead of spinning the
        // GLib main loop so tests stay deterministic.
        function pump(client: any, server: any, maxIters = 100): number {
            let iters = 0;
            let progress = true;
            while (progress && iters < maxIters) {
                progress = false;
                const c = client.drain_output();
                if (c.get_size() > 0) {
                    server.feed_input(c);
                    server.dispatch_pending();
                    progress = true;
                }
                const s = server.drain_output();
                if (s.get_size() > 0) {
                    client.feed_input(s);
                    client.dispatch_pending();
                    progress = true;
                }
                iters++;
            }
            return iters;
        }

        await describe('FrameEncoder.nghttp2 link', async () => {
            await it('reports a valid libnghttp2 version', () => {
                const fe = new GjsifyHttp2.FrameEncoder();
                const v = fe.nghttp2_version();
                expect(typeof v).toBe('string');
                expect(v.length).toBeGreaterThan(0);
                // Sanity: "1.x.y" format
                expect(/^\d+\.\d+(\.\d+)?/.test(v)).toBe(true);
            });
        });

        await describe('FrameEncoder.build_* — frame builders', async () => {
            await it('builds SETTINGS frame (no ack)', () => {
                const fe = new GjsifyHttp2.FrameEncoder();
                const frame = fe.build_settings_frame(false, [3, 4], [100, 65535]);
                expect(frame.get_size()).toBe(9 + 12); // 9-byte header + 2×6-byte entries
                const arr = frame.get_data() as Uint8Array;
                // length=12 in 24-bit BE
                expect(arr[0]).toBe(0);
                expect(arr[1]).toBe(0);
                expect(arr[2]).toBe(12);
                // type=4 (SETTINGS)
                expect(arr[3]).toBe(4);
                // flags=0
                expect(arr[4]).toBe(0);
            });

            await it('builds SETTINGS-ACK frame', () => {
                const fe = new GjsifyHttp2.FrameEncoder();
                const frame = fe.build_settings_frame(true, [], []);
                expect(frame.get_size()).toBe(9);
                const arr = frame.get_data() as Uint8Array;
                expect(arr[3]).toBe(4); // SETTINGS
                expect(arr[4]).toBe(1); // ACK flag
            });

            await it('builds WINDOW_UPDATE frame', () => {
                const fe = new GjsifyHttp2.FrameEncoder();
                const frame = fe.build_window_update_frame(1, 65535);
                expect(frame.get_size()).toBe(9 + 4);
                const arr = frame.get_data() as Uint8Array;
                expect(arr[3]).toBe(8); // WINDOW_UPDATE
                // stream id 1
                expect(arr[8]).toBe(1);
                // increment 65535 in last 4 bytes
                expect(arr[9]).toBe(0);
                expect(arr[10]).toBe(0);
                expect(arr[11]).toBe(0xff);
                expect(arr[12]).toBe(0xff);
            });

            await it('builds PING frame (8-byte payload)', () => {
                const fe = new GjsifyHttp2.FrameEncoder();
                const payload = GLib.Bytes.new(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
                const frame = fe.build_ping_frame(false, payload);
                expect(frame.get_size()).toBe(9 + 8);
                const arr = frame.get_data() as Uint8Array;
                expect(arr[3]).toBe(6); // PING
                expect(arr[4]).toBe(0);
                for (let i = 0; i < 8; i++) expect(arr[9 + i]).toBe(i + 1);
            });

            await it('builds RST_STREAM frame', () => {
                const fe = new GjsifyHttp2.FrameEncoder();
                const frame = fe.build_rst_stream_frame(3, 8); // CANCEL=8
                expect(frame.get_size()).toBe(9 + 4);
                const arr = frame.get_data() as Uint8Array;
                expect(arr[3]).toBe(3); // RST_STREAM
                expect(arr[8]).toBe(3); // stream id
                expect(arr[12]).toBe(8); // error code
            });

            await it('builds GOAWAY frame', () => {
                const fe = new GjsifyHttp2.FrameEncoder();
                const frame = fe.build_goaway_frame(7, 0, null);
                expect(frame.get_size()).toBe(9 + 8);
                const arr = frame.get_data() as Uint8Array;
                expect(arr[3]).toBe(7); // GOAWAY
                // last stream id 7 in last byte of first 4 of payload
                expect(arr[12]).toBe(7);
                // error code 0
                for (let i = 13; i < 17; i++) expect(arr[i]).toBe(0);
            });
        });

        await describe('SessionBridge construction', async () => {
            await it('creates a server bridge with SETTINGS queued', () => {
                const s = GjsifyHttp2.SessionBridge.new_server();
                expect(s).not.toBe(null);
                expect(s!.want_write()).toBe(true);
                const out = s!.drain_output();
                // 9-byte SETTINGS frame
                expect(out.get_size()).toBe(9);
                const arr = out.get_data() as Uint8Array;
                expect(arr[3]).toBe(4); // SETTINGS type
                s!.close();
            });

            await it('creates a client bridge with preface + SETTINGS queued', () => {
                const c = GjsifyHttp2.SessionBridge.new_client();
                expect(c).not.toBe(null);
                expect(c!.want_write()).toBe(true);
                const out = c!.drain_output();
                // 24-byte preface + 9-byte SETTINGS = 33
                expect(out.get_size()).toBe(PREFACE_BYTES + 9);
                c!.close();
            });
        });

        await describe('SessionBridge.is_client_preface', async () => {
            await it('detects the RFC 7540 §3.5 preface', () => {
                const ok = GjsifyHttp2.SessionBridge.is_client_preface(
                    bytesFromString('PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n'),
                );
                expect(ok).toBe(true);
            });

            await it('rejects non-preface bytes', () => {
                const no = GjsifyHttp2.SessionBridge.is_client_preface(
                    bytesFromString('GET / HTTP/1.1\r\n\r\nfoobar..\r\n'),
                );
                expect(no).toBe(false);
            });

            await it('rejects short input', () => {
                const no = GjsifyHttp2.SessionBridge.is_client_preface(
                    bytesFromString('PRI * HTTP/2.0'),
                );
                expect(no).toBe(false);
            });

            await it('preface_length() returns 24', () => {
                expect(GjsifyHttp2.SessionBridge.preface_length()).toBe(24);
            });
        });

        await describe('SessionBridge — full client↔server handshake', async () => {
            await it('completes preface + SETTINGS exchange', () => {
                const server = GjsifyHttp2.SessionBridge.new_server();
                const client = GjsifyHttp2.SessionBridge.new_client();
                expect(server).not.toBe(null);
                expect(client).not.toBe(null);

                const iters = pump(client!, server!);
                // Two rounds at most: client→server (preface+SETTINGS),
                // server→client (SETTINGS + SETTINGS-ACK), client→server (ACK).
                expect(iters).toBeLessThan(10);

                // Both sides settled.
                expect(client!.drain_output().get_size()).toBe(0);
                expect(server!.drain_output().get_size()).toBe(0);

                client!.close();
                server!.close();
            });

            await it('routes a request → response round-trip with body', () => {
                const server = GjsifyHttp2.SessionBridge.new_server();
                const client = GjsifyHttp2.SessionBridge.new_client();
                expect(server).not.toBe(null);
                expect(client).not.toBe(null);

                let serverHeaders: Array<[string, string]> | null = null;
                let serverEndStream = false;
                server!.connect('headers_received', (_b: unknown, _sid: number, headers: any, endStr: boolean) => {
                    serverHeaders = headers.deep_unpack();
                    serverEndStream = endStr;
                });

                let clientHeaders: Array<[string, string]> | null = null;
                const clientChunks: string[] = [];
                let clientEndStream = false;
                client!.connect('headers_received', (_b: unknown, _sid: number, headers: any) => {
                    clientHeaders = headers.deep_unpack();
                });
                client!.connect('data_received', (_b: unknown, _sid: number, chunk: any, endStr: boolean) => {
                    if (chunk.get_size() > 0) clientChunks.push(bytesToString(chunk));
                    if (endStr) clientEndStream = true;
                });

                // Client → request.
                const reqId = client!.submit_request(
                    [':method', ':scheme', ':authority', ':path'],
                    ['GET', 'http', 'example.test', '/echo'],
                    true,
                );
                expect(reqId).toBe(1); // First client stream is always 1.

                pump(client!, server!);

                expect(serverHeaders).not.toBe(null);
                expect(serverEndStream).toBe(true);
                // :method GET, :scheme http, :authority example.test, :path /echo
                const headersObj: Record<string, string> = {};
                for (const [k, v] of serverHeaders!) headersObj[k] = v;
                expect(headersObj[':method']).toBe('GET');
                expect(headersObj[':path']).toBe('/echo');

                // Server → response + body.
                const rv = server!.submit_response(
                    reqId,
                    [':status', 'content-type'],
                    ['200', 'text/plain'],
                    false,
                );
                expect(rv).toBe(0);
                const body = bytesFromString('hello from session-bridge');
                const rv2 = server!.submit_data(reqId, body, true);
                expect(rv2).toBe(0);

                pump(client!, server!);

                expect(clientHeaders).not.toBe(null);
                const respObj: Record<string, string> = {};
                for (const [k, v] of clientHeaders!) respObj[k] = v;
                expect(respObj[':status']).toBe('200');
                expect(clientChunks.join('')).toBe('hello from session-bridge');
                expect(clientEndStream).toBe(true);

                client!.close();
                server!.close();
            });

            await it('GOAWAY: server.close → client sees goaway_received', () => {
                const server = GjsifyHttp2.SessionBridge.new_server();
                const client = GjsifyHttp2.SessionBridge.new_client();

                // Complete handshake first.
                pump(client!, server!);

                let gotGoaway: { last: number; error: number } | null = null;
                client!.connect('goaway_received', (_b: unknown, lastSid: number, errorCode: number) => {
                    gotGoaway = { last: lastSid, error: errorCode };
                });

                const rv = server!.submit_goaway(0, 0); // NO_ERROR
                expect(rv).toBe(0);
                pump(client!, server!);

                expect(gotGoaway).not.toBe(null);
                expect(gotGoaway!.error).toBe(0);

                client!.close();
                server!.close();
            });
        });

        await describe('StreamIdAllocator', async () => {
            await it('emits even ids starting at 2', () => {
                const a = new GjsifyHttp2.StreamIdAllocator();
                expect(a.next_promised()).toBe(2);
                expect(a.next_promised()).toBe(4);
                expect(a.next_promised()).toBe(6);
            });

            await it('tracks the highest odd client id', () => {
                const a = new GjsifyHttp2.StreamIdAllocator();
                a.record_client_stream(1);
                a.record_client_stream(5);
                a.record_client_stream(3); // out of order
                expect(a.last_client_stream_id).toBe(5);
            });

            await it('ignores even ids in record_client_stream', () => {
                const a = new GjsifyHttp2.StreamIdAllocator();
                a.record_client_stream(2);
                expect(a.last_client_stream_id).toBe(0);
            });
        });
    });
}
