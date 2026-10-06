// SPDX-License-Identifier: MIT
// Original work, no Node counterpart: `refs/node`'s tls tests verify against
// a self-signed certificate that is its own CA, which hides every bug in
// verifying a LEAF against a separate CA — the shape of a real server
// (nodemailer + a private CA was the incident).
//
// Runs on both platforms: Node validates the TEST, GJS validates `@gjsify/tls`.

import { describe, it, expect } from '@gjsify/unit';
import tls from 'node:tls';
import type { AddressInfo } from 'node:net';
import type { Server as TlsServer, TLSSocket } from 'node:tls';

// ECDSA P-256 test PKI, valid until 2126: CA = `CN=gjsify-test-ca`
// (basicConstraints CA:TRUE), leaf = `CN=localhost`, SAN DNS:localhost +
// IP:127.0.0.1, signed by the CA. Fixture only — never trusted outside tests.
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

// Hang detectors, not performance budgets.
const ITEST_TIMEOUT_MS = 10_000;

async function withServer<T>(body: (port: number) => Promise<T>): Promise<T> {
    const server = tls.createServer({ key: LEAF_KEY_PEM, cert: LEAF_PEM }, (socket: TLSSocket) =>
        socket.end('Hello'),
    ) as unknown as TlsServer;
    // A client refusing the certificate aborts the handshake — expected here.
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

/** Settle with the handshake's outcome: the error code, or `'secureConnect'`. */
function handshakeOutcome(client: TLSSocket): Promise<{ outcome: string; authorized: boolean }> {
    return new Promise((resolve) => {
        client.once('secureConnect', () => {
            const authorized = client.authorized;
            client.destroy();
            resolve({ outcome: 'secureConnect', authorized });
        });
        client.once('error', (err: NodeJS.ErrnoException) =>
            resolve({ outcome: err.code ?? err.message, authorized: client.authorized }),
        );
    });
}

/** Connect once and settle with the outcome, mirroring what a caller sees. */
function connectOnce(port: number, options: tls.ConnectionOptions): Promise<{ outcome: string; authorized: boolean }> {
    return handshakeOutcome(tls.connect({ port, host: '127.0.0.1', servername: 'localhost', ...options }));
}

export default async () => {
    await describe('tls.connect({port}) — leaf signed by a separate CA', async () => {
        await it(
            'accepts the leaf when `ca` holds the signing CA',
            async () => {
                await withServer(async (port) => {
                    const client = tls.connect({ port, host: '127.0.0.1', servername: 'localhost', ca: CA_PEM });
                    expect(await handshakeOutcome(client)).toStrictEqual({
                        outcome: 'secureConnect',
                        authorized: true,
                    });
                });
            },
            ITEST_TIMEOUT_MS,
        );

        await it(
            'rejects the leaf without a matching `ca`',
            async () => {
                await withServer(async (port) => {
                    const client = tls.connect({ port, host: '127.0.0.1', servername: 'localhost' });
                    expect(await handshakeOutcome(client)).toStrictEqual({
                        outcome: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
                        authorized: false,
                    });
                });
            },
            ITEST_TIMEOUT_MS,
        );

        await it(
            'rejects a servername the leaf does not cover, even with the right `ca`',
            async () => {
                await withServer(async (port) => {
                    const client = tls.connect({ port, host: '127.0.0.1', servername: 'wrong.example', ca: CA_PEM });
                    expect((await handshakeOutcome(client)).outcome).toBe('ERR_TLS_CERT_ALTNAME_INVALID');
                });
            },
            ITEST_TIMEOUT_MS,
        );

        await it(
            'passes an unverifiable leaf with rejectUnauthorized: false',
            async () => {
                await withServer(async (port) => {
                    const client = tls.connect({
                        port,
                        host: '127.0.0.1',
                        servername: 'localhost',
                        rejectUnauthorized: false,
                    });
                    expect(await handshakeOutcome(client)).toStrictEqual({
                        outcome: 'secureConnect',
                        authorized: false,
                    });
                });
            },
            ITEST_TIMEOUT_MS,
        );

        await it(
            'does not let a session verified under `ca` skip verification for a later connection without it',
            async () => {
                await withServer(async (port) => {
                    // Read to the end: the server's session ticket arrives with the first bytes.
                    const first = tls.connect({ port, host: '127.0.0.1', servername: 'localhost', ca: CA_PEM });
                    await new Promise<void>((resolve, reject) => {
                        first.resume();
                        first.once('end', () => resolve());
                        first.once('error', reject);
                    });
                    expect(first.authorized).toBe(true);
                    expect(await connectOnce(port, {})).toStrictEqual({
                        outcome: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
                        authorized: false,
                    });
                });
            },
            ITEST_TIMEOUT_MS,
        );

        await it(
            'lets a secured socket set keep-alive and no-delay',
            async () => {
                await withServer(async (port) => {
                    const client = tls.connect({ port, host: '127.0.0.1', servername: 'localhost', ca: CA_PEM });
                    await new Promise<void>((resolve, reject) => {
                        client.once('secureConnect', () => resolve());
                        client.once('error', reject);
                    });
                    expect(client.setKeepAlive(true)).toBe(client);
                    expect(client.setNoDelay(true)).toBe(client);
                    client.destroy();
                });
            },
            ITEST_TIMEOUT_MS,
        );
    });
};
