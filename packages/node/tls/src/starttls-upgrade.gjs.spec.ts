// SPDX-License-Identifier: MIT
// GJS-only — exercises the actual STARTTLS shape end to end: a plaintext
// greeting, a plaintext command/ack exchange, THEN `tls.connect({socket,
// servername})` takes over the same TCP connection and negotiates TLS —
// exactly what `@xmpp/starttls` does to an XMPP stream before this PR
// (`tls.connect({socket})` used to ignore `options.socket` entirely and
// open a second, unrelated connection instead of upgrading the given one).
//
// GJS-only because the SERVER side needs to defer its TLS upgrade until
// after it has spoken plaintext — `@gjsify/tls`'s own `TLSServer` always
// upgrades immediately on 'connection' (no plaintext phase), so it can't
// play the STARTTLS server here. Server-side STARTTLS
// (`new tls.TLSSocket(socket, {isServer: true})`) isn't implemented in
// `@gjsify/tls` at all yet — out of scope for the client-side fix this
// test covers — so the server below is built directly over Gio, standing
// in for a real STARTTLS-aware server (imap/smtp/xmpp) purely to give the
// CLIENT under test something correct to upgrade against.

import { describe, it, expect, on } from '@gjsify/unit';
import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import { gbytesToUint8Array } from '@gjsify/utils';
import net from 'node:net';
import tls from 'node:tls';
import { Buffer } from 'node:buffer';
import type { Socket } from 'node:net';
import type { Server as NetServer } from 'node:net';
import type { TLSSocket } from 'node:tls';
import { type SocketInternals } from './tls-socket.js';
// Relative import, not `node:tls`: needs the impl's own `SecureContext`
// (which carries `.certificate`), not `@types/node`'s opaque public shape —
// same rationale as the `SocketInternals` cast above (rule 2b, tests/AGENTS.md).
import { createSecureContext } from './secure-context.js';

// Same fixture cert/key as `given-socket.spec.ts` (self-signed,
// CN=localhost, SAN DNS:localhost + IP:127.0.0.1); kept local to each spec
// file so neither depends on the other's module graph.
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

// Hang detectors, not performance budgets — see `given-socket.spec.ts`'s
// matching comment.
const TIMEOUT_MS = 8_000;
const ITEST_TIMEOUT_MS = 10_000;

/**
 * A minimal STARTTLS-shaped server, standing in for a real one (imap/smtp/
 * xmpp): speak plaintext, wait for a plaintext "STARTTLS\r\n" command, ack
 * it in plaintext, THEN — and only then — upgrade to TLS and echo back
 * whatever the client sends, prefixed, to prove the round trip actually
 * went through the encrypted channel.
 */
function startStarttlsServer(
    certificate: Gio.TlsCertificate,
): Promise<{ server: NetServer; port: number; conns: Set<Socket> }> {
    // Accepted connections, so the test can tear them down: `server.close()`
    // only calls back once every accepted connection has closed.
    const conns = new Set<Socket>();
    const server = net.createServer((conn: Socket) => {
        conns.add(conn);
        let buffered = '';
        const onGreetingReply = (chunk: Buffer) => {
            buffered += chunk.toString('utf8');
            if (!buffered.includes('STARTTLS\r\n')) return;
            conn.removeListener('data', onGreetingReply);

            conn.write('220 go-ahead\r\n', () => {
                // Wait for the plaintext write to fully settle before
                // handing the connection's read/write streams to a new
                // owner — see `_detachReader`'s doc in @gjsify/net for why
                // a write racing the handshake's own writes is the same
                // "one Gio op at a time per stream" hazard as an
                // unsettled read.
                void upgradeToTls(conn, certificate);
            });
        };
        conn.on('data', onGreetingReply);
        conn.write('220 greeting\r\n');
    });

    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address() as { port: number };
            resolve({ server, port, conns });
        });
    });
}

async function upgradeToTls(conn: Socket, certificate: Gio.TlsCertificate): Promise<void> {
    const internals = conn as unknown as SocketInternals;
    const leftover = await internals._detachReader();
    if (leftover && leftover.length > 0) {
        conn.destroy(new Error('test server: unexpected plaintext bytes raced the STARTTLS upgrade'));
        return;
    }
    const rawIoStream = internals._connection as unknown as Gio.IOStream;
    if (!rawIoStream) {
        conn.destroy(new Error('test server: no underlying connection to upgrade'));
        return;
    }

    const tlsConn = Gio.TlsServerConnection.new(rawIoStream, certificate);
    tlsConn.authenticationMode = Gio.TlsAuthenticationMode.NONE;

    const cancellable = new Gio.Cancellable();
    tlsConn.handshake_async(GLib.PRIORITY_DEFAULT, cancellable, (_source, asyncResult) => {
        try {
            tlsConn.handshake_finish(asyncResult);
        } catch (err: unknown) {
            conn.destroy(err instanceof Error ? err : new Error(String(err)));
            return;
        }
        echoOnce(tlsConn);
    });
}

/** Read one message over the (now-encrypted) connection and echo it back, prefixed. */
function echoOnce(tlsConn: Gio.TlsConnection): void {
    const input = tlsConn.get_input_stream();
    const output = tlsConn.get_output_stream();
    input.read_bytes_async(65536, GLib.PRIORITY_DEFAULT, null, (_source, asyncResult) => {
        let text: string;
        try {
            const bytes = input.read_bytes_finish(asyncResult);
            text = bytes ? Buffer.from(gbytesToUint8Array(bytes)).toString('utf8') : '';
        } catch {
            return;
        }
        const reply = `ECHO:${text}`;
        output.write_bytes_async(new GLib.Bytes(Buffer.from(reply, 'utf8')), GLib.PRIORITY_DEFAULT, null, () => {
            /* best-effort — the test only needs the client to see the bytes */
        });
    });
}

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

export default async () => {
    await on('Gjs', async () => {
        await describe(
            'STARTTLS shape — plaintext greeting, then tls.connect({socket}) upgrades it',
            async () => {
                await it(
                    'upgrades in place: no second connection, no plaintext data after the upgrade, round trip decrypts',
                    async () => {
                        const certificate = createSecureContext({ cert: CERT_PEM, key: KEY_PEM }).certificate;
                        if (!certificate) throw new Error('test fixture: failed to parse the embedded cert/key');

                        const { server, port, conns } = await startStarttlsServer(certificate);
                        let secure: TLSSocket | null = null;
                        try {
                            const result = await withTimeout(
                                new Promise<{ reply: string; plaintextAfterUpgrade: boolean }>((resolve, reject) => {
                                    const plain = net.connect(port, '127.0.0.1');
                                    let stage: 'greeting' | 'ack' | 'upgraded' = 'greeting';
                                    let plaintextAfterUpgrade = false;

                                    plain.on('error', reject);

                                    plain.on('data', (chunk: Buffer) => {
                                        const text = chunk.toString('utf8');

                                        if (stage === 'greeting' && text.includes('220 greeting')) {
                                            stage = 'ack';
                                            plain.write('STARTTLS\r\n');
                                            return;
                                        }

                                        if (stage === 'ack' && text.includes('220 go-ahead')) {
                                            stage = 'upgraded';

                                            // This is the STARTTLS moment: hand the
                                            // SAME already-connected socket to
                                            // tls.connect() rather than opening a
                                            // second connection.
                                            secure = tls.connect({
                                                socket: plain,
                                                servername: 'localhost',
                                                rejectUnauthorized: false,
                                            });

                                            // Anything the original plaintext
                                            // socket still delivers after this
                                            // point would mean the upgrade didn't
                                            // actually take over reading.
                                            plain.on('data', () => {
                                                plaintextAfterUpgrade = true;
                                            });

                                            secure.once('secureConnect', () => {
                                                secure.write('hello-over-tls');
                                            });
                                            secure.on('data', (encChunk: Buffer) => {
                                                resolve({ reply: encChunk.toString('utf8'), plaintextAfterUpgrade });
                                            });
                                            secure.on('error', (err) => {
                                                reject(err);
                                            });
                                            return;
                                        }
                                    });
                                }),
                                'STARTTLS round trip',
                            );

                            expect(result.reply).toBe('ECHO:hello-over-tls');
                            expect(result.plaintextAfterUpgrade).toBe(false);
                        } finally {
                            secure?.destroy();
                            for (const conn of conns) conn.destroy();
                            await new Promise<void>((resolve) => server.close(() => resolve()));
                        }
                    },
                    ITEST_TIMEOUT_MS,
                );
            },
            ITEST_TIMEOUT_MS,
        );

        await describe(
            'upgrade teardown — Gio-level guarantees',
            async () => {
                for (const adopted of [false, true]) {
                    await it(
                        `destroy mid-handshake closes the raw connection (${adopted ? 'adopted' : 'fresh'} socket)`,
                        async () => {
                            const { server, port, conns } = await startSilentServer();
                            try {
                                const raw = adopted ? net.connect(port, '127.0.0.1') : null;
                                if (raw) await new Promise((r) => raw.once('connect', r));
                                const client = raw
                                    ? tls.connect({ socket: raw, rejectUnauthorized: false })
                                    : tls.connect({ port, host: '127.0.0.1', rejectUnauthorized: false });
                                client.on('error', () => {});
                                const claimed = captureClaim(client);
                                await new Promise((r) => setTimeout(r, 100));
                                const connection = claimed();
                                expect(connection !== null).toBe(true);
                                expect(connection?.is_closed()).toBe(false);

                                const closed = new Promise((r) => client.once('close', r));
                                client.destroy();
                                await withTimeout(closed, 'close after destroy');
                                expect(connection?.is_closed()).toBe(true);
                            } finally {
                                for (const conn of conns) conn.destroy();
                                await new Promise<void>((resolve) => server.close(() => resolve()));
                            }
                        },
                        ITEST_TIMEOUT_MS,
                    );
                }

                await it(
                    'plaintext bytes that raced the upgrade fail with ERR_GJSIFY_TLS_UPGRADE_RACE',
                    async () => {
                        const { server, port, conns } = await startSilentServer();
                        try {
                            const raw = net.connect(port, '127.0.0.1');
                            await new Promise((r) => raw.once('connect', r));
                            // Deterministic stand-in for a peer pipelining bytes right
                            // after its STARTTLS reply: the real detach settles, then
                            // reports what a read that won the race would have pulled
                            // off the wire.
                            const internals = raw as unknown as SocketInternals;
                            const detach = internals._detachReader.bind(raw);
                            let claimedConnection: Gio.SocketConnection | null = null;
                            const claim = internals._claimConnection.bind(raw);
                            internals._claimConnection = () => {
                                const claimed = claim();
                                claimedConnection = claimed.connection;
                                return claimed;
                            };
                            internals._detachReader = async () => {
                                await detach();
                                return Buffer.from('* pipelined\r\n');
                            };

                            const client = tls.connect({ socket: raw, rejectUnauthorized: false });
                            const err = await withTimeout(
                                new Promise<NodeJS.ErrnoException>((resolve) => client.once('error', resolve)),
                                'upgrade race error',
                            );
                            expect(err.code).toBe('ERR_GJSIFY_TLS_UPGRADE_RACE');
                            expect((claimedConnection as Gio.SocketConnection | null)?.is_closed()).toBe(true);
                        } finally {
                            for (const conn of conns) conn.destroy();
                            await new Promise<void>((resolve) => server.close(() => resolve()));
                        }
                    },
                    ITEST_TIMEOUT_MS,
                );
            },
            3 * ITEST_TIMEOUT_MS,
        );
    });
};

/** A plain TCP server that accepts and never answers — a stalled TLS peer. */
function startSilentServer(): Promise<{ server: NetServer; port: number; conns: Set<Socket> }> {
    const conns = new Set<Socket>();
    const server = net.createServer((conn: Socket) => {
        conns.add(conn);
        conn.on('error', () => {});
    });
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address() as { port: number };
            resolve({ server, port, conns });
        });
    });
}

/**
 * Record the raw connection `_performHandshake` claims from `client`, by
 * shadowing `_claimConnection` on the instance.
 */
function captureClaim(client: TLSSocket): () => Gio.SocketConnection | null {
    const internals = client as unknown as SocketInternals;
    const claim = internals._claimConnection.bind(client);
    let connection: Gio.SocketConnection | null = null;
    internals._claimConnection = () => {
        const claimed = claim();
        if (claimed.connection) connection = claimed.connection;
        return claimed;
    };
    return () => connection;
}
