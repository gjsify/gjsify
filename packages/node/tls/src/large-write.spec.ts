// SPDX-License-Identifier: MIT
// Regression: a write larger than one TLS record (16 KB) used to stall. Gio's TLS output stream
// accepts one record per `write_bytes_async`, and `Socket._write` dropped the unwritten rest,
// so the peer received 16-32 KB of a 100 KB write and then nothing (found via nodemailer
// sending a mail with an attachment over SMTPS).

import { describe, it, expect } from '@gjsify/unit';
import tls from 'node:tls';
import { Buffer } from 'node:buffer';

// Self-signed, CN=localhost, SAN DNS:localhost + IP:127.0.0.1 (same fixture as starttls-server.spec.ts).
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

const TIMEOUT_MS = 8000;

async function transfer(size: number, direction: 'toServer' | 'toClient'): Promise<number> {
    return new Promise<number>((resolve) => {
        let got = 0;
        let server: tls.Server;
        const sockets: tls.TLSSocket[] = [];
        const finish = () => {
            clearTimeout(timer);
            for (const s of sockets) s.destroy();
            server.close(() => resolve(got));
        };
        const timer = setTimeout(finish, TIMEOUT_MS);
        const sink = (s: tls.TLSSocket) =>
            s.on('data', (d: Buffer) => {
                got += d.length;
                if (got >= size) finish();
            });
        const source = (s: tls.TLSSocket) => s.write(Buffer.alloc(size, 0x61));
        server = tls.createServer({ key: KEY_PEM, cert: CERT_PEM }, (conn) => {
            conn.on('error', () => {});
            sockets.push(conn);
            if (direction === 'toServer') sink(conn);
            else source(conn);
        });
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address() as { port: number };
            const client = tls.connect({ host: '127.0.0.1', port, servername: 'localhost', ca: CERT_PEM });
            client.on('error', () => {});
            sockets.push(client);
            client.on('secureConnect', () => (direction === 'toServer' ? source(client) : sink(client)));
        });
    });
}

export default async () => {
    await describe('tls large writes', async () => {
        for (const size of [20_000, 100_000, 1_048_576]) {
            for (const direction of ['toServer', 'toClient'] as const) {
                await it(`delivers one ${size}-byte write ${direction}`, async () => {
                    expect(await transfer(size, direction)).toBe(size);
                });
            }
        }
    });
};
