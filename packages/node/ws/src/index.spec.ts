// oxlint-disable typescript/no-explicit-any -- spec asserts ws's CJS post-load self-references (`(WebSocket as any).WebSocket`, `(WebSocket as any).Server`) — these properties are deliberately attached at module load by index.ts to mirror the npm `ws` shape and are not part of the published `@types/ws` named-export surface, so a cast is the right tool; typing them as `WebSocket & { WebSocket: typeof WebSocket; Server: typeof WebSocketServer }` here would couple the test to the wrapper's internal post-load surface that ESM↔CJS bridging deliberately hides on Node (the assertions wrap in `on('Gjs')` for exactly this reason)
// SPDX-License-Identifier: MIT
// Ported from refs/ws/test/websocket.test.js and websocket-server.test.js
// Original: Copyright (c) 2011+ Einar Otto Stangvik. MIT.
// Rewritten for @gjsify/unit — behavior preserved, scope narrowed to the
// surface that @gjsify/ws implements on top of Soup.WebsocketConnection.

import { describe, it, expect, on } from '@gjsify/unit';
// `ws` resolves to the real npm package on Node (validates the ws-API
// surface our wrapper targets) and to @gjsify/ws on GJS (via the alias
// in @gjsify/resolve-npm) — so the same spec exercises both.
// @ts-ignore — @types/ws declares WebSocket as the default export in some
// versions and not in others. The runtime is correct on both paths
// (the npm package does `module.exports = WebSocket` in CJS land).
import ws, { WebSocket, WebSocketServer } from 'ws';

/** Construct a WebSocket that attempts to connect to a non-routable address.
 *  We silence 'error' so the inevitable connection failure (after close())
 *  doesn't show up as an unhandled rejection in the test output. Tests that
 *  specifically care about errors re-attach a listener. */
function makeDeadSocket(): WebSocket {
    const s = new WebSocket('ws://example.invalid:1');
    s.on('error', () => {});
    return s;
}

export default async () => {
    await describe('@gjsify/ws module exports', async () => {
        await it('default export is the WebSocket class', async () => {
            expect(typeof ws).toBe('function');
        });

        await it('named WebSocket export equals the default export', async () => {
            expect(ws).toBe(WebSocket);
        });

        // ws's own index.js runs `WebSocket.WebSocket = WebSocket` etc. at load.
        // Real npm ws exposes these via CJS but Node's ESM↔CJS bridge does NOT
        // surface post-load property assignments as static named exports, so on
        // Node these appear as `undefined` on the default export. Our @gjsify/ws
        // is authored as ESM from the start and preserves them, so we assert the
        // self-references on GJS where the wrapper is actually loaded.
        await on('Gjs', async () => {
            await it('GJS: WebSocket.WebSocket self-reference matches ws-npm pattern', async () => {
                expect((WebSocket as any).WebSocket).toBe(WebSocket);
            });

            await it('GJS: WebSocket.Server is an alias for WebSocketServer', async () => {
                expect((WebSocket as any).Server).toBe(WebSocketServer);
            });
        });

        await it('typeof ws === "function" satisfies simple-websocket heuristic', async () => {
            // simple-websocket does:
            //   const _WebSocket = typeof ws !== 'function' ? globalThis.WebSocket : ws
            // Our drop-in must land on the `ws` branch so consumer sees a real class.
            expect(typeof ws).toBe('function');
        });
    });

    // Regression, measured 2026-09-25: upstream ws accepts
    // `new WebSocket(address, options)` — a plain object as the SECOND
    // argument is `options`, not `protocols` (refs/ws/lib/websocket.js
    // `constructor`: `typeof protocols === 'object' && protocols !== null` ⇒
    // treat it as `options`). @gjsify/ws wrapped it straight into
    // `[options]` and handed that to Soup as a protocol list, which Soup
    // rejected ("Invalid element in string array"), closing 1006 before the
    // Origin/custom headers ever reached the wire — this worked on Node
    // (native `ws`/`WebSocket`) and failed only on Gjs. Runs on both
    // platforms: Node proves the assertions match real ws; Gjs proves our
    // implementation.
    //
    // Also exercises the WebSocketServer 'connection' handler's second
    // argument: it used to be the raw Soup.ServerMessage on Gjs (no
    // `.headers`), while ws/Node pass an IncomingMessage-shaped `req.headers`
    // (lower-cased) — `req.headers.origin` threw "t.headers is undefined" on
    // Gjs. Fixed by reusing the verifyClient request-builder for 'connection'
    // too (@gjsify/ws's `websocket-server.ts`).
    //
    // Placed here, BEFORE any `makeDeadSocket()` call below: those sockets
    // deliberately never complete a connection and are `.close()`d while
    // still CONNECTING, which can leave a stray async socket error to
    // surface a few ticks later — @gjsify/unit's `it()` yields between tests
    // (hooks, heartbeat), which is enough of a gap for that stray error to
    // land on whichever async test happens to be in flight when it fires,
    // rather than the test that created it. Running before them sidesteps
    // that pre-existing cross-test timing hazard instead of relying on it
    // never firing during THIS suite's real network I/O.
    await describe('WebSocket constructor argument forms', async () => {
        interface ConnectionReq {
            headers: Record<string, string | string[]>;
        }

        async function withServer(
            run: (port: number, connReq: Promise<ConnectionReq>) => Promise<void>,
        ): Promise<void> {
            const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
            await new Promise<void>((r) => wss.once('listening', () => r()));
            const port = (wss.address() as { port: number }).port;
            const connReq = new Promise<ConnectionReq>((resolve) => {
                wss.on('connection', (_ws: unknown, req: ConnectionReq) => resolve(req));
            });
            try {
                await run(port, connReq);
            } finally {
                wss.close();
            }
        }

        function waitOpen(ws: WebSocket): Promise<void> {
            return new Promise<void>((resolve, reject) => {
                ws.on('open', () => resolve());
                ws.on('error', reject);
            });
        }

        await it('two-arg form: an options object as the second arg reaches the server (origin + headers), client opens', async () => {
            await withServer(async (port, connReq) => {
                const client = new WebSocket(`ws://127.0.0.1:${port}/`, {
                    origin: 'https://example.test',
                    headers: { 'x-probe': '1' },
                });
                const [req] = await Promise.all([connReq, waitOpen(client)]);
                expect(req.headers.origin).toBe('https://example.test');
                expect(req.headers['x-probe']).toBe('1');
                client.close();
            });
        });

        await it('second arg a string (single protocol) still connects', async () => {
            await withServer(async (port, connReq) => {
                const client = new WebSocket(`ws://127.0.0.1:${port}/`, 'foo');
                await Promise.all([connReq, waitOpen(client)]);
                client.close();
            });
        });

        await it('second arg an array (protocols) still connects', async () => {
            await withServer(async (port, connReq) => {
                const client = new WebSocket(`ws://127.0.0.1:${port}/`, ['foo', 'bar']);
                await Promise.all([connReq, waitOpen(client)]);
                client.close();
            });
        });

        await it('undefined second arg + options third arg still connects and reaches the server', async () => {
            await withServer(async (port, connReq) => {
                const client = new WebSocket(`ws://127.0.0.1:${port}/`, undefined, {
                    origin: 'https://example.test',
                });
                const [req] = await Promise.all([connReq, waitOpen(client)]);
                expect(req.headers.origin).toBe('https://example.test');
                client.close();
            });
        });
    });

    // Regression, measured 2026-09-25: `ws://host:port` (no path, no trailing
    // slash) failed the handshake against a @gjsify/ws WebSocketServer on Gjs
    // — GLib.Uri does not normalize a missing path to "/" the way WHATWG URL
    // (and upstream ws, via `new URL(address)`) does, so the request never
    // matched the server's handler (registered at the default path "/") and
    // Soup rejected the upgrade. Fixed in @gjsify/websocket (the client
    // @gjsify/ws delegates to); covered end-to-end here through `ws`. Placed
    // before `makeDeadSocket()` below for the same cross-test timing reason
    // as "WebSocket constructor argument forms" above.
    await describe('WebSocket client URL with no path', async () => {
        await it('connects to ws://host:port with no trailing slash', async () => {
            const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
            await new Promise<void>((r) => wss.once('listening', () => r()));
            const port = (wss.address() as { port: number }).port;

            const opened = await new Promise<boolean>((resolve) => {
                const client = new WebSocket(`ws://127.0.0.1:${port}`);
                client.on('open', () => {
                    client.close();
                    resolve(true);
                });
                client.on('error', () => resolve(false));
                setTimeout(() => resolve(false), 3_000);
            });

            expect(opened).toBe(true);
            wss.close();
        });
    });

    // Regression, measured 2026-09-25: a WebSocketServer that fails to bind a
    // busy port emitted a bare Error — `{ code: undefined, errno: undefined,
    // syscall: undefined }`, message the RAW (LOCALIZED — German in the
    // measurement) Gio.IOErrorEnum text — instead of Node's `EADDRINUSE`
    // ErrnoException, so consumer code branching on `err.code` couldn't tell
    // a busy port from any other failure. @gjsify/http and @gjsify/net
    // already map Gio.IOErrorEnum through `createNodeError`; @gjsify/ws's
    // WebSocketServer had no such mapping. Placed before `makeDeadSocket()`
    // below for the same cross-test timing reason as the describes above.
    await describe('WebSocketServer listen error', async () => {
        await it('emits error with EADDRINUSE when the port is already in use', async () => {
            const wss1 = new WebSocketServer({ port: 0, host: '127.0.0.1' });
            await new Promise<void>((r) => wss1.once('listening', () => r()));
            const port = (wss1.address() as { port: number }).port;

            try {
                const error = await new Promise<NodeJS.ErrnoException & { port?: number }>((resolve, reject) => {
                    const wss2 = new WebSocketServer({ port, host: '127.0.0.1' });
                    wss2.on('error', resolve);
                    wss2.on('listening', () => {
                        wss2.close();
                        reject(new Error('Expected EADDRINUSE but server started successfully'));
                    });
                });

                expect(error.code).toBe('EADDRINUSE');
                expect(error.syscall).toBe('listen');
                expect(error.message).toContain('EADDRINUSE');
                expect(error.message).toContain('listen');
            } finally {
                wss1.close();
            }
        });
    });

    await describe('WebSocket constants', async () => {
        await it('exposes readyState constants on the class', async () => {
            expect(WebSocket.CONNECTING).toBe(0);
            expect(WebSocket.OPEN).toBe(1);
            expect(WebSocket.CLOSING).toBe(2);
            expect(WebSocket.CLOSED).toBe(3);
        });

        await it('exposes readyState constants on instances', async () => {
            // Construct with an unusable URL so we don't trigger a real connection
            // during a unit test; instance properties are set in the constructor
            // independently of connection state.
            const s = new WebSocket('ws://localhost:1');
            s.on('error', () => {}); // see makeDeadSocket
            expect(s.CONNECTING).toBe(0);
            expect(s.OPEN).toBe(1);
            expect(s.CLOSING).toBe(2);
            expect(s.CLOSED).toBe(3);
            s.close();
        });
    });

    await describe('WebSocket construction', async () => {
        await it('stores the url string', async () => {
            const s = new WebSocket('ws://example.invalid:1/path');
            s.on('error', () => {}); // see makeDeadSocket
            expect(s.url).toBe('ws://example.invalid:1/path');
            s.close();
        });

        await it('stores the url from a URL object', async () => {
            const url = new URL('ws://example.invalid:1/u');
            const s = new WebSocket(url);
            s.on('error', () => {}); // see makeDeadSocket
            expect(s.url).toContain('ws://example.invalid:1');
            s.close();
        });

        await it('starts in CONNECTING state', async () => {
            const s = makeDeadSocket();
            expect(s.readyState).toBe(WebSocket.CONNECTING);
            s.close();
        });

        await it('default binaryType is "nodebuffer"', async () => {
            const s = makeDeadSocket();
            expect(s.binaryType).toBe('nodebuffer');
            s.close();
        });
    });

    await describe('WebSocket.send() while CONNECTING', async () => {
        await it('throws synchronously (matches npm ws)', async () => {
            const s = makeDeadSocket();
            expect(() => s.send('hello')).toThrow();
            s.close();
        });

        await it('throws synchronously even when a callback is provided', async () => {
            // Real npm ws throws sync in both cases — the callback form is for
            // reporting *send*-time errors once CONNECTED, not to swallow the
            // not-open error.
            const s = makeDeadSocket();
            expect(() => s.send('hello', () => {})).toThrow();
            s.close();
        });
    });

    await on('Gjs', async () => {
        await describe('GJS: WebSocketServer option validation', async () => {
            await it('accepts { noServer: true } without throwing', async () => {
                expect(() => new WebSocketServer({ noServer: true })).not.toThrow();
            });

            await it('throws when { noServer: true } is combined with port', async () => {
                expect(() => new WebSocketServer({ noServer: true, port: 8080 })).toThrow();
            });
        });
    });

    // Missing port is not Phase-1-specific — real npm ws also requires it (or
    // a `server`/`noServer` alternative). Cross-platform.
    await describe('WebSocketServer required options', async () => {
        await it('throws when nothing is given', async () => {
            expect(() => new WebSocketServer({})).toThrow();
        });
    });
};
