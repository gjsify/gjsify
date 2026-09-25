// SPDX-License-Identifier: MIT
// Original regression tests: `https.createServer({ key, cert })` must terminate TLS with the given
// certificate. The GJS Server once ignored its options and listened in plain text, so these
// connect with a real TLS client, pin the certificate the server presents, and speak HTTP/1.1
// over it. The same specs run on Node (native https) to prove the expectations.
//
// Semantics follow refs/node/lib/https.js (Server = tls.Server + HTTP parser) and
// refs/node/lib/_tls_wrap.js (requestCert / rejectUnauthorized / ca on the server side).

import { describe, it, expect } from '@gjsify/unit';
import { createServer, type Server } from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { connect, type TLSSocket, type ConnectionOptions } from 'node:tls';
import http from 'node:http';
import { Buffer } from 'node:buffer';

// Self-signed server pair, valid until 2126:
//   openssl req -x509 -newkey rsa:2048 -nodes -days 36500 -subj /CN=localhost
//     -addext "subjectAltName = DNS:localhost,IP:127.0.0.1"
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

/** `openssl x509 -in server-cert.pem -noout -fingerprint -sha256` */
const SERVER_FINGERPRINT256 =
    'AE:AC:8E:50:39:BE:1C:0F:B8:C2:4A:2D:F0:AC:51:3C:28:A1:12:52:85:07:15:DF:B9:73:FD:C0:65:F3:69:A9';

// Self-signed client pair for the requestCert specs, valid until 2126:
//   openssl req -x509 -newkey rsa:2048 -nodes -days 36500 -subj /CN=gjsify-test-client
//     -addext "extendedKeyUsage = clientAuth"
const CLIENT_CERT = `-----BEGIN CERTIFICATE-----
MIIDMjCCAhqgAwIBAgIUMSjO1N528h4pKygH8PGVjCKjN0swDQYJKoZIhvcNAQEL
BQAwHTEbMBkGA1UEAwwSZ2pzaWZ5LXRlc3QtY2xpZW50MCAXDTI2MDkyNTA4MDY0
MVoYDzIxMjYwOTAxMDgwNjQxWjAdMRswGQYDVQQDDBJnanNpZnktdGVzdC1jbGll
bnQwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQCOhIvcjd8wcYZhVJ6+
PqTy1JQv/svjFBr7xsxNFa0JSt4UQvWp+e8a0m2IF0RfDtXz/zXcKcNYOnGXHcdB
FNSEy9wG1AAancobVLBBoU+h0ojYeFVR2J4kyK9YQnaAeh4KjC7nQB/5tDnQ0b3W
wmBYtuoP6FuU3q20VKI11VT9x0ZZeQupzmAskqdnpuRJAc3FQPvaLQhsLxZZWKsm
Xnf2L/OB+RTc14RS9gTEJ6Itv6vT7QoajESQIbSd7eN+dHXYXVo0AbnJ/ww94XO6
Twadv/Qyjs+TRmwwd7gRjJ5ncag5ko8cuDM/w2WfTs0/dR6jljpmOTZ9uNu2SIiT
988nAgMBAAGjaDBmMB0GA1UdDgQWBBQET3VKrE8IP+bO7x0Kqwm1vz54wjAfBgNV
HSMEGDAWgBQET3VKrE8IP+bO7x0Kqwm1vz54wjAPBgNVHRMBAf8EBTADAQH/MBMG
A1UdJQQMMAoGCCsGAQUFBwMCMA0GCSqGSIb3DQEBCwUAA4IBAQAqkXjkssjpZyik
9anq56l/hYXDCHi+3mScQcBKUrLuceOMH+gof0BIX0GmVws/4YMvMInUFy3fr0Ti
oXE4Q+LXDm4k8tLrzuFgwVMbOBAv1zUZL3ZygBkp7Y1PlNXRHVnFxopM0qIOWUE9
fuTJUFVFEBXxFCd7c7kbXnxuy8yhYzwBQd0cpQWenXWKrgHexkLmER2hrjDkPbZh
aH6sIGpsxkOxZqRWc11gy48L2RnECGF+V1iXgMO/Ro2BycCDlwIZIwzqMCYf9JQN
4eFoZyLN4P6VLu5tc97EseEMwJdRTCiRh8qbVwx98NyGFEm/PPN0ZkhiSoafk/yL
+DqrkecF
-----END CERTIFICATE-----
`;

const CLIENT_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCOhIvcjd8wcYZh
VJ6+PqTy1JQv/svjFBr7xsxNFa0JSt4UQvWp+e8a0m2IF0RfDtXz/zXcKcNYOnGX
HcdBFNSEy9wG1AAancobVLBBoU+h0ojYeFVR2J4kyK9YQnaAeh4KjC7nQB/5tDnQ
0b3WwmBYtuoP6FuU3q20VKI11VT9x0ZZeQupzmAskqdnpuRJAc3FQPvaLQhsLxZZ
WKsmXnf2L/OB+RTc14RS9gTEJ6Itv6vT7QoajESQIbSd7eN+dHXYXVo0AbnJ/ww9
4XO6Twadv/Qyjs+TRmwwd7gRjJ5ncag5ko8cuDM/w2WfTs0/dR6jljpmOTZ9uNu2
SIiT988nAgMBAAECggEAAsqjQX3NhKtMmKTc+r8xlIh7O8w8kSU1LBmMqeise+ic
z5fKLEfdgGoYkPH0hsojGoVOuEVgv3f3/p/e/2E/+NC6oOJpLoKvUUUhskwz45vc
m1gSdijaKPOw+SqzTuvvB7TcPFWPHfrpdDPCvK12nQ/XWnPQmDdn/qBdXW5hNk4e
XBSEtijZ/ytxHupeRRI5cTR2XqovdYYy9SHEoI/ja0owffQIEtYpXI4ndN6+5D5V
1A4Eme7h3Y7TLcwTiWzWMrTZBUeB+aASVl7rC/M8fqRqV2gn/YJEZZUQGlPYMEMA
N1nUWx0J7l/Fa3OLAcPLnpUkM37zhSojArHHBIypeQKBgQDHG1WncImE0beSUzgh
L5mTtGVBhI13iyqQRbaejL7qQ7Sq91wjAO5SuZ3ZFMhTvcn9JL9+dLZx6RD4aCTd
DNEpcuo3uNXfCw052kePJoPbUGUTj7w6AgSUfHhOpSgW4Jp12nMTaIe/HAY+g4sS
k7NXFkZP+iTxJMPnDl7l6HmrSQKBgQC3PblMwYXCCzfgQtIeKwmOy4mrjUBgVl3o
tJUnmJVJdXTORDEhjCyjoELjybxTPuBPTU/BYdrjdLuYDNo/o2Y69UPOW+BIM+/l
FidmfPaI6nV2wfP8/tQ35SnkWZj5fvxGJOHXDR0AQIPmRXixxmtfVnBJD6fmo1m1
nKXKAsO27wKBgQCqSmKz1riHdKbA65QyLff4MG3531jvSYOZ6UYLzOzsiAPZxb5z
4bPz5PVwWSoNFWHQtMFjcocoXeI50zjUJsYt4S8ZgWjKXzVsqZhSgup7hQMt+91M
77TjGqH7AZ6MEoWJDtElZF3Vwi5FAVTNCq50aYSxmoxGAt/ampvnnzGQoQKBgHF/
cNPjFkdvjWeB3AXFoIDq/1XcAuDo/ffSSoShFO7QKs5MHKZr3YZoEKZo4RYq3uMf
vuPICb1TI5L1ewVp3ztriVk7PTtbuB6MT1FC261IlAM/9TFiYe5RKlZ/TKpVBkso
Mx5xx+HNFCXAKBbtELqXnqsSYGwSB9Heui3a8oDPAoGATh1vuB85p6riKztffUpn
67TnVxQT/A8lgTkOOuUiV7/BLFaE4g0QarP68RQioabqJBw+cIOxulMwmUyiSaG5
ZsZro/uLHzPGm65PAQmNMw5hGGjAKgt4+6deeJOuN3D94Ec0xuOLiS4n0pePATOR
d1RM4KGCfg+BA8tqtkmqB/c=
-----END PRIVATE KEY-----
`;

const BODY = 'hello over tls';

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

/** Answers every request with BODY plus what `req.socket.encrypted` said. */
function helloHandler(calls: { count: number }): Handler {
    return (req, res) => {
        calls.count++;
        const encrypted = (req.socket as { encrypted?: boolean }).encrypted === true;
        res.setHeader('Connection', 'close');
        res.end(`${BODY} encrypted=${encrypted}`);
    };
}

function listen(server: Server): Promise<number> {
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            resolve(typeof address === 'object' && address ? address.port : 0);
        });
    });
}

function close(server: Server): Promise<void> {
    return new Promise((resolve) => server.close(() => resolve()));
}

interface TlsExchange {
    authorized: boolean;
    subjectCN: string | undefined;
    fingerprint256: string | undefined;
    response: string;
}

/**
 * Opens a TLS connection, records what the server presented, sends one HTTP/1.1 GET and resolves
 * once the response body arrived. Rejects on any TLS or socket error — and when the connection
 * closes without a complete response, which is how a server that refuses a client certificate
 * shows up under TLS 1.3 (the client's handshake finishes before the server's verdict).
 */
function exchange(port: number, options: ConnectionOptions): Promise<TlsExchange> {
    return new Promise((resolve, reject) => {
        let settled = false;
        let data = '';
        let info: Omit<TlsExchange, 'response'> | null = null;
        const settle = (err: Error | null): void => {
            if (settled) return;
            settled = true;
            socket.destroy();
            if (err || !info) reject(err ?? new Error('no handshake'));
            else resolve({ ...info, response: data });
        };
        const socket: TLSSocket = connect({ host: '127.0.0.1', port, servername: 'localhost', ...options }, () => {
            const peer = socket.getPeerCertificate();
            info = {
                authorized: socket.authorized,
                subjectCN: peer?.subject?.CN as string | undefined,
                fingerprint256: peer?.fingerprint256,
            };
            socket.write('GET /hello HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n');
        });
        socket.setEncoding('utf8');
        socket.on('data', (chunk: string) => {
            data += chunk;
            // Resolve on the body rather than on 'end': the verdict here is what the server
            // sent, not how each TLS stack reports the close that follows it.
            if (data.includes(BODY)) settle(null);
        });
        socket.on('error', (err: Error) => settle(err));
        socket.on('close', () => settle(new Error(`connection closed without a response (got ${data.length} bytes)`)));
    });
}

/** A plain-text HTTP GET: resolves with the status code, or 'error' when the exchange failed. */
function plainGet(port: number): Promise<number | 'error'> {
    return new Promise((resolve) => {
        const req = http.get({ host: '127.0.0.1', port, path: '/hello', timeout: 5000 }, (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
        });
        req.on('timeout', () => req.destroy(new Error('timeout')));
        req.on('error', () => resolve('error'));
    });
}

export default async () => {
    await describe('https.createServer TLS termination', async () => {
        await it('presents the configured certificate and serves HTTP over it', async () => {
            const calls = { count: 0 };
            const server = createServer({ key: SERVER_KEY, cert: SERVER_CERT }, helloHandler(calls));
            const port = await listen(server);
            try {
                expect(port).toBeGreaterThan(0);
                const result = await exchange(port, { ca: SERVER_CERT });
                expect(result.authorized).toBe(true);
                expect(result.subjectCN).toBe('localhost');
                expect(result.fingerprint256).toBe(SERVER_FINGERPRINT256);
                expect(result.response.startsWith('HTTP/1.1 200')).toBe(true);
                expect(result.response).toContain(`${BODY} encrypted=true`);
                expect(calls.count).toBe(1);
            } finally {
                await close(server);
            }
        });

        await it('accepts the key and certificate as Buffers', async () => {
            const calls = { count: 0 };
            const server = createServer(
                { key: Buffer.from(SERVER_KEY), cert: Buffer.from(SERVER_CERT) },
                helloHandler(calls),
            );
            const port = await listen(server);
            try {
                const result = await exchange(port, { ca: Buffer.from(SERVER_CERT) });
                expect(result.fingerprint256).toBe(SERVER_FINGERPRINT256);
                expect(calls.count).toBe(1);
            } finally {
                await close(server);
            }
        });

        await it('is rejected by a client that does not trust the certificate', async () => {
            const calls = { count: 0 };
            const server = createServer({ key: SERVER_KEY, cert: SERVER_CERT }, helloHandler(calls));
            const port = await listen(server);
            try {
                let error: unknown = null;
                try {
                    await exchange(port, { rejectUnauthorized: true });
                } catch (err) {
                    error = err;
                }
                expect(error instanceof Error).toBe(true);
                expect(calls.count).toBe(0);
            } finally {
                await close(server);
            }
        });

        await it('does not answer a plain-text HTTP request', async () => {
            const calls = { count: 0 };
            const server = createServer({ key: SERVER_KEY, cert: SERVER_CERT }, helloHandler(calls));
            const port = await listen(server);
            try {
                const status = await plainGet(port);
                expect(status === 200).toBe(false);
                expect(calls.count).toBe(0);
            } finally {
                await close(server);
            }
        });

        await it('throws on a certificate that is not PEM', async () => {
            expect(() => createServer({ key: 'not a key', cert: 'not a certificate' })).toThrow();
        });
    });

    await describe('https.createServer client certificates (requestCert)', async () => {
        const options = { key: SERVER_KEY, cert: SERVER_CERT, ca: [CLIENT_CERT], requestCert: true };

        await it('serves a client that presents a certificate signed by ca', async () => {
            const calls = { count: 0 };
            const server = createServer(options, helloHandler(calls));
            const port = await listen(server);
            try {
                const result = await exchange(port, { ca: SERVER_CERT, cert: CLIENT_CERT, key: CLIENT_KEY });
                expect(result.fingerprint256).toBe(SERVER_FINGERPRINT256);
                expect(result.response).toContain(BODY);
                expect(calls.count).toBe(1);
            } finally {
                await close(server);
            }
        });

        await it('refuses a client without a certificate', async () => {
            const calls = { count: 0 };
            const server = createServer(options, helloHandler(calls));
            const port = await listen(server);
            try {
                let error: unknown = null;
                try {
                    await exchange(port, { ca: SERVER_CERT });
                } catch (err) {
                    error = err;
                }
                expect(error instanceof Error).toBe(true);
                expect(calls.count).toBe(0);
            } finally {
                await close(server);
            }
        });

        await it('refuses a client whose certificate is not signed by ca', async () => {
            const calls = { count: 0 };
            // The server's own pair is a valid certificate the ca list does not contain.
            const server = createServer(options, helloHandler(calls));
            const port = await listen(server);
            try {
                let error: unknown = null;
                try {
                    await exchange(port, { ca: SERVER_CERT, cert: SERVER_CERT, key: SERVER_KEY });
                } catch (err) {
                    error = err;
                }
                expect(error instanceof Error).toBe(true);
                expect(calls.count).toBe(0);
            } finally {
                await close(server);
            }
        });

        await it('serves any client when rejectUnauthorized is false', async () => {
            const calls = { count: 0 };
            const server = createServer({ ...options, rejectUnauthorized: false }, helloHandler(calls));
            const port = await listen(server);
            try {
                // A certificate the ca list does not contain, and none at all: both get through.
                const untrusted = await exchange(port, { ca: SERVER_CERT, cert: SERVER_CERT, key: SERVER_KEY });
                expect(untrusted.response).toContain(BODY);
                const anonymous = await exchange(port, { ca: SERVER_CERT });
                expect(anonymous.response).toContain(BODY);
                expect(calls.count).toBe(2);
            } finally {
                await close(server);
            }
        });
    });
};
