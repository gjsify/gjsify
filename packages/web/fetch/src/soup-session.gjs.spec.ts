// Soup.Session lifecycle for GJS for @gjsify/fetch — original regression test.
//
// Regression: @gjsify/fetch used to create a fresh `new Soup.Session()` inside
// every Request constructor. Once the Response body was read, that per-request
// session became unreachable and SpiderMonkey could finalize it on the next GC
// sweep while a libsoup connection was still registered on its host. libsoup's
// connection-manager teardown then asserted `host->conns == NULL` and printed:
//
//   (gjs:…): libsoup-CRITICAL **: runtime check failed: (host->conns == NULL)
//
// on stderr during heavy fetch use (notably @gjsify/npm-registry's packument/
// tarball fetches inside `gjsify install`). The fix holds ONE process-wide
// `Soup.Session` at module scope so it is never GC-finalized mid-flight.
//
// This file is GJS-only (`.gjs.spec.ts`). The suite body runs under
// `on('Gjs', …)`, so it is a no-op on Node. To keep the Node bundle free of
// `gi://*` / `system` imports (the same `test.mts` aggregator drives
// `test:node`), all GJS runtime objects are read from `globalThis.imports`
// (the GJS bootstrap) rather than statically imported — type-only imports give
// us the real shapes at compile time and are stripped at runtime.

import { describe, it, expect, on } from '@gjsify/unit';
import type SoupNS from '@girs/soup-3.0';
import type GLibNS from '@girs/glib-2.0';
import type GioNS from '@girs/gio-2.0';
// The GJS Request class + fetch() — type-only here so Node never resolves them;
// inside on('Gjs') we re-read them through globalThis where they are real.
import type { Request as GjsRequest } from './request.js';

interface GjsImports {
    gi: {
        versions: Record<string, string>;
        Soup: typeof SoupNS;
        GLib: typeof GLibNS;
        Gio: typeof GioNS;
    };
    system: { gc: () => void };
}

export default async () => {
    await on('Gjs', async () => {
        // Read GJS runtime objects lazily (no static gi:// import → Node bundle
        // stays clean). `imports` is the GJS bootstrap global.
        const gjs = (globalThis as unknown as { imports: GjsImports }).imports;
        const Soup = gjs.gi.Soup;
        const GLib = gjs.gi.GLib;
        const Gio = gjs.gi.Gio;
        const System = gjs.system;
        // Request + fetch are installed as globals by `@gjsify/fetch/register`,
        // pulled into the test bundle by test.mts.
        const RequestCtor = (globalThis as unknown as { Request: typeof GjsRequest }).Request;
        const fetchFn = (globalThis as unknown as { fetch: typeof fetch }).fetch;

        await describe('@gjsify/fetch — Soup.Session lifecycle (host->conns regression)', async () => {
            await it('reuses one shared Soup.Session across HTTP requests (no per-request session)', async () => {
                // Two distinct HTTP Requests must share the very same Soup.Session
                // instance. A per-request session is what triggered the GC race;
                // a shared singleton can never be finalized while in use.
                //
                // The session is created lazily on first SEND (deferred from the
                // Request constructor so that importing @gjsify/fetch links no
                // `gi://Soup` typelib — see utils/soup-lazy.ts). So drive two real
                // sends against a local server and assert the invariant where the
                // sessions actually live; `_session` is null before send.
                const server = new Soup.Server({});
                server.add_handler(null, (_s: unknown, msg: SoupNS.ServerMessage) => {
                    msg.set_status(200, null);
                    msg.set_response('application/json', Soup.MemoryUse.COPY, new TextEncoder().encode('{}'));
                });
                server.listen_local(0, Soup.ServerListenOptions.IPV4_ONLY);
                const base = server.get_uris()[0].to_string();

                try {
                    const a = new RequestCtor(base);
                    const b = new RequestCtor(base);
                    // Before any send, no Soup object is allocated.
                    expect(a._session).toBeNull();
                    const ra = await a._send({ headers: a.headers });
                    const rb = await b._send({ headers: b.headers });
                    ra.readable.resume();
                    rb.readable.resume();
                    expect(a._session).toBeTruthy();
                    expect(b._session).toBeTruthy();
                    expect(a._session === b._session).toBe(true);
                    expect(a._session instanceof Soup.Session).toBe(true);
                } finally {
                    server.disconnect();
                }
            });

            await it('non-HTTP requests do not allocate a Soup.Session', () => {
                const dataReq = new RequestCtor('data:text/plain,hi');
                expect(dataReq._session).toBeNull();
            });

            await it('many fetches + GC against a local server emit no host->conns / libsoup-CRITICAL warning', async () => {
                // Exercise the live fetch path in-process first (the exact
                // lifecycle: fetch → read body → drop refs → GC).
                const server = new Soup.Server({});
                server.add_handler(null, (_srv: unknown, msg: SoupNS.ServerMessage) => {
                    msg.set_status(200, null);
                    msg.set_response('application/json', Soup.MemoryUse.COPY, new TextEncoder().encode('{"ok":true}'));
                });
                server.listen_local(0, Soup.ServerListenOptions.IPV4_ONLY);
                const base = server.get_uris()[0].to_string();

                for (let i = 0; i < 12; i++) {
                    const res = await fetchFn(base);
                    await res.json();
                    System.gc();
                }
                System.gc();
                System.gc();

                // Stronger assertion: run the same loop in a child gjs process and
                // capture its stderr, so we can assert the libsoup warning is
                // absent (GJS cannot redirect its own fd 2). The worker imports
                // this package's built bundle by absolute path. If the bundle is
                // not built (running specs from src only), skip the subprocess —
                // the shared-session invariant above is the load-bearing check.
                const pkgRoot = GLib.path_get_dirname(
                    GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]),
                );
                const fetchEntry = `${pkgRoot}/lib/esm/index.js`;
                if (!GLib.file_test(fetchEntry, GLib.FileTest.EXISTS)) {
                    expect(true).toBe(true);
                    return;
                }

                const worker = `
                    imports.gi.versions.Soup = '3.0';
                    const { Soup, GLib } = imports.gi;
                    const System = imports.system;
                    const { default: fetch } = await import(${JSON.stringify('file://' + fetchEntry)});
                    const server = new Soup.Server({});
                    server.add_handler(null, (_s, msg) => {
                        msg.set_status(200, null);
                        msg.set_response('application/json', Soup.MemoryUse.COPY,
                            new TextEncoder().encode('{"ok":true}'));
                    });
                    server.listen_local(0, Soup.ServerListenOptions.IPV4_ONLY);
                    const base = server.get_uris()[0].to_string();
                    for (let i = 0; i < 20; i++) {
                        const res = await fetch(base);
                        await res.json();
                        System.gc();
                    }
                    System.gc(); System.gc();
                `;
                const proc = Gio.Subprocess.new(
                    ['gjs', '-m', '-c', worker],
                    Gio.SubprocessFlags.STDERR_PIPE | Gio.SubprocessFlags.STDOUT_SILENCE,
                );
                const stderrBytes: Uint8Array = await new Promise((resolve, reject) => {
                    proc.communicate_async(null, null, (p: GioNS.Subprocess | null, r: GioNS.AsyncResult) => {
                        try {
                            const [, , stderr] = p!.communicate_finish(r);
                            resolve(stderr ? (stderr.toArray() as Uint8Array) : new Uint8Array());
                        } catch (e) {
                            reject(e instanceof Error ? e : new Error(String(e)));
                        }
                    });
                });
                const stderr = new TextDecoder().decode(stderrBytes);
                expect(stderr.includes('host->conns')).toBe(false);
                expect(stderr.includes('libsoup-CRITICAL')).toBe(false);
            });
        });

        // Regression: libsoup 3 hands a connection back to the pool only when the
        // response body stream is CLOSED — reading it to EOF merely marks the body
        // done. @gjsify/fetch read bodies to EOF and never closed the stream, so
        // every fetch pinned its connection IN_USE until SpiderMonkey happened to
        // finalize the stream. Keep-alive reuse never happened, and once the
        // shared session's `max-conns` (64) were pinned against servers that had
        // since gone away, the next fetch queued forever. socket.io's polling
        // transport hit that wall ~30 tests into its integration suite on macOS,
        // where GC ran too rarely to rescue it.
        await describe('@gjsify/fetch — body streams release their pooled connection', async () => {
            const startServer = () => {
                const ports: number[] = [];
                const server = new Soup.Server({});
                server.add_handler(null, (_s: unknown, msg: SoupNS.ServerMessage) => {
                    ports.push((msg.get_remote_address() as GioNS.InetSocketAddress).get_port());
                    msg.set_status(200, null);
                    msg.set_response('text/plain', Soup.MemoryUse.COPY, new TextEncoder().encode('ok'));
                });
                server.listen_local(0, Soup.ServerListenOptions.IPV4_ONLY);
                return { server, ports, base: server.get_uris()[0].to_string() };
            };

            await it('reuses the keep-alive connection once a body has been read', async () => {
                const { server, ports, base } = startServer();
                // fetch defaults to `Connection: close` (node-fetch heritage), so
                // opt into keep-alive to observe the connection going back to the pool.
                const init = { headers: { Connection: 'keep-alive' } };
                try {
                    await (await fetchFn(base, init)).text();
                    await (await fetchFn(base, init)).arrayBuffer();
                    await (await fetchFn(base, init)).text();
                    expect(ports.length).toBe(3);
                    // One client port = one connection, handed back and reused.
                    expect(new Set(ports).size).toBe(1);
                } finally {
                    server.disconnect();
                }
            });

            await it('does not exhaust the pool against servers that have gone away', async () => {
                // More servers than the shared session's default max-conns (64):
                // each leaves one idle keep-alive connection behind. Idle ones are
                // reclaimable; pinned ones made fetch #65 wait forever.
                let completed = 0;
                for (let i = 0; i < 70; i++) {
                    const { server, base } = startServer();
                    const ctrl = new AbortController();
                    const timer = setTimeout(() => ctrl.abort(), 2000);
                    try {
                        await (await fetchFn(base, { signal: ctrl.signal })).text();
                        completed++;
                    } catch {
                        break;
                    } finally {
                        clearTimeout(timer);
                        server.disconnect();
                    }
                }
                expect(completed).toBe(70);
            });

            await it('drains a followed redirect so the next hop reuses its connection', async () => {
                const ports: number[] = [];
                const server = new Soup.Server({});
                server.add_handler(null, (_s: unknown, msg: SoupNS.ServerMessage) => {
                    ports.push((msg.get_remote_address() as GioNS.InetSocketAddress).get_port());
                    if (msg.get_uri().get_path() === '/moved') {
                        msg.set_redirect(307, '/target');
                        // A non-empty body: libsoup completes an empty one without a stream close.
                        msg.set_response('text/plain', Soup.MemoryUse.COPY, new TextEncoder().encode('moved'));
                    } else {
                        msg.set_status(200, null);
                        msg.set_response('text/plain', Soup.MemoryUse.COPY, new TextEncoder().encode('ok'));
                    }
                });
                server.listen_local(0, Soup.ServerListenOptions.IPV4_ONLY);
                const base = server.get_uris()[0].to_string();
                try {
                    // libsoup follows safe-method redirects itself; a 307 on PUT is
                    // left to fetch's own redirect step, the path under test.
                    const res = await fetchFn(`${base}moved`, { method: 'PUT', headers: { Connection: 'keep-alive' } });
                    expect(await res.text()).toBe('ok');
                    expect(ports.length).toBe(2);
                    // Nobody reads a redirect's body; left open it pinned its connection.
                    expect(new Set(ports).size).toBe(1);
                } finally {
                    server.disconnect();
                }
            });

            // A body read parked on a server that has gone quiet (long-poll, SSE)
            // kept the stream open past body.cancel(): close() cannot run while
            // a read is pending, so the connection stayed pinned. Cancel one
            // such body per per-host slot (DEFAULT_MAX_CONNS_PER_HOST = 16);
            // pinned, they leave no slot for the request after them.
            await it('releases the connection when a body is cancelled mid-stream', async () => {
                const server = new Soup.Server({});
                server.add_handler(null, (_s: unknown, msg: SoupNS.ServerMessage) => {
                    msg.set_status(200, null);
                    if (msg.get_uri().get_path() === '/stream') {
                        msg.get_response_headers().set_encoding(Soup.Encoding.CHUNKED);
                        // No complete(): the response stays open with nothing more to read.
                        msg.get_response_body().append(new TextEncoder().encode('first'));
                    } else {
                        msg.set_response('text/plain', Soup.MemoryUse.COPY, new TextEncoder().encode('ok'));
                    }
                });
                server.listen_local(0, Soup.ServerListenOptions.IPV4_ONLY);
                const base = server.get_uris()[0].to_string();
                try {
                    for (let i = 0; i < 16; i++) {
                        const res = await fetchFn(`${base}stream`);
                        const reader = res.body!.getReader();
                        const first = await reader.read();
                        expect(new TextDecoder().decode(first.value)).toBe('first');
                        await reader.cancel();
                    }
                    const ctrl = new AbortController();
                    const timer = setTimeout(() => ctrl.abort(), 2000);
                    try {
                        expect(await (await fetchFn(base, { signal: ctrl.signal })).text()).toBe('ok');
                    } finally {
                        clearTimeout(timer);
                    }
                } finally {
                    server.disconnect();
                }
            });

            // libsoup does not watch the cancellable of a message still queued
            // for a connection slot, so an abort there used to hang until some
            // other request freed a slot.
            await it('rejects an aborted fetch that is still queued for a connection', async () => {
                const paused: SoupNS.ServerMessage[] = [];
                const server = new Soup.Server({});
                server.add_handler(null, (_s: unknown, msg: SoupNS.ServerMessage) => {
                    msg.pause();
                    paused.push(msg);
                });
                server.listen_local(0, Soup.ServerListenOptions.IPV4_ONLY);
                const base = server.get_uris()[0].to_string();
                // Fill every per-host slot (DEFAULT_MAX_CONNS_PER_HOST) with a hung request.
                const holders = Array.from({ length: 16 }, () => new AbortController());
                const held = holders.map((c) => fetchFn(base, { signal: c.signal }).catch(() => undefined));
                try {
                    const deadline = Date.now() + 2000;
                    while (paused.length < holders.length && Date.now() < deadline) {
                        await new Promise((r) => setTimeout(r, 20));
                    }
                    expect(paused.length).toBe(holders.length);

                    const ctrl = new AbortController();
                    const queued = fetchFn(base, { signal: ctrl.signal }).then(
                        () => 'resolved',
                        (err: Error) => err.name,
                    );
                    setTimeout(() => ctrl.abort(), 50);
                    const outcome = await Promise.race([
                        queued,
                        new Promise((r) => setTimeout(() => r('still queued'), 2000)),
                    ]);
                    expect(outcome).toBe('AbortError');
                } finally {
                    for (const c of holders) c.abort();
                    await Promise.all(held);
                    for (const msg of paused) msg.unpause();
                    server.disconnect();
                }
            });
        });

        // Regression: @gjsify/fetch re-parsed the already-encoded request URL
        // with `GLib.UriFlags.NONE`, which DECODES a second time — collapsing an
        // escaped `%2F` inside a path segment back to a literal `/`. That sent
        // `PUT /@scope/name` instead of the required `PUT /@scope%2Fname`, so
        // npm's package-CREATE route and the OIDC token-exchange endpoint
        // (`/-/npm/v1/oidc/token/exchange/package/@scope%2Fname`) 404'd — only
        // visible once the CLI began running under GJS (the Node path preserved
        // it). Fix: parse with `GLib.UriFlags.ENCODED`. See request.ts `_uri` +
        // Soup.Message construction.
        await describe('@gjsify/fetch — percent-encoded path segments (scoped-registry %2F)', async () => {
            await it('preserves %2F in the request URI instead of decoding it to a literal /', () => {
                const req = new RequestCtor('https://registry.npmjs.org/@gjsify%2Ffetch');
                const uriStr = (req as unknown as { _uri: GLibNS.Uri })._uri.to_string();
                // %2F (any hex case) must survive; the decoded literal-slash form must NOT appear.
                expect(/@gjsify%2[Ff]fetch/.test(uriStr)).toBe(true);
                expect(/@gjsify\/fetch/.test(uriStr)).toBe(false);
            });
        });
    });
};
