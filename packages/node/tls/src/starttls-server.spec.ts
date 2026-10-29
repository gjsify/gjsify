// SPDX-License-Identifier: MIT
// Server side of an in-place upgrade: a plain TCP connection speaks plaintext,
// then `new tls.TLSSocket(socket, { isServer: true, key, cert })` takes it
// over while the client upgrades with `tls.connect({ socket })` — the shape of
// an SMTP/IMAP/XMPP STARTTLS server.

import { describe, it, expect } from '@gjsify/unit';
import net from 'node:net';
import tls from 'node:tls';
import type { Socket } from 'node:net';

// Self-signed, CN=localhost, SAN DNS:localhost + IP:127.0.0.1 (same fixture as given-socket.spec.ts).
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

function nextChunk(socket: Socket): Promise<string> {
    return new Promise((resolve, reject) => {
        socket.once('error', reject);
        socket.once('data', (chunk: Buffer) => {
            socket.removeListener('error', reject);
            resolve(chunk.toString('utf8'));
        });
    });
}

export default async () => {
    await describe('server-side in-place TLS upgrade (new TLSSocket(socket, {isServer}))', async () => {
        await it(
            'upgrades an accepted plain socket after a plaintext exchange; both sides talk TLS',
            async () => {
                let serverSecure: tls.TLSSocket | null = null;
                const serverLines: string[] = [];
                const server = net.createServer((conn: Socket) => {
                    conn.on('error', () => {});
                    conn.write('220 hello\r\n');
                    conn.once('data', (chunk: Buffer) => {
                        serverLines.push(chunk.toString('utf8'));
                        conn.write('220 go-ahead\r\n', () => {
                            const secure = new tls.TLSSocket(conn, { isServer: true, key: KEY_PEM, cert: CERT_PEM });
                            serverSecure = secure;
                            secure.on('error', () => {});
                            secure.on('data', (data: Buffer) => {
                                secure.write(`ECHO:${data.toString('utf8')}`);
                            });
                        });
                    });
                });
                await new Promise<void>((resolve, reject) => {
                    server.once('error', reject);
                    server.listen(0, '127.0.0.1', () => resolve());
                });
                const { port } = server.address() as { port: number };
                let client: tls.TLSSocket | null = null;
                try {
                    const reply = await withTimeout(
                        (async () => {
                            const plain = net.connect(port, '127.0.0.1');
                            expect(await nextChunk(plain)).toBe('220 hello\r\n');
                            plain.write('STARTTLS\r\n');
                            expect(await nextChunk(plain)).toBe('220 go-ahead\r\n');
                            client = tls.connect({ socket: plain, servername: 'localhost', ca: CERT_PEM });
                            await new Promise<void>((resolve, reject) => {
                                client!.once('error', reject);
                                client!.once('secureConnect', () => resolve());
                            });
                            expect(client.authorized).toBe(true);
                            client.write('over-tls');
                            return nextChunk(client);
                        })(),
                        'server-side upgrade round trip',
                    );
                    expect(serverLines[0]).toBe('STARTTLS\r\n');
                    expect(reply).toBe('ECHO:over-tls');
                    expect(serverSecure !== null).toBe(true);
                    expect(serverSecure!.encrypted).toBe(true);
                } finally {
                    (client as tls.TLSSocket | null)?.destroy();
                    (serverSecure as tls.TLSSocket | null)?.destroy();
                    await new Promise<void>((resolve) => server.close(() => resolve()));
                }
            },
            ITEST_TIMEOUT_MS,
        );
    });
};
