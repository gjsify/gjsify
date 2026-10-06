// SPDX-License-Identifier: MIT
// GJS-only — TCP options set on a TLS-secured socket must reach the kernel
// socket: `get_socket` exists only on the Gio.SocketConnection that a
// Gio.TlsConnection wraps, so asking the TLS connection for it threw.

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

export default async () => {
    await on('Gjs', async () => {
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
    });
};
