// Response-body PARTIAL_INPUT regression for @gjsify/fetch — GJS-only.
//
// Bug: fetch() failed to read SOME response bodies with
//   Gio.IOErrorEnum: Weitere Eingaben erforderlich   (G_IO_ERROR_PARTIAL_INPUT)
// Norman's accounting API responses tripped it while Qonto/Paperless were fine,
// and the exact same code path worked on Node. The trigger is a *response shape*
// the libsoup/zlib body reader mishandles at the tail — not the endpoint.
//
// Two independent places raise G_IO_ERROR_PARTIAL_INPUT (code 34) at end-of-body
// even though the full payload has already been produced:
//
//   1. Soup's chunked/length body input stream, when the server closes the
//      socket without the terminating `0\r\n\r\n` chunk (or sends fewer bytes
//      than a declared Content-Length). Surfaces as
//      "Die Verbindung wurde unerwartet beendet" but matches PARTIAL_INPUT.
//
//   2. Gio.ZlibDecompressor (the GConverter backing node:zlib's gunzip/inflate,
//      reached via fetch's DecompressionStream branch for gzip/deflate
//      Content-Encoding) when the compressed stream's trailer (gzip CRC32+ISIZE
//      / zlib adler tail) is missing — it has already emitted 100% of the
//      decompressed bytes. THIS is the literal "Weitere Eingaben erforderlich".
//
// A real server that closes the keep-alive connection a touch early (or omits
// the chunk terminator under load) hits both. The body reader must treat a
// tail-only PARTIAL_INPUT as a clean EOF and return the bytes already delivered,
// exactly as Node's lenient stream/zlib paths do.
//
// This suite drives the REAL fetch() against a raw Gio.SocketService server so
// every byte on the wire is controlled. No external host is contacted.
//
// GJS-only (`.gjs.spec.ts`): the body runs under on('Gjs', …) and reads all GJS
// runtime objects from globalThis.imports so the Node bundle (same test.mts
// aggregator) never resolves gi://*.

import { describe, it, expect, on } from '@gjsify/unit';
import type GLibNS from '@girs/glib-2.0';
import type GioNS from '@girs/gio-2.0';

interface GjsImports {
    gi: {
        versions: Record<string, string>;
        GLib: typeof GLibNS;
        Gio: typeof GioNS;
    };
}

const enc = (s: string) => new TextEncoder().encode(s);

function concatBytes(...arrs: Uint8Array[]): Uint8Array {
    const total = arrs.reduce((n, a) => n + a.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const a of arrs) {
        out.set(a, off);
        off += a.length;
    }
    return out;
}

export default async () => {
    await on('Gjs', async () => {
        const gjs = (globalThis as unknown as { imports: GjsImports }).imports;
        const GLib = gjs.gi.GLib;
        const Gio = gjs.gi.Gio;
        const fetchFn = (globalThis as unknown as { fetch: typeof fetch }).fetch;

        /** gzip `bytes` via Gio so the test does not depend on the polyfill it tests. */
        const gzip = (bytes: Uint8Array): Uint8Array => {
            const comp = Gio.ZlibCompressor.new(Gio.ZlibCompressorFormat.GZIP, -1);
            const mem = Gio.MemoryOutputStream.new_resizable();
            const cs = Gio.ConverterOutputStream.new(mem, comp) as GioNS.ConverterOutputStream;
            cs.write_all(bytes, null);
            cs.flush(null);
            cs.close(null);
            return (mem.steal_as_bytes().toArray() as Uint8Array).slice();
        };

        const deflate = (bytes: Uint8Array): Uint8Array => {
            const comp = Gio.ZlibCompressor.new(Gio.ZlibCompressorFormat.ZLIB, -1);
            const mem = Gio.MemoryOutputStream.new_resizable();
            const cs = Gio.ConverterOutputStream.new(mem, comp) as GioNS.ConverterOutputStream;
            cs.write_all(bytes, null);
            cs.flush(null);
            cs.close(null);
            return (mem.steal_as_bytes().toArray() as Uint8Array).slice();
        };

        /**
         * Start a raw TCP server that answers the first (and only) request on each
         * connection with exactly `responseBytes`, then closes the socket. Returns
         * the bound origin and a stop() fn. The framing is entirely up to the
         * caller — that is the whole point.
         */
        const startRawServer = (responseBytes: Uint8Array): { base: string; stop: () => void } => {
            const service = new Gio.SocketService();
            const port = service.add_any_inet_port(null);
            service.connect('incoming', (_svc: GioNS.SocketService, conn: GioNS.SocketConnection) => {
                const input = conn.get_input_stream();
                const output = conn.get_output_stream();
                // Drain the request headers, then write the canned bytes and close.
                input.read_bytes_async(65536, GLib.PRIORITY_DEFAULT, null, (s, r) => {
                    try {
                        (s as GioNS.InputStream).read_bytes_finish(r);
                    } catch {
                        /* ignore request-read errors */
                    }
                    output.write_bytes_async(new GLib.Bytes(responseBytes), GLib.PRIORITY_DEFAULT, null, (os, or) => {
                        try {
                            (os as GioNS.OutputStream).write_bytes_finish(or);
                        } catch {
                            /* ignore */
                        }
                        // Close WITHOUT any graceful HTTP framing beyond what the
                        // caller put in responseBytes.
                        try {
                            conn.close(null);
                        } catch {
                            /* ignore */
                        }
                    });
                });
                return false;
            });
            service.start();
            const base = `http://127.0.0.1:${port}/`;
            return {
                base,
                stop: () => {
                    try {
                        service.stop();
                        service.close();
                    } catch {
                        /* ignore */
                    }
                },
            };
        };

        const PAYLOAD = JSON.stringify({
            hello: 'world',
            items: [1, 2, 3, 4, 5],
            // Long enough that gzip actually produces a multi-byte deflate block.
            note: 'gjsify-fetch-partial-input-'.repeat(40),
        });

        // A payload whose GZIPPED form exceeds the body reader's 4096-byte read
        // size, so the compressed stream is delivered to DecompressionStream in
        // SEVERAL chunks. This is the primary Norman trigger: stateless per-chunk
        // decompression breaks here (the first chunk alone is not a complete gzip
        // stream) while native Node keeps inflate state across chunks. The body
        // mixes structure + varied text so gzip can't collapse it below 4 KB.
        const bigItems: { id: number; name: string; amount: string; memo: string }[] = [];
        for (let i = 0; i < 500; i++) {
            bigItems.push({
                id: i,
                name: `transaction ${i}`,
                amount: (i * 3.14159).toFixed(2),
                memo: `Rechnung Nr ${i} für Leistung im Monat ${(i % 12) + 1}`,
            });
        }
        const BIG_PAYLOAD = JSON.stringify({ ok: true, items: bigItems });

        await describe('@gjsify/fetch — response body PARTIAL_INPUT at EOF (Norman regression)', async () => {
            await it('reads a chunked body terminated cleanly (baseline)', async () => {
                const body = enc(
                    'HTTP/1.1 200 OK\r\n' +
                        'Content-Type: application/json\r\n' +
                        'Transfer-Encoding: chunked\r\n' +
                        '\r\n' +
                        PAYLOAD.length.toString(16) +
                        '\r\n' +
                        PAYLOAD +
                        '\r\n0\r\n\r\n',
                );
                const srv = startRawServer(body);
                try {
                    const res = await fetchFn(srv.base);
                    const text = await res.text();
                    expect(text).toBe(PAYLOAD);
                } finally {
                    srv.stop();
                }
            });

            await it('reads a chunked body whose terminating 0-chunk never arrives', async () => {
                // Server streamed the whole payload then dropped the connection
                // without `0\r\n\r\n`. Soup raises PARTIAL_INPUT on the final read;
                // all bytes were already delivered, so .text() must still be whole.
                const body = enc(
                    'HTTP/1.1 200 OK\r\n' +
                        'Content-Type: application/json\r\n' +
                        'Transfer-Encoding: chunked\r\n' +
                        '\r\n' +
                        PAYLOAD.length.toString(16) +
                        '\r\n' +
                        PAYLOAD,
                    // no trailing CRLF, no 0\r\n\r\n
                );
                const srv = startRawServer(body);
                try {
                    const res = await fetchFn(srv.base);
                    const json = (await res.json()) as { hello: string };
                    expect(json.hello).toBe('world');
                } finally {
                    srv.stop();
                }
            });

            await it('reads a Content-Length body that closes one frame early', async () => {
                const body = enc(
                    'HTTP/1.1 200 OK\r\n' +
                        'Content-Type: application/json\r\n' +
                        'Content-Length: ' +
                        (PAYLOAD.length + 16) + // server lies: promises more than it sends
                        '\r\n\r\n' +
                        PAYLOAD,
                );
                const srv = startRawServer(body);
                try {
                    const res = await fetchFn(srv.base);
                    const text = await res.text();
                    expect(text).toBe(PAYLOAD);
                } finally {
                    srv.stop();
                }
            });

            await it('reads a read-to-close body (no length, Connection: close)', async () => {
                const body = enc(
                    'HTTP/1.1 200 OK\r\n' +
                        'Content-Type: application/json\r\n' +
                        'Connection: close\r\n' +
                        '\r\n' +
                        PAYLOAD,
                );
                const srv = startRawServer(body);
                try {
                    const res = await fetchFn(srv.base);
                    const text = await res.text();
                    expect(text).toBe(PAYLOAD);
                } finally {
                    srv.stop();
                }
            });

            await it('decodes a clean gzip body (Content-Encoding: gzip, chunked)', async () => {
                const gz = gzip(enc(PAYLOAD));
                const body = concatBytes(
                    enc(
                        'HTTP/1.1 200 OK\r\n' +
                            'Content-Type: application/json\r\n' +
                            'Content-Encoding: gzip\r\n' +
                            'Transfer-Encoding: chunked\r\n' +
                            '\r\n' +
                            gz.length.toString(16) +
                            '\r\n',
                    ),
                    gz,
                    enc('\r\n0\r\n\r\n'),
                );
                const srv = startRawServer(body);
                try {
                    const res = await fetchFn(srv.base);
                    const text = await res.text();
                    expect(text).toBe(PAYLOAD);
                } finally {
                    srv.stop();
                }
            });

            await it('decodes a gzip body that spans multiple read chunks', async () => {
                // The primary Norman shape: a complete, well-framed gzip response
                // whose compressed size (> 4 KB) forces the body reader to deliver
                // it in several chunks. Per-chunk decompression throws
                // "Ungültige komprimierte Daten" / "Weitere Eingaben erforderlich"
                // here; the streaming decode must reassemble the full payload.
                const gz = gzip(enc(BIG_PAYLOAD));
                expect(gz.length > 4096).toBe(true); // guard: actually multi-chunk
                const body = concatBytes(
                    enc(
                        'HTTP/1.1 200 OK\r\n' +
                            'Content-Type: application/json\r\n' +
                            'Content-Encoding: gzip\r\n' +
                            'Content-Length: ' +
                            gz.length +
                            '\r\n\r\n',
                    ),
                    gz,
                );
                const srv = startRawServer(body);
                try {
                    const res = await fetchFn(srv.base);
                    const text = await res.text();
                    expect(text.length).toBe(BIG_PAYLOAD.length);
                    expect(text).toBe(BIG_PAYLOAD);
                } finally {
                    srv.stop();
                }
            });

            await it('decodes a deflate body that spans multiple read chunks', async () => {
                // Same multi-chunk reassembly for Content-Encoding: deflate.
                const df = deflate(enc(BIG_PAYLOAD));
                expect(df.length > 4096).toBe(true);
                const body = concatBytes(
                    enc(
                        'HTTP/1.1 200 OK\r\n' +
                            'Content-Type: application/json\r\n' +
                            'Content-Encoding: deflate\r\n' +
                            'Content-Length: ' +
                            df.length +
                            '\r\n\r\n',
                    ),
                    df,
                );
                const srv = startRawServer(body);
                try {
                    const res = await fetchFn(srv.base);
                    const text = await res.text();
                    expect(text).toBe(BIG_PAYLOAD);
                } finally {
                    srv.stop();
                }
            });
        });
    });
};
