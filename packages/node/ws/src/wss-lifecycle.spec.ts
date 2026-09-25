// oxlint-disable typescript/no-explicit-any -- ws-API-shape spec, same rationale as close-lifecycle.spec.ts: ws's 'connection'/'close' payloads are typed `any` as an npm `ws` consumer writes them, and `globalThis.imports` is the GJS bootstrap object, which has no Node-side type.
// SPDX-License-Identifier: MIT
// Close lifecycle over TLS (wss) — original.
//
// terminate() shuts the TCP socket down underneath Soup. Over TLS the stream
// Soup reads is a GTlsConnection wrapping that socket, so the shutdown has to
// be found one level deeper, and the TLS layer then meets EOF without a
// close_notify.
// These cases pin that both ends still report exactly one 'close' with 1006
// and no 'error', as npm ws does on Node.
//
// The server differs per runtime, the assertions do not: Node uses
// https.createServer; on GJS a TLS Soup.Server is attached through ws's
// `{ server }` mode, because @gjsify/https's Server does not terminate TLS
// yet (status/open-todos.md).

import { describe, it, expect } from '@gjsify/unit';
import { createServer as createHttpsServer } from 'node:https';
import { WebSocket, WebSocketServer } from 'ws';

// A self-signed RSA-2048 cert + key (CN=localhost, SAN DNS:localhost +
// IP:127.0.0.1, 100 years) — the one @gjsify/fetch's tls-abort.gjs.spec.ts
// embeds, inline for the same reason: the spec stays hermetic. Regenerate with:
//   openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 36500 \
//     -subj /CN=localhost -addext "subjectAltName = DNS:localhost,IP:127.0.0.1"
const SELF_SIGNED_CERT_AND_KEY = `-----BEGIN CERTIFICATE-----
MIIDJzCCAg+gAwIBAgIUKYxN2Fykn0Sr0YIq7h11xSofpYQwDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJbG9jYWxob3N0MCAXDTI2MDcxMTA4MzcwN1oYDzIxMjYw
NjE3MDgzNzA3WjAUMRIwEAYDVQQDDAlsb2NhbGhvc3QwggEiMA0GCSqGSIb3DQEB
AQUAA4IBDwAwggEKAoIBAQC9S/lXTWdjIpw7dI2v2095KssX99/Kh6xznHZ9Ed3D
gGGivMXSkPJfFeEj/LecSTJn0YVxGtu/tdon3Gnswk3JfFBuzm0MG5ks4puRkKsu
JV8+TtpcsBHVglTVnTqiw44yfk+VZdLomZHdcd61sTG7r97+TtVHbjZqQ0rKjhwB
fv3TysLrvE07rrB1UbagISroYg+G5EysQH0Yu9JbRsvefOKaK9vwq/jbrdSWFrez
R6xePGZsInr38Zt57O32ok0HMsT+DOeB+2GE0xd4+gEgr3XXHSP2PrWOtDtq74d0
25H9kFpp7C4kypY/lt6/i6D7CKu685zK68EKyb3EvyubAgMBAAGjbzBtMB0GA1Ud
DgQWBBTkl+nvQOXFs4mOZRQFIXy9MCCjJjAfBgNVHSMEGDAWgBTkl+nvQOXFs4mO
ZRQFIXy9MCCjJjAPBgNVHRMBAf8EBTADAQH/MBoGA1UdEQQTMBGCCWxvY2FsaG9z
dIcEfwAAATANBgkqhkiG9w0BAQsFAAOCAQEAfkpo3YBTfdLAGBcrkDo0WSJYpPAK
4rIZ3zk8aWeMzockt9NZ3/1+1OwtFDmL2bHHxHJF03DuPbgQR4uq3EBNPWGP72dy
+WsTGe6NJakt3QVYq5+73mtxy7fu/e4IF0vPQ9O/euDZoPQiplT7u/AcBcVZvlRv
t/TGdolGlGT7lzx6WYXrAmpCyQnQu/CU/OM9DBFVy22i+QbtJpd6HJdr68Nry56V
exU4w6PAIpKdAY4fayvooSDBCOetDuYJ8sIeiFM4xNwK55h/dedvEZWbsHr5OwJ6
dW8IEugXvvXvGrs3QJjSOd1B9HFsmZLyzZ5Ym3s6jl96DaTEvqBM5kKMVw==
-----END CERTIFICATE-----
-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC9S/lXTWdjIpw7
dI2v2095KssX99/Kh6xznHZ9Ed3DgGGivMXSkPJfFeEj/LecSTJn0YVxGtu/tdon
3Gnswk3JfFBuzm0MG5ks4puRkKsuJV8+TtpcsBHVglTVnTqiw44yfk+VZdLomZHd
cd61sTG7r97+TtVHbjZqQ0rKjhwBfv3TysLrvE07rrB1UbagISroYg+G5EysQH0Y
u9JbRsvefOKaK9vwq/jbrdSWFrezR6xePGZsInr38Zt57O32ok0HMsT+DOeB+2GE
0xd4+gEgr3XXHSP2PrWOtDtq74d025H9kFpp7C4kypY/lt6/i6D7CKu685zK68EK
yb3EvyubAgMBAAECggEABQaKqFFuUYIiKaUafByGSqXIlLmVsdwSMQfqlFX9l7uj
m/Hhs68YGSG9x0lPOcgBd+aMcMZtcfwUL1u7P9ZF0Fm8d2YLSaDqTB28njywrzZU
nI2LFGJ2v6/QQvFWo8yXAVulLTAuLy2R+bey0hodSt55l0/wL3FS4pGgubjyTgr+
ZY4DWjxwdPqZSC29nBN6HtOU0LMt+0UZS4QoSkb4LP/OSG7ZfZk2ssuVJioZnNwS
Gh6XB7YjzDkMcYtZ9Os8rvFdeECqM53N3DT8RHImbQZpkamodhJR5/Y7MNFAfg0l
yISz8u47iS2ZJV/3ePbxOotRtAPLbyErfo1PVkOsgQKBgQDz53RUbKTvEzXTVcTW
MhDc4pNtT7FWNmAhYCaVboJk6jisWOagzUHSZyJd+KFOPCwW0TZAd3DXbAjBCVg7
/Yuxu0K3tvYsDRAyaKrDrF4I03aS3d7GlbaNBxNmWZXwd6UloLmXQvmWooX7FlfM
WXV2BgfEc/RaQV4e+CcZgd96GwKBgQDGrz0HsgaiqBknWtDjVJEEnU3DMEEWPF6u
NQ+YZ3gOJE7yIIs/aJXK1TJE+i+CMI9y+O50eyHIqE6xbF/aM0gTgAzzWPVwan4z
P+8MZcHrRrLUWCi/hULQXjzKAh33zUc8+npEewIIaIe2SQp/j4NTYKjYqXS6Vkvh
cR6oQNIsgQKBgQCExsJ4VzCuiZmqs61VIao2ZQ322wRiN3W7lZlLjf5kK3GwuTDL
5xFnFggKehht+6nQvhG3pI4EZ+aYF5s2BT/wAE5ArtRyhKYFmx8jKImEaoHJUAk/
uC7JtUllVW2fm7KGumluI+K1k0I2vyIKt8SO/Jdr5efm3mD7oQHADAh5cwKBgHUq
slrvaWpSp0LGE5l8LWkDOvB4bGmogE1LjT7bBbmRP90ZxARIsM1EnLiAsbOc33t1
wWl/k5S5bG7E8mHDDCYzxW9cbqE0q+edNGOjPpB4yMzgkGchNx2Z9U9LoFCaBgC3
1ZK8154NxrqAqGhBQbjRr8DVbbjVWzo/c0zVrRwBAoGBAJ8USM/06E60u0Tq8zU9
q1z0p3hu++Gude5e9IHp3tnS2/MLIbJDyfvkVkx5gLJXKYdEykP10CLOqu8DC1c5
9FvsYKlRm0GzDlTtX12jXGWHaQXy9Di69Sd3J6StLf04IEl3W4e9KTg7zDA9cg94
StMiAiohwWMqIzCc88GovQMF
-----END PRIVATE KEY-----
`;

interface TlsServer {
    wss: WebSocketServer;
    port: number;
    close(): void;
}

async function startTlsServer(): Promise<TlsServer> {
    const gi = (globalThis as any).imports?.gi;
    if (gi) {
        const { Soup, Gio } = gi;
        const soup = new Soup.Server({});
        soup.set_tls_certificate(Gio.TlsCertificate.new_from_pem(SELF_SIGNED_CERT_AND_KEY, -1));
        soup.listen_local(0, Soup.ServerListenOptions.HTTPS | Soup.ServerListenOptions.IPV4_ONLY);
        const port: number = soup.get_uris()[0].get_port();
        const address = () => ({ address: '127.0.0.1', family: 'IPv4', port });
        const wss = new WebSocketServer({ server: { soupServer: soup, address } as any });
        return {
            wss,
            port,
            close() {
                wss.close();
                soup.disconnect();
            },
        };
    }
    const https = createHttpsServer({ cert: SELF_SIGNED_CERT_AND_KEY, key: SELF_SIGNED_CERT_AND_KEY });
    await new Promise<void>((resolve) => https.listen(0, '127.0.0.1', () => resolve()));
    const wss = new WebSocketServer({ server: https });
    return {
        wss,
        port: (https.address() as any).port,
        close() {
            wss.close();
            https.close();
            https.closeAllConnections();
        },
    };
}

interface Side {
    closes: Array<{ code: number; reason: string }>;
    errors: Error[];
    closed: Promise<void>;
}

/** Records every 'close' and 'error' on one end. `closed` settles a moment
 *  after the first 'close', so a second one — or an 'error' — is caught. */
function watch(ws: any): Side {
    const side: Side = { closes: [], errors: [], closed: Promise.resolve() };
    ws.on('error', (err: Error) => side.errors.push(err));
    side.closed = new Promise((resolve) => {
        ws.on('close', (code: number, reason: Buffer) => {
            side.closes.push({ code, reason: String(reason) });
            setTimeout(resolve, 50);
        });
    });
    return side;
}

async function withTlsPair(body: (server: any, client: WebSocket) => Promise<void>): Promise<void> {
    const tls = await startTlsServer();
    try {
        const connection = new Promise<any>((resolve) => tls.wss.on('connection', (ws: any) => resolve(ws)));
        const client = new WebSocket(`wss://127.0.0.1:${tls.port}/`, { rejectUnauthorized: false });
        const opened = new Promise<void>((resolve, reject) => {
            client.once('open', () => resolve());
            client.once('error', reject);
        });
        const server = await connection;
        await opened;
        await body(server, client);
    } finally {
        tls.close();
    }
}

export default async () => {
    await describe('WebSocket close lifecycle over TLS (wss)', async () => {
        await it('verifies the certificate unless rejectUnauthorized is false', async () => {
            const tls = await startTlsServer();
            try {
                let connections = 0;
                tls.wss.on('connection', () => connections++);
                const client = new WebSocket(`wss://127.0.0.1:${tls.port}/`);
                const side = watch(client);
                await side.closed;
                expect(side.errors.length).toBe(1);
                expect(side.closes.length).toBe(1);
                expect(side.closes[0].code).toBe(1006);
                expect(connections).toBe(0);
            } finally {
                tls.close();
            }
        });

        await it('carries messages and a clean close', async () => {
            await withTlsPair(async (server, client) => {
                const serverSide = watch(server);
                const clientSide = watch(client);
                const echoed = new Promise<string>((resolve) => client.once('message', (d: any) => resolve(String(d))));
                server.on('message', (d: any) => server.send(String(d)));
                client.send('over tls');
                expect(await echoed).toBe('over tls');
                client.close(1001, 'away');
                await serverSide.closed;
                await clientSide.closed;
                expect(serverSide.closes).toStrictEqual([{ code: 1001, reason: 'away' }]);
                expect(clientSide.closes).toStrictEqual([{ code: 1001, reason: 'away' }]);
                expect(serverSide.errors.length).toBe(0);
                expect(clientSide.errors.length).toBe(0);
            });
        });

        for (const side of ['server', 'client'] as const) {
            await it(`${side} terminate() drops the connection: one 'close' (1006) each, no 'error'`, async () => {
                await withTlsPair(async (server, client) => {
                    const serverSide = watch(server);
                    const clientSide = watch(client);
                    (side === 'server' ? server : client).terminate();
                    await serverSide.closed;
                    await clientSide.closed;
                    expect(serverSide.closes.length).toBe(1);
                    expect(serverSide.closes[0].code).toBe(1006);
                    expect(clientSide.closes.length).toBe(1);
                    expect(clientSide.closes[0].code).toBe(1006);
                    expect(serverSide.errors.map((e) => e.message).join('; ')).toBe('');
                    expect(clientSide.errors.map((e) => e.message).join('; ')).toBe('');
                });
            });
        }
    });
};
