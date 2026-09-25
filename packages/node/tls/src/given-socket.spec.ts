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
// for the actual plaintext-then-upgrade shape).

import { describe, it, expect } from '@gjsify/unit';
import net from 'node:net';
import tls from 'node:tls';
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

// A real handshake (RSA-2048) plus the plaintext TCP round trips these
// tests drive is fast on an idle host, but @gjsify/unit's own default
// `it()` timeout is 5s — too tight for a genuine network test under load
// (measured on a host also running a concurrent CPU-heavy build/test job:
// well over 10s per case). `ITEST_TIMEOUT_MS` raises the per-`it()`
// ceiling generously rather than tuning it to one machine's contention;
// `TIMEOUT_MS` (used by `withTimeout` below) stays under it so a genuine
// hang fails with OUR message instead of the framework's generic one.
const TIMEOUT_MS = 25_000;
const ITEST_TIMEOUT_MS = 30_000;

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

/** Start a `tls.createServer` that replies 'Hello' and ends, run `body`, then always close it. */
async function withServer<T>(body: (port: number) => Promise<T>): Promise<T> {
    const server = tls.createServer({ key: KEY_PEM, cert: CERT_PEM }, (socket: TLSSocket) => {
        socket.end('Hello');
    }) as unknown as TlsServer;

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

                            const client = tls.connect({ socket: raw, rejectUnauthorized: false });
                            expect(client.readable).toBe(true);
                            expect(client.writable).toBe(true);

                            const data = await readAll(client);
                            expect(data).toBe('Hello');
                        }),
                        'already-connected socket',
                    );
                },
                // A real handshake (RSA-2048) plus the TCP round trips takes
                // longer than @gjsify/unit's 5s default under load — well
                // under this ceiling when the host isn't contended.
                ITEST_TIMEOUT_MS,
            );

            await it(
                'upgrades a still-connecting socket and reads the server payload',
                async () => {
                    await withTimeout(
                        withServer(async (port) => {
                            const raw = net.connect(port, '127.0.0.1');
                            // Wrap immediately — before the TCP handshake has even
                            // completed (`raw.connecting` is still true here).
                            // `tls.connect({socket})` must wait for the socket's
                            // own 'connect' before starting the TLS handshake.
                            const client = tls.connect({ socket: raw, rejectUnauthorized: false });
                            expect(client.readable).toBe(true);
                            expect(client.writable).toBe(true);

                            const data = await readAll(client);
                            expect(data).toBe('Hello');
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
        },
        // Four sequential real-handshake tests — give the suite itself
        // enough room even if every one of them needs its full per-`it()`
        // budget under load.
        4 * ITEST_TIMEOUT_MS,
    );
};
