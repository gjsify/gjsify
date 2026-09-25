// SPDX-License-Identifier: MIT
// Original regression tests: `http2.createSecureServer({ key, cert })` must terminate TLS with the
// given certificate. The GJS server once set the certificate on its Soup.Server but listened
// without libsoup's HTTPS flag, i.e. in plain text. A real TLS client pins the certificate the
// server presents and speaks HTTP/1.1 over it (`allowHTTP1`), on Node and on GJS alike.

import { describe, it, expect } from '@gjsify/unit';
import { createSecureServer, type Http2SecureServer } from 'node:http2';
import { connect, type TLSSocket } from 'node:tls';

// The self-signed server pair from @gjsify/https's server-tls.spec.ts (CN=localhost,
// SAN DNS:localhost + IP:127.0.0.1, valid until 2126).
const SERVER_CERT = `-----BEGIN CERTIFICATE-----
MIIDJzCCAg+gAwIBAgIUCxvknC+4p0DjnrhWH0Zq0FG+/VswDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJbG9jYWxob3N0MCAXDTI2MDkyNTA4MDY0MVoYDzIxMjYw
OTAxMDgwNjQxWjAUMRIwEAYDVQQDDAlsb2NhbGhvc3QwggEiMA0GCSqGSIb3DQEB
AQUAA4IBDwAwggEKAoIBAQCwvBT+lfkh+9eykeiZj1By6qOd/2VI0Idgv79dIQnC
7iSLsf7ZWR7tdWMrSppM1VZnYZ3ahyrsZrYcqQxj/1pQyOIVi+3yUG5z9yb/qXVb
G46is+/kp/xxDRMUTIgzAweOyIBBRw/zfIWYVn746SIILdHqXihpEno/rv/UlXWJ
kAtcLcJPIzUIeOzi3ko413BU1NlJwgmVRMJTqMdwYIwptZ9gmq0iNAucslDY4Xcv
8aUNue9jfvcgRAt0hVRmmCgTt++IBywhvjc2w+uW3YXxuDnzuBhatb+gophIQttN
EvYS5zFzlrlcZ39IlwZry0cnBBBdDlJMBOw8nV9GvjYBAgMBAAGjbzBtMB0GA1Ud
DgQWBBQOFkB2am1fEH+94C7gXsp1l+ZvMzAfBgNVHSMEGDAWgBQOFkB2am1fEH+9
4C7gXsp1l+ZvMzAPBgNVHRMBAf8EBTADAQH/MBoGA1UdEQQTMBGCCWxvY2FsaG9z
dIcEfwAAATANBgkqhkiG9w0BAQsFAAOCAQEADmwE+rChd4ruDFYB62qvUx+kQw3v
2nnjvyRMWpTpaQz051oaR7AN+iWEZzF5UeAgHLGb20B7gJD5lzwkU8RD64s/n/WS
rRFq4cwuSN46E0k2CKRVZNJW1AWqT08JkJ+Ma13XnTUF0ghDUgjBCIR+l+K9tc+n
WcCTUh2iqKqX6uUZVhyahNJNzOyq30BkUbj+pNAccV/elkPFveZJdsAsPRsFWnbs
QtQhbd+7YfmKVsUsaM+hLhXzb0FmSF+E4uMOMnoZ78/Pp6Fv/RYs2vpeM5j7xU9U
OLMTX35m7W3eXGS5rqnG70Sfjnu9YrMMSkdAH7ZpEmNhfeaBY9RRmUwaLQ==
-----END CERTIFICATE-----
`;

const SERVER_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCwvBT+lfkh+9ey
keiZj1By6qOd/2VI0Idgv79dIQnC7iSLsf7ZWR7tdWMrSppM1VZnYZ3ahyrsZrYc
qQxj/1pQyOIVi+3yUG5z9yb/qXVbG46is+/kp/xxDRMUTIgzAweOyIBBRw/zfIWY
Vn746SIILdHqXihpEno/rv/UlXWJkAtcLcJPIzUIeOzi3ko413BU1NlJwgmVRMJT
qMdwYIwptZ9gmq0iNAucslDY4Xcv8aUNue9jfvcgRAt0hVRmmCgTt++IBywhvjc2
w+uW3YXxuDnzuBhatb+gophIQttNEvYS5zFzlrlcZ39IlwZry0cnBBBdDlJMBOw8
nV9GvjYBAgMBAAECggEAGFYl6/K55jCYQKov5elishhWZHzVNSQl6DAvSUMx5WpG
lQfzKHnJtPgrqjvxKHBeIAlEo+FmCzyPij3LC4APrz0iSMZGg04JD6XydFUg6GVQ
jF4LxChPrj+XJ33saV3a7hH0+0guTaCRgusyO9NakNbCZ6wEk4dsVxWhe+QC1ejJ
VfU0wepjsGgguv7TRLwKPYDDw0t+AV6ApAsAe1BmDzGewBbQfyU/qWChlF+9zLac
tORbatHFbfYGTc/OhnozsfXLTWKyTc45MqYOUzW3ZdlNJrpWOnZVnDMCbIjMJU81
xU8mke5dm36dJR3SfSSs/Ss4IFuJpUSJ1LYKQvsFIwKBgQDy/l46lXfWyxMRtrd7
RkIDG9s7IPZ3oBJ9RD6gVKxFIde4tSs7D+Bq6hHDqcSdTn6oI8xqVVMyogTVgU42
wbse2AzhARjjon+Yj5ESGGPBNsClfsYO9nzwxXaeD/PShX/BYXRg5pTFg9Y55UT8
wEwm4xLFv9y8oL+RVYrAnv6EVwKBgQC6Mcw4Izg8ncQ64UZUwQu3+7AC8kfEe9dW
nkSYB3ez7gwraWUEqQyH33QHxdjV8/1Z8af0XQMnHpDJkERstaZ+xKAdHe33PTR2
1ERWtq8jaxRQ3v8kweOBeCqyiOTLP4BlZi2lBNxoTCEWwok1gy6duU5XfZaD38X/
ZaakBB5hZwKBgQDa053yLiak5W5/1kc4GdZazFxKzG2I3zunWaz4YChffZGyglyz
LKISRkbHKPyqGUVQkCSHYd2xzFyEFZVlFGQ566D1hDJw1ScJMckYPaSgHHmy0A72
7J0pivo+b+lInfamJOhUV3KEySxEKSdOYrJxlq6SLS1RJYY/EIUK4GQeswKBgFXc
Es0sSImDQvLX4QPCRXIg6MhjCv8rEGDL+NuWTfe15Py7zC56+eFKBIp1DImUypaI
XifMIGEQsjmQgk0S8uTwLNlgbNSe76uANMc71MVjYmnsewFrO0r/q8jKYZ7r+HxJ
wvCerjiWKogBSx5XEM8AnYSw0BCdxwL/z/lAQPYvAoGBAIGC2wECRBFTj8rp17lC
lXs38BM2RW2qWJ1kmisJWvigq4deokGBtfgJEo0dpqOSQaLP+XlAMH+pcII8ukZI
ZPAswZ+0Wcoku1Nb2l60+moBc4nYr863/NV1emwbcPCdU8zVHW2hi2cpS3r8IagT
gFF8oSAu1p8i7+Z19ph5iSk4
-----END PRIVATE KEY-----
`;

const SERVER_FINGERPRINT256 =
    'AE:AC:8E:50:39:BE:1C:0F:B8:C2:4A:2D:F0:AC:51:3C:28:A1:12:52:85:07:15:DF:B9:73:FD:C0:65:F3:69:A9';

const BODY = 'hello over h2 tls';

function listen(server: Http2SecureServer): Promise<number> {
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            resolve(typeof address === 'object' && address ? address.port : 0);
        });
    });
}

/** HTTP/1.1 GET over TLS; resolves with the peer's fingerprint and the response once BODY arrived. */
function exchange(port: number, trustServer: boolean): Promise<{ fingerprint256?: string; response: string }> {
    return new Promise((resolve, reject) => {
        let settled = false;
        let data = '';
        let fingerprint256: string | undefined;
        const settle = (err: Error | null): void => {
            if (settled) return;
            settled = true;
            socket.destroy();
            if (err) reject(err);
            else resolve({ fingerprint256, response: data });
        };
        const socket: TLSSocket = connect(
            {
                host: '127.0.0.1',
                port,
                servername: 'localhost',
                ALPNProtocols: ['http/1.1'],
                ...(trustServer ? { ca: SERVER_CERT } : {}),
            },
            () => {
                fingerprint256 = socket.getPeerCertificate()?.fingerprint256;
                socket.write('GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n');
            },
        );
        socket.setEncoding('utf8');
        socket.on('data', (chunk: string) => {
            data += chunk;
            if (data.includes(BODY)) settle(null);
        });
        socket.on('error', (err: Error) => settle(err));
        socket.on('close', () => settle(new Error('connection closed without a response')));
    });
}

export default async () => {
    await describe('http2.createSecureServer TLS termination', async () => {
        await it('presents the configured certificate and serves HTTP/1.1 over it', async () => {
            let calls = 0;
            const server = createSecureServer({ key: SERVER_KEY, cert: SERVER_CERT, allowHTTP1: true }, (_req, res) => {
                calls++;
                res.end(BODY);
            });
            const port = await listen(server);
            try {
                const result = await exchange(port, true);
                expect(result.fingerprint256).toBe(SERVER_FINGERPRINT256);
                expect(result.response.startsWith('HTTP/1.1 200')).toBe(true);
                expect(calls).toBe(1);
            } finally {
                await new Promise<void>((resolve) => server.close(() => resolve()));
            }
        });

        await it('is rejected by a client that does not trust the certificate', async () => {
            let calls = 0;
            const server = createSecureServer({ key: SERVER_KEY, cert: SERVER_CERT, allowHTTP1: true }, (_req, res) => {
                calls++;
                res.end(BODY);
            });
            const port = await listen(server);
            try {
                let error: unknown = null;
                try {
                    await exchange(port, false);
                } catch (err) {
                    error = err;
                }
                expect(error instanceof Error).toBe(true);
                expect(calls).toBe(0);
            } finally {
                await new Promise<void>((resolve) => server.close(() => resolve()));
            }
        });
    });
};
