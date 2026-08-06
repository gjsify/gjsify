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
