// SPDX-License-Identifier: MIT
// Ported from refs/node/test/parallel/test-tls-connect-given-socket.js
// Original: Copyright Joyent, Inc. and other Node.js contributors. MIT.
// Rewritten for @gjsify/unit — behavior preserved (the four `net.Socket`
// lifecycle shapes `tls.connect({socket})` must handle: already-connected,
// still-connecting, destroyed before the handshake starts, destroyed right
// as the raw socket connects), sequenced instead of run concurrently —
// `@gjsify/unit` has no `common.mustCall(fn, n)` to count call sites across
// a swarm of overlapping connections, and sequencing keeps each assertion
// unambiguous about which connection it belongs to.
//
// Runs on both platforms: on Node this validates the TEST against the real
// `tls`/`net` modules; on GJS it validates `@gjsify/tls`'s / `@gjsify/net`'s
// implementation of the same "given socket" entry point (the one
// `@xmpp/starttls` and friends need — see `starttls-upgrade.gjs.spec.ts`
// for the actual plaintext-then-upgrade shape). Also runs, a third way,
// under `@gjsify/node-gi`'s consumer harness — this polyfill's `tls.connect`
// driven by a `net.Socket` that ISN'T this polyfill's (see `isForeignSocket`
// below and status/open-todos.md): the two data-round-trip cases decide
// which outcome to expect from the socket itself, BEFORE calling
// `tls.connect` — never from whichever outcome happens to come back — so a
// real regression can't silently slide into the "foreign socket" branch.

import { describe, it, expect } from '@gjsify/unit';
import net from 'node:net';
import tls from 'node:tls';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import type { Socket } from 'node:net';
import type { Server as TlsServer, TLSSocket } from 'node:tls';

// Self-signed PEM (cert + key) minted with `openssl req -x509 -newkey
//   rsa:2048 -keyout key.pem -out cert.pem -days 36500 -nodes
//   -subj /CN=localhost -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"`.
// Used only as a local test fixture — never trusted as a CA. Inlined so
// the test stays hermetic (no fixtures, no network).
const CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIDJzCCAg+gAwIBAgIUclCFoWAc7RK7XBbd87uc3bCt19UwDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJbG9jYWxob3N0MCAXDTI2MDkyNTE2NDU0NloYDzIxMjYw
OTAxMTY0NTQ2WjAUMRIwEAYDVQQDDAlsb2NhbGhvc3QwggEiMA0GCSqGSIb3DQEB
AQUAA4IBDwAwggEKAoIBAQDrXoLsjOtOT/iyjIFlVgVHyDPTSnD7+rHsORiJls50
m76mc2YguD7N8AVAVUzXbmJD2ugOv9Mnrsa9Siz08uJqZ9l9x1dgZqw0gq/r9aIq
0E3zFfe56ZbPTprgQPMlY6dd9h+ixKEkD6Sz/VBNPjykcG908R6fdSg1aliFLOHc
w/4a0/+MJCb2D0Wj1JKFaG30HzjfILK9YLdysXmuV2sNo0N1Seq/oT9K9IDrmebz
AtdRd0+YI9j1JCikGZc3uoOHnN2wrL34/c4AS9RI4tfvmLsI9b9BrJ+N0GDSc9wo
k0FwwZiESxE810wQ/O+6ORjTS0GceP47dj8XCeLNMMFjAgMBAAGjbzBtMB0GA1Ud
DgQWBBSzQ2ued8AknJj0lL6KTaF0aaP0sjAfBgNVHSMEGDAWgBSzQ2ued8AknJj0
lL6KTaF0aaP0sjAPBgNVHRMBAf8EBTADAQH/MBoGA1UdEQQTMBGCCWxvY2FsaG9z
dIcEfwAAATANBgkqhkiG9w0BAQsFAAOCAQEAqMONq4El+Mju1ZLY9fMyKnK3urpj
aDEPSkJ2VWa+Jbf+vP46CYmeaqJgSxiQRY2xARxexVgBtye/iJNk9Z/DmDKL27PA
3SyIre99ZFbRHXp9YIA5oG9xImjOs/pHdLxuZf6BUE/5IrZw7BzyPTvlRU2MS+zn
gP2byYMm2DvuwqGS0zITlTi5L1fEOGwwqrKNYs4Z+2x56r+b4xwIEBjgl2PDdpJI
gtqJdmgjz3yXtZem9PBZ1KTkBZg9wdFMmp/UjwMrF9SEMaT2Oq8YXQPD0NToBmMg
ovFq+uBSwKPB1aWLq8uZ22t1E7nv4n+G3tw7vQGG0bXXX3Ae/mxsa7BNUw==
-----END CERTIFICATE-----
`;
const KEY_PEM = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDrXoLsjOtOT/iy
jIFlVgVHyDPTSnD7+rHsORiJls50m76mc2YguD7N8AVAVUzXbmJD2ugOv9Mnrsa9
Siz08uJqZ9l9x1dgZqw0gq/r9aIq0E3zFfe56ZbPTprgQPMlY6dd9h+ixKEkD6Sz
/VBNPjykcG908R6fdSg1aliFLOHcw/4a0/+MJCb2D0Wj1JKFaG30HzjfILK9YLdy
sXmuV2sNo0N1Seq/oT9K9IDrmebzAtdRd0+YI9j1JCikGZc3uoOHnN2wrL34/c4A
S9RI4tfvmLsI9b9BrJ+N0GDSc9wok0FwwZiESxE810wQ/O+6ORjTS0GceP47dj8X
CeLNMMFjAgMBAAECggEADfM+a/TM5t8DN4SaZWjcIUKyx6gsMCh4roPnz2faeWYt
vkHYC20VfoaRA8d1KXjyZraCdeAADORlWnIbXgfzTCk25nyP0jfjpwJumNv92O8b
Ck2tWXMzLBBVn6BZ3kfHc2CTbsXxYxNw80tlR16+oLnFRrdv1Yr6b3K2fRY0QNhZ
M+dAylFdwNh0k3N/sKdI1WVWO+jK3W2G+cwx23DjS8W8XG1+3EqftyrEbJYn7HgC
NhDtboLKArcSqtUBmDddEbEGXW3dGgICnutGi+ncVaT+hq95ZARLYYNqte9WmjRY
AoI8w8ftG+V5SQQVH0+MgJRX49nQkAWtrohLSxB9AQKBgQD+P7Wo/IP2x8fANPHb
Wcjvqo2EAl5yaGk4z5Adylq568QIE92XyjKG4itUIugcGo2zTCIf11Iw452YCTn/
u6maQGc2IX93hdsVkFFF72BYj2LVZ0JGroZDz/8Dn7uTfRgPSw3lbB7iJ0XBcCIB
JIU5/7BpySQOU9QmN95jdN544wKBgQDs/YNkUdb5IrAsfQzoafi4N7gtCUmSG0Bc
IAhQxskgg3RS8SxPgHCWU+2EFfa32HCogivPEABOLwYiG/XcmumoEl5yTKmxOb8N
LMic28G08iXvwiBuIRwSpIX5nQAscsiqPMCv3SQx0e7JRb/KqYSbOIRLWHV9QvDU
g3l/V+V9gQKBgHDdjWIf/uD9XPI5TqhmWinyl3Hjr1OwgA1lLv/ahZ4FSHehgfxR
GU8BdeSavllDfGX8xSVHa8giMyJ77hBVmXvNXUQNaM2BUXloIHwgQK/vrxs3BJfl
/9p4qidMsHNP0+9uDRQshCU28+NkSOQi9zWBCSpczTHDCumQYZvbFKurAoGBAOBx
O6WfyFtMWdLYX4ghDJfS1U95sz53Jp3ZDGcLzGFJfborhA6LEpWcSJ5GetEkX5WH
KlxAyDlDWaimGFPkNpOhSecv6anZibG9jwTXLv3iMsF9dV83ZjHVtLhw00BFOPvY
65fidKvmKSJfN0OFBfxHKyt8TFDkO9bX6RIMOWCBAoGAAq7xKiQT5osDhoSBPrPW
gOJgz53VZ13ieimqe3njlwSR9dNzP8mnfasw9+m2mnG+PTfsfNTfcGmSPQZEy0JJ
XPbThc36pK/5uQuLxWA4fgjGrvIbY1JkIxoILV4Wj5IwYifHwkOaO2FekopeIPGe
XeP46WXXpYJLgQljoQ159Rk=
-----END PRIVATE KEY-----
`;

// One case (RSA-2048 handshake plus the TCP round trips) takes ~0.1 s on
// GJS. The ceilings are hang detectors, not performance budgets: a round
// trip needing seconds is a bug. The earlier 25 s/30 s were sized for "a
// loaded host" and hid a real hang — TLS `end()` sent no close_notify, so
// 'end' never arrived. `TIMEOUT_MS` (used by `withTimeout`) stays under the
// per-`it()` ceiling so a hang fails with OUR label instead of the
// framework's generic message.
const TIMEOUT_MS = 8_000;
const ITEST_TIMEOUT_MS = 10_000;

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timed out: ${label}`)), TIMEOUT_MS);
        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (err) => {
                clearTimeout(timer);
                reject(err);
            },
        );
    });
}

/**
 * Start a `tls.createServer` (default handler: reply 'Hello' and end), run
 * `body`, then always close it.
 */
async function withServer<T>(
    body: (port: number) => Promise<T>,
    onSecure: (socket: TLSSocket) => void = (socket) => socket.end('Hello'),
): Promise<T> {
    const server = tls.createServer({ key: KEY_PEM, cert: CERT_PEM }, onSecure) as unknown as TlsServer;
    // A client refusing the certificate aborts the handshake — expected here.
    server.on('tlsClientError', () => {});

    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve());
    });

    const { port } = server.address() as { port: number };
    const close = () => new Promise<void>((resolve) => server.close(() => resolve()));

    try {
        return await body(port);
    } finally {
        await close();
    }
}

function readAll(socket: Socket): Promise<string> {
    return new Promise((resolve, reject) => {
        let data = '';
        socket.on('data', (chunk: Buffer) => {
            data += chunk.toString('utf8');
        });
        socket.on('end', () => resolve(data));
        socket.on('error', reject);
    });
}

function waitForError(socket: Socket): Promise<NodeJS.ErrnoException> {
    return new Promise((resolve) => {
        socket.once('error', (err: NodeJS.ErrnoException) => resolve(err));
    });
}

/**
 * Whether `socket` carries the `@gjsify/net` internals
 * `TLSSocket._adoptConnection` needs (`_claimConnection`/`_detachReader`) —
 * the SAME feature-detection `tls-socket.ts` itself does before adopting.
 * Read from the socket BEFORE calling `tls.connect`, so the expectation is
 * decided from what we HAVE, not from whatever `tls.connect` happens to do
 * with it — see `status/open-todos.md`'s "only adopts a @gjsify/net
 * Socket" entry: hit for real by `@gjsify/node-gi`'s consumer harness,
 * whose `net.connect()` returns Node's own native socket because the
 * harness aliases `node:tls` onto this polyfill but leaves `node:net` on
 * that runtime's own module for the package under test.
 */
function isForeignSocket(socket: Socket): boolean {
    const internals = socket as unknown as { _claimConnection?: unknown; _detachReader?: unknown };
    return typeof internals._claimConnection !== 'function' || typeof internals._detachReader !== 'function';
}

/**
 * Whether `node:tls` resolved to THIS polyfill. Only then can a socket be
 * "foreign": Node's own tls adopts any Duplex, so under plain Node the
 * given-socket cases must succeed like everywhere else.
 */
function usesGjsifyTls(): boolean {
    return typeof (tls.TLSSocket.prototype as unknown as { _adoptConnection?: unknown })._adoptConnection === 'function';
}

/** Server handler: answer the first chunk with `echo:<chunk>` and end. */
function echoOnce(socket: TLSSocket): void {
    socket.once('data', (chunk: Buffer) => socket.end(`echo:${chunk.toString('utf8')}`));
}

/** Resolve with the error a handshake fails with; reject if it succeeds instead. */
function expectHandshakeError(client: TLSSocket): Promise<NodeJS.ErrnoException> {
    return new Promise((resolve, reject) => {
        client.once('secureConnect', () => reject(new Error('handshake succeeded, expected a certificate error')));
        client.once('error', (err: NodeJS.ErrnoException) => resolve(err));
    });
}

/** A plain TCP server that accepts and never answers — a stalled TLS peer. */
async function withSilentServer<T>(body: (port: number) => Promise<T>): Promise<T> {
    const conns = new Set<Socket>();
    const server = net.createServer((conn: Socket) => {
        conns.add(conn);
        conn.on('error', () => {});
    });
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve());
    });
    const { port } = server.address() as { port: number };
    try {
        return await body(port);
    } finally {
        for (const conn of conns) conn.destroy();
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
}

function waitConnect(socket: Socket): Promise<void> {
    return new Promise((resolve, reject) => {
        socket.once('connect', () => resolve());
        socket.once('error', reject);
    });
}

function waitClose(socket: { destroyed: boolean; once: (ev: 'close', cb: () => void) => unknown }): Promise<void> {
    if (socket.destroyed) return Promise.resolve();
    return new Promise((resolve) => socket.once('close', () => resolve()));
}

export default async () => {
    await describe(
        'tls.connect({socket}) — given-socket lifecycle',
        async () => {
            await it(
                'upgrades an already-connected socket and reads the server payload',
                async () => {
                    await withTimeout(
                        withServer(async (port) => {
                            const raw = net.connect(port, '127.0.0.1');
                            await waitConnect(raw);

                            // Decide BEFORE calling tls.connect, from the
                            // socket itself — never from the outcome (that
                            // would make a real regression indistinguishable
                            // from the documented foreign-socket case).
                            const foreign = usesGjsifyTls() && isForeignSocket(raw);
                            if (typeof process.versions.gjs === 'string') {
                                // Never true on GJS: `@gjsify/net`'s own
                                // net.connect() always returns its own
                                // Socket. If this fires, adoption itself
                                // regressed — not something to paper over
                                // by falling into the error branch below.
                                expect(foreign).toBe(false);
                            }

                            const client = tls.connect({ socket: raw, rejectUnauthorized: false });
                            expect(client.readable).toBe(true);
                            expect(client.writable).toBe(true);

                            if (foreign) {
                                const err = await waitForError(client);
                                expect(err.code).toBe('ERR_GJSIFY_TLS_FOREIGN_SOCKET');
                            } else {
                                const data = await readAll(client);
                                expect(data).toBe('Hello');
                            }
                        }),
                        'already-connected socket',
                    );
                },
                ITEST_TIMEOUT_MS,
            );

            await it(
                'upgrades a still-connecting socket and reads the server payload',
                async () => {
                    await withTimeout(
                        withServer(async (port) => {
                            const raw = net.connect(port, '127.0.0.1');
                            // Method presence doesn't depend on connection
                            // state, so this reads fine before 'connect'.
                            const foreign = usesGjsifyTls() && isForeignSocket(raw);
                            if (typeof process.versions.gjs === 'string') {
                                expect(foreign).toBe(false);
                            }

                            // Wrap immediately — before the TCP handshake has even
                            // completed (`raw.connecting` is still true here).
                            // `tls.connect({socket})` must wait for the socket's
                            // own 'connect' before starting the TLS handshake.
                            const client = tls.connect({ socket: raw, rejectUnauthorized: false });
                            expect(client.readable).toBe(true);
                            expect(client.writable).toBe(true);

                            if (foreign) {
                                const err = await waitForError(client);
                                expect(err.code).toBe('ERR_GJSIFY_TLS_FOREIGN_SOCKET');
                            } else {
                                const data = await readAll(client);
                                expect(data).toBe('Hello');
                            }
                        }),
                        'connecting socket',
                    );
                },
                ITEST_TIMEOUT_MS,
            );

            await it(
                'destroying the TLSSocket before the raw socket connects does not throw or hang',
                async () => {
                    await withTimeout(
                        withServer(async (port) => {
                            const raw = net.connect(port, '127.0.0.1');
                            const client = tls.connect({ socket: raw, rejectUnauthorized: false });
                            client.on('error', () => {
                                /* destroying pre-handshake can surface a benign error — ignore */
                            });

                            client.destroy();
                            await waitClose(client as unknown as { destroyed: boolean; once: Socket['once'] });
                            expect(client.destroyed).toBe(true);
                        }),
                        'destroy before connect',
                    );
                },
                ITEST_TIMEOUT_MS,
            );

            await it(
                'destroying the TLSSocket right as the raw socket connects does not throw or hang',
                async () => {
                    await withTimeout(
                        withServer(async (port) => {
                            const raw = net.connect(port, '127.0.0.1');
                            const client = tls.connect({ socket: raw, rejectUnauthorized: false });
                            client.on('error', () => {
                                /* destroying mid-handshake can surface a benign error — ignore */
                            });

                            await waitConnect(raw);
                            client.destroy();
                            await waitClose(client as unknown as { destroyed: boolean; once: Socket['once'] });
                            expect(client.destroyed).toBe(true);
                        }),
                        'destroy at connect',
                    );
                },
                ITEST_TIMEOUT_MS,
            );

            await it(
                'buffers write() made before secureConnect (fresh connect)',
                async () => {
                    await withTimeout(
                        withServer(async (port) => {
                            const client = tls.connect({ port, host: '127.0.0.1', rejectUnauthorized: false });
                            client.write('ping');
                            expect(await readAll(client)).toBe('echo:ping');
                        }, echoOnce),
                        'write before secureConnect',
                    );
                },
                ITEST_TIMEOUT_MS,
            );

            await it(
                'buffers end(data) made before secureConnect (adopted socket)',
                async () => {
                    await withTimeout(
                        withServer(async (port) => {
                            const raw = net.connect(port, '127.0.0.1');
                            await waitConnect(raw);
                            if (usesGjsifyTls() && isForeignSocket(raw)) return;
                            const client = tls.connect({ socket: raw, rejectUnauthorized: false });
                            client.end('ping');
                            expect(await readAll(client)).toBe('echo:ping');
                        }, echoOnce),
                        'end before secureConnect',
                    );
                },
                ITEST_TIMEOUT_MS,
            );

            await it(
                'rejects a self-signed certificate on an adopted socket',
                async () => {
                    await withTimeout(
                        withServer(async (port) => {
                            const raw = net.connect(port, '127.0.0.1');
                            await waitConnect(raw);
                            if (usesGjsifyTls() && isForeignSocket(raw)) return;
                            const client = tls.connect({ socket: raw, servername: 'localhost' });
                            const err = await expectHandshakeError(client);
                            expect(err.code).toBe('DEPTH_ZERO_SELF_SIGNED_CERT');
                            expect(client.authorized).toBe(false);
                        }),
                        'self-signed rejected',
                    );
                },
                ITEST_TIMEOUT_MS,
            );

            await it(
                'rejects a servername the certificate does not cover on an adopted socket',
                async () => {
                    await withTimeout(
                        withServer(async (port) => {
                            const raw = net.connect(port, '127.0.0.1');
                            await waitConnect(raw);
                            if (usesGjsifyTls() && isForeignSocket(raw)) return;
                            const client = tls.connect({ socket: raw, servername: 'wrong.example', ca: CERT_PEM });
                            const err = await expectHandshakeError(client);
                            expect(err.code).toBe('ERR_TLS_CERT_ALTNAME_INVALID');
                        }),
                        'wrong servername rejected',
                    );
                },
                ITEST_TIMEOUT_MS,
            );

            await it(
                'verifies the certificate against `ca` on an adopted socket',
                async () => {
                    await withTimeout(
                        withServer(async (port) => {
                            const raw = net.connect(port, '127.0.0.1');
                            await waitConnect(raw);
                            if (usesGjsifyTls() && isForeignSocket(raw)) return;
                            const client = tls.connect({ socket: raw, servername: 'localhost', ca: CERT_PEM });
                            expect(await readAll(client)).toBe('Hello');
                            expect(client.authorized).toBe(true);
                        }),
                        'verified against ca',
                    );
                },
                ITEST_TIMEOUT_MS,
            );

            await it(
                'destroying mid-handshake against a stalled peer closes once, never secureConnects',
                async () => {
                    await withTimeout(
                        withSilentServer(async (port) => {
                            const raw = net.connect(port, '127.0.0.1');
                            await waitConnect(raw);
                            if (usesGjsifyTls() && isForeignSocket(raw)) return;
                            const client = tls.connect({ socket: raw, rejectUnauthorized: false });
                            let closes = 0;
                            let secured = false;
                            client.on('close', () => closes++);
                            client.on('secureConnect', () => {
                                secured = true;
                            });
                            client.on('error', () => {});
                            // Let the ClientHello go out; the peer never answers.
                            await new Promise((r) => setTimeout(r, 100));
                            client.destroy();
                            await waitClose(client as unknown as { destroyed: boolean; once: Socket['once'] });
                            await new Promise((r) => setTimeout(r, 100));
                            expect(closes).toBe(1);
                            expect(secured).toBe(false);
                        }),
                        'destroy mid-handshake',
                    );
                },
                ITEST_TIMEOUT_MS,
            );
        },
        // Sequential real-handshake tests, each bounded by its own ceiling.
        10 * ITEST_TIMEOUT_MS,
    );
};
