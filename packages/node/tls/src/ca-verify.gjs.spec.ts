// SPDX-License-Identifier: MIT
// GJS-only — pins HOW the client verifies a certificate against `ca`, which a
// pure outcome test cannot: glib-networking runs the handshake on a worker
// thread and, when it needs a verdict, `g_main_context_invoke`s
// 'accept-certificate' on the main context. If the main thread is between
// loop iterations at that instant the worker acquires the context and runs
// the callback ITSELF; GJS refuses to re-enter JS from another thread
// ("Attempting to call back into JSAPI on a different thread"), the handler
// counts as "no", and a valid `ca` fails with Gio.TlsError "unacceptable
// certificate" — about one in ten first connections of a top-level-await
// script. The unit runner holds the main context for its whole run, so the
// race itself cannot fire here; what can be asserted deterministically is
// that the client connects NO JS 'accept-certificate' handler at all — it
// verifies after the handshake instead — so there is nothing to misroute.

import { describe, it, expect, on } from '@gjsify/unit';
import Gio from '@girs/gio-2.0';
import tls from 'node:tls';
import type { AddressInfo } from 'node:net';
import type { TLSSocket } from 'node:tls';
import type { TLSSocket as GjsifyTLSSocket } from './tls-socket.js';

// Same ECDSA test PKI as `ca-verify.spec.ts`: CA, plus a `CN=localhost` leaf
// with SAN DNS:localhost + IP:127.0.0.1 signed by it.
const CA_PEM = `-----BEGIN CERTIFICATE-----
MIIBmjCCAT+gAwIBAgIUaFUUnkak6beliDZlMdBByD7MZ8UwCgYIKoZIzj0EAwIw
GTEXMBUGA1UEAwwOZ2pzaWZ5LXRlc3QtY2EwIBcNMjYxMDA2MTI1ODE3WhgPMjEy
NjA5MTIxMjU4MTdaMBkxFzAVBgNVBAMMDmdqc2lmeS10ZXN0LWNhMFkwEwYHKoZI
zj0CAQYIKoZIzj0DAQcDQgAEshoB+FIiofkf9f72NwJlzxgiyaKP72l2qg0YdKK0
mHCkFDAxacfd01zABweDHqaxIdP/BMqmxe9ee4L3MUxZ2aNjMGEwHQYDVR0OBBYE
FHUgysNA8swJnjEdtTdvlVupW03LMB8GA1UdIwQYMBaAFHUgysNA8swJnjEdtTdv
lVupW03LMA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49
BAMCA0kAMEYCIQDtokTDDE0VIufvye+cKuNFo2LVjGYiR4CQdEzcbVjcsQIhAP+G
QQDBQPsZpCSuu7k5Dk/kOeNnSxF3pcyuSd7AtdOX
-----END CERTIFICATE-----
`;
const LEAF_PEM = `-----BEGIN CERTIFICATE-----
MIIBvTCCAWSgAwIBAgIUNJG9oiMcVEOzNlafuZ4TCYzHATUwCgYIKoZIzj0EAwIw
GTEXMBUGA1UEAwwOZ2pzaWZ5LXRlc3QtY2EwIBcNMjYxMDA2MTI1ODE3WhgPMjEy
NjA5MTIxMjU4MTdaMBQxEjAQBgNVBAMMCWxvY2FsaG9zdDBZMBMGByqGSM49AgEG
CCqGSM49AwEHA0IABPG/qPWz1YG4GG32a9NYpNYqDpOmCqCzi16vCHY5VAUc44GN
AMe78rB5x8XtZ/jtpuNWtp1VSN/nte1soQP0DFqjgYwwgYkwGgYDVR0RBBMwEYIJ
bG9jYWxob3N0hwR/AAABMAkGA1UdEwQCMAAwCwYDVR0PBAQDAgeAMBMGA1UdJQQM
MAoGCCsGAQUFBwMBMB0GA1UdDgQWBBTCtwhnX4XGve7NMxhhoWxtwnc9lTAfBgNV
HSMEGDAWgBR1IMrDQPLMCZ4xHbU3b5VbqVtNyzAKBggqhkjOPQQDAgNHADBEAiBx
qVOs/9Znqclrm9IDaw41r4/fM8vpSkEnWpvi8YDiYQIgT3Jr8ngv73vM1NQYxh0Y
tKwVJcr/xakizPZbhndyWH8=
-----END CERTIFICATE-----
`;
const LEAF_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgJ5h1xpLdFirA96wk
iHUKbvtf/pe3KxSw22XmslT+yc2hRANCAATxv6j1s9WBuBht9mvTWKTWKg6Tpgqg
s4terwh2OVQFHOOBjQDHu/KwecfF7Wf47abjVradVUjf57XtbKED9Axa
-----END PRIVATE KEY-----
`;

const ITEST_TIMEOUT_MS = 10_000;

async function withServer<T>(body: (port: number) => Promise<T>): Promise<T> {
    const server = tls.createServer({ key: LEAF_KEY_PEM, cert: LEAF_PEM }, (socket: TLSSocket) => socket.end('Hello'));
    server.on('tlsClientError', () => {});
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve());
    });
    try {
        return await body((server.address() as AddressInfo).port);
    } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
}

function secureConnect(options: tls.ConnectionOptions): Promise<GjsifyTLSSocket> {
    return new Promise((resolve, reject) => {
        const client = tls.connect({ host: '127.0.0.1', servername: 'localhost', ...options });
        client.once('secureConnect', () => resolve(client as unknown as GjsifyTLSSocket));
        client.once('error', reject);
    });
}

/**
 * Run `body` and return the signal names `@gjsify/tls` connected on every
 * `Gio.TlsClientConnection` it created meanwhile.
 */
async function connectedSignals(body: () => Promise<void>): Promise<string[]> {
    const names: string[] = [];
    const create = Gio.TlsClientConnection.new;
    Gio.TlsClientConnection.new = (...args: Parameters<typeof create>) => {
        const conn = create(...args);
        const connect = conn.connect.bind(conn);
        conn.connect = ((name: string, callback: never) => {
            names.push(name);
            return connect(name, callback);
        }) as typeof conn.connect;
        return conn;
    };
    try {
        await body();
    } finally {
        Gio.TlsClientConnection.new = create;
    }
    return names;
}

export default async () => {
    await on('Gjs', async () => {
        await describe('TLSSocket verification — no JS callback on the handshake thread', async () => {
            await it(
                'verifies a leaf against `ca` without a JS accept-certificate handler',
                async () => {
                    await withServer(async (port) => {
                        const signals = await connectedSignals(async () => {
                            const client = await secureConnect({ port, ca: CA_PEM });
                            expect(client.authorized).toBe(true);
                            client.destroy();
                        });
                        expect(signals).not.toContain('accept-certificate');
                    });
                },
                ITEST_TIMEOUT_MS,
            );

            await it(
                'passes rejectUnauthorized: false without a JS accept-certificate handler',
                async () => {
                    await withServer(async (port) => {
                        const signals = await connectedSignals(async () => {
                            const client = await secureConnect({ port, rejectUnauthorized: false });
                            expect(client.authorized).toBe(false);
                            client.destroy();
                        });
                        expect(signals).not.toContain('accept-certificate');
                    });
                },
                ITEST_TIMEOUT_MS,
            );
        });

        await describe('TLSSocket TCP options', async () => {
            await it(
                'reach the kernel socket under the TLS connection',
                async () => {
                    await withServer(async (port) => {
                        const client = await secureConnect({ port, ca: CA_PEM });
                        const socket = (
                            client._tlsConnection as Gio.TlsConnection & { base_io_stream: Gio.SocketConnection }
                        ).base_io_stream.get_socket();
                        client.setKeepAlive(true);
                        expect(socket.get_keepalive()).toBe(true);
                        client.setKeepAlive(false);
                        expect(socket.get_keepalive()).toBe(false);
                        client.destroy();
                    });
                },
                ITEST_TIMEOUT_MS,
            );
        });

        await describe('TLSSocket session resumption', async () => {
            await it(
                'keeps the connection out of the process-wide session cache',
                async () => {
                    await withServer(async (port) => {
                        const client = await secureConnect({ port, ca: CA_PEM });
                        // glib-networking resumes a cached session without sending a
                        // certificate, so `ca`/`rejectUnauthorized` of the NEXT
                        // connection to this host would never be consulted.
                        expect(
                            (client._tlsConnection as unknown as { session_resumption_enabled: boolean })
                                .session_resumption_enabled,
                        ).toBe(false);
                        client.destroy();
                    });
                },
                ITEST_TIMEOUT_MS,
            );
        });
    });
};
