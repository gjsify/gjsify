// oxlint-disable typescript/no-explicit-any -- the GJS server half reaches Soup through `globalThis.imports.gi`, the GJS bootstrap object, which has no Node-side type.
// SPDX-License-Identifier: MIT
// Client-side TLS options of https.request / https.Agent — original, asserting Node's
// behaviour (measured on Node 24) against a local HTTPS server:
//   `ca` (string | Buffer | array) replaces the trust store, the chain error carries
//   OpenSSL's code, `rejectUnauthorized: false` accepts, the name is checked against
//   `servername || host`, `checkServerIdentity` overrides it, an Agent's TLS options
//   override the request's, `cert`/`key` present a client certificate.
//
// The server differs per runtime, the assertions do not: Node uses https.createServer;
// on GJS a TLS Soup.Server, because @gjsify/https's Server does not terminate TLS yet
// (status/open-todos.md).

import { describe, it, expect } from '@gjsify/unit';
import { isGJS } from '@gjsify/runtime';
import { Buffer } from 'node:buffer';
import { Agent, createServer, request, type RequestOptions } from 'node:https';

// ECDSA P-256, valid until 2126. A root CA, a leaf it signed (CN=localhost,
// SAN DNS:localhost + IP:127.0.0.1), a self-signed leaf with the same names, and an
// unrelated CA. Regenerate with openssl: `ecparam -genkey`, `req -x509` for the CAs +
// self-signed leaf, `x509 -req -CA` for the signed leaf, `pkcs8 -topk8` for the keys.
const CA_CERT = `-----BEGIN CERTIFICATE-----
MIIBpDCCAUmgAwIBAgIUL6N0edZiY/FQUe01mwfPtudDGyQwCgYIKoZIzj0EAwIw
HjEcMBoGA1UEAwwTZ2pzaWZ5IHRlc3Qgcm9vdCBDQTAgFw0yNjA5MjUyMTQ5NDZa
GA8yMTI2MDkwMTIxNDk0NlowHjEcMBoGA1UEAwwTZ2pzaWZ5IHRlc3Qgcm9vdCBD
QTBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABBUrAK9oPa984eNLFbRLLCvEtADD
AnDEUL1I5lxtsfkxTqWRGlUt7oPxfuFgg2T7suPUuItRT10vfAWhS55KqaujYzBh
MB0GA1UdDgQWBBQtg26PJMsW0pG127jKbX7pUBMWOTAfBgNVHSMEGDAWgBQtg26P
JMsW0pG127jKbX7pUBMWOTAPBgNVHRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwIB
BjAKBggqhkjOPQQDAgNJADBGAiEAs4TlkZSjfAzHUvYgv5acg1DioNBgIRvdFcNU
QMGFZM4CIQC1Vixj9sp8RbS2w76GZ27ZWuC+lymBbz4f5R3BRDmMww==
-----END CERTIFICATE-----
`;

const LEAF_CERT = `-----BEGIN CERTIFICATE-----
MIIBtTCCAVqgAwIBAgIUcdlmwgKkjjXYBxvtQ1YdSufcPO0wCgYIKoZIzj0EAwIw
HjEcMBoGA1UEAwwTZ2pzaWZ5IHRlc3Qgcm9vdCBDQTAgFw0yNjA5MjUyMTQ5NDZa
GA8yMTI2MDkwMTIxNDk0NlowFDESMBAGA1UEAwwJbG9jYWxob3N0MFkwEwYHKoZI
zj0CAQYIKoZIzj0DAQcDQgAElbdiLOtJHwPIx+oMiPyTP3aEXGEG7vzgV8Uu3IFG
DQp5cmGWZ9QI56jr+QPVae2sM7faOYIrWX1FsjxIYOmIgKN+MHwwGgYDVR0RBBMw
EYIJbG9jYWxob3N0hwR/AAABMAkGA1UdEwQCMAAwEwYDVR0lBAwwCgYIKwYBBQUH
AwEwHQYDVR0OBBYEFDMnSCHpbwWZkvavi+gbSwU2Dc0FMB8GA1UdIwQYMBaAFC2D
bo8kyxbSkbXbuMptfulQExY5MAoGCCqGSM49BAMCA0kAMEYCIQCnPGG7lu3DNK4g
ITZPIhzXIzg3HHJFIq8JdX3y0j6hRwIhAIMTYSs9ZfAVX/GFv3hm9reYHZuYw0gk
S6I3cnzVTAbx
-----END CERTIFICATE-----
`;

const LEAF_KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgup4PlT0hK67nuhcM
AjMJriOZAt4aw3YZCDtXIKIZYV6hRANCAASVt2Is60kfA8jH6gyI/JM/doRcYQbu
/OBXxS7cgUYNCnlyYZZn1AjnqOv5A9Vp7awzt9o5gitZfUWyPEhg6YiA
-----END PRIVATE KEY-----
`;

const SELF_CERT = `-----BEGIN CERTIFICATE-----
MIIBmzCCAUGgAwIBAgIUX7m8ljOjaWBJV9unaTggccs6K0AwCgYIKoZIzj0EAwIw
FDESMBAGA1UEAwwJbG9jYWxob3N0MCAXDTI2MDkyNTIxNDk0NloYDzIxMjYwOTAx
MjE0OTQ2WjAUMRIwEAYDVQQDDAlsb2NhbGhvc3QwWTATBgcqhkjOPQIBBggqhkjO
PQMBBwNCAARhyujw+phiW0FHEfpsK2Qs4tcP22gN5Mi8qmAtMyy8aVY1QxeqW2vs
n6FoteugvybBxTJ0Q8sdhkEURxd/aZvyo28wbTAdBgNVHQ4EFgQUnhq469r6Cc5H
gD8H7NePW0/Ne+IwHwYDVR0jBBgwFoAUnhq469r6Cc5HgD8H7NePW0/Ne+IwDwYD
VR0TAQH/BAUwAwEB/zAaBgNVHREEEzARgglsb2NhbGhvc3SHBH8AAAEwCgYIKoZI
zj0EAwIDSAAwRQIgGNfWTGY9J16Ed0IK8VR0mrpuD5xJYW+iQSo9nylOaukCIQDu
tXIIFlvDozU5VS+cnJfEast2l4H3Rpvv4sIr28uVVw==
-----END CERTIFICATE-----
`;

const SELF_KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgTSUhsfyN4TEsg2T5
Brb5dapwwk0x/8M2qHliserZVwWhRANCAARhyujw+phiW0FHEfpsK2Qs4tcP22gN
5Mi8qmAtMyy8aVY1QxeqW2vsn6FoteugvybBxTJ0Q8sdhkEURxd/aZvy
-----END PRIVATE KEY-----
`;

const OTHER_CA_CERT = `-----BEGIN CERTIFICATE-----
MIIBjDCCATGgAwIBAgIUEfRNy+9Z7sURQuB+8uRVyDCDUsAwCgYIKoZIzj0EAwIw
GjEYMBYGA1UEAwwPZ2pzaWZ5IG90aGVyIENBMCAXDTI2MDkyNTIxNDk0NloYDzIx
MjYwOTAxMjE0OTQ2WjAaMRgwFgYDVQQDDA9nanNpZnkgb3RoZXIgQ0EwWTATBgcq
hkjOPQIBBggqhkjOPQMBBwNCAARh4aMPnTItjKyISPCAmg9v+Z6PZZYYNSZFa4BU
0P12vcAuFvaqfirRgn6eRR1Oyq1fp9ys/d6cDNmnsOqRQXFKo1MwUTAdBgNVHQ4E
FgQUTdPPGIEQDK/JJH+XYKPWyiLDJWkwHwYDVR0jBBgwFoAUTdPPGIEQDK/JJH+X
YKPWyiLDJWkwDwYDVR0TAQH/BAUwAwEB/zAKBggqhkjOPQQDAgNJADBGAiEAzvrt
rAPh0CcM7987zsT4umMC7CFfSq+YknBNp3kMoogCIQCenZTk+aXoMZjF6tKWeeoO
dd9j6F2ZT6RZtwKnqoQHUQ==
-----END CERTIFICATE-----
`;

interface TestServer {
    port: number;
    /** Subject CN of the client certificate on the last request, '' when none was sent. */
    lastClientCN(): string;
    close(): void;
}

async function startServer(certChain: string, key: string, requestClientCert = false): Promise<TestServer> {
    let clientCN = '';
    if (isGJS) {
        const { Soup, Gio } = (globalThis as any).imports.gi;
        const soup = new Soup.Server({});
        soup.set_tls_certificate(Gio.TlsCertificate.new_from_pem(certChain + key, -1));
        if (requestClientCert) {
            soup.set_tls_auth_mode(Gio.TlsAuthenticationMode.REQUESTED);
            soup.connect('request-started', (_server: any, msg: any) => {
                msg.connect('accept-certificate', () => true);
            });
        }
        soup.add_handler(null, (_server: any, msg: any) => {
            const peer = msg.get_tls_peer_certificate();
            clientCN = peer ? (/CN=([^,]+)/.exec(peer.get_subject_name() ?? '')?.[1] ?? '') : '';
            msg.set_status(200, null);
            msg.set_response('text/plain', Soup.MemoryUse.COPY, new TextEncoder().encode('ok'));
        });
        soup.listen_local(0, Soup.ServerListenOptions.HTTPS | Soup.ServerListenOptions.IPV4_ONLY);
        const port: number = soup.get_uris()[0].get_port();
        return { port, lastClientCN: () => clientCN, close: () => soup.disconnect() };
    }
    const server = createServer(
        { cert: certChain, key, requestCert: requestClientCert, rejectUnauthorized: false } as any,
        (req: any, res: any) => {
            const peer = req.socket.getPeerCertificate?.();
            clientCN = peer?.subject?.CN ?? '';
            res.end('ok');
        },
    );
    await new Promise<void>((resolve) => (server as any).listen(0, '127.0.0.1', () => resolve()));
    return {
        port: (server as any).address().port,
        lastClientCN: () => clientCN,
        close() {
            (server as any).close();
            (server as any).closeAllConnections?.();
        },
    };
}

/** Resolves 'ok' (the body) on success, else the error's `code` (or message when it has none). */
function get(port: number, options: RequestOptions = {}): Promise<string> {
    return new Promise((resolve) => {
        const req = request({ host: '127.0.0.1', port, path: '/', ...options } as any, (res: any) => {
            let body = '';
            res.on('data', (chunk: Buffer) => (body += chunk.toString()));
            res.on('end', () => resolve(body));
        });
        req.on('error', (err: Error & { code?: string }) => resolve(err.code ?? err.message));
        req.end();
    });
}

export default async () => {
    await describe('https.request TLS options', async () => {
        const leaf = await startServer(LEAF_CERT, LEAF_KEY);
        const chain = await startServer(LEAF_CERT + CA_CERT, LEAF_KEY);
        const self = await startServer(SELF_CERT, SELF_KEY);
        try {
            await it('rejects a leaf from an unknown CA with UNABLE_TO_VERIFY_LEAF_SIGNATURE', async () => {
                expect(await get(leaf.port)).toBe('UNABLE_TO_VERIFY_LEAF_SIGNATURE');
            });

            await it('rejects a self-signed leaf with DEPTH_ZERO_SELF_SIGNED_CERT', async () => {
                expect(await get(self.port)).toBe('DEPTH_ZERO_SELF_SIGNED_CERT');
            });

            await it('rejects a chain ending in an untrusted root with SELF_SIGNED_CERT_IN_CHAIN', async () => {
                expect(await get(chain.port)).toBe('SELF_SIGNED_CERT_IN_CHAIN');
            });

            await it('accepts the leaf with its CA as a string', async () => {
                expect(await get(leaf.port, { ca: CA_CERT })).toBe('ok');
            });

            await it('accepts the leaf with its CA as a Buffer', async () => {
                expect(await get(leaf.port, { ca: Buffer.from(CA_CERT) })).toBe('ok');
            });

            await it('accepts the leaf with its CA in an array of anchors', async () => {
                expect(await get(leaf.port, { ca: [OTHER_CA_CERT, Buffer.from(CA_CERT)] })).toBe('ok');
            });

            await it('accepts the full chain with its root as ca', async () => {
                expect(await get(chain.port, { ca: CA_CERT })).toBe('ok');
            });

            await it('accepts a self-signed leaf given as its own ca', async () => {
                expect(await get(self.port, { ca: SELF_CERT })).toBe('ok');
            });

            await it('rejects the leaf when ca names another CA', async () => {
                expect(await get(leaf.port, { ca: OTHER_CA_CERT })).toBe('UNABLE_TO_VERIFY_LEAF_SIGNATURE');
            });

            await it('accepts anything with rejectUnauthorized: false', async () => {
                expect(await get(leaf.port, { rejectUnauthorized: false })).toBe('ok');
                expect(await get(self.port, { rejectUnauthorized: false })).toBe('ok');
            });

            await it('checks the name against servername: ERR_TLS_CERT_ALTNAME_INVALID', async () => {
                expect(await get(leaf.port, { ca: CA_CERT, servername: 'wrong.example' })).toBe(
                    'ERR_TLS_CERT_ALTNAME_INVALID',
                );
            });

            await it('accepts a name mismatch with rejectUnauthorized: false', async () => {
                const opts = { ca: CA_CERT, servername: 'wrong.example', rejectUnauthorized: false };
                expect(await get(leaf.port, opts)).toBe('ok');
            });

            await it('accepts the leaf by DNS name (host: localhost)', async () => {
                expect(await get(leaf.port, { host: 'localhost', ca: CA_CERT })).toBe('ok');
            });

            await it('lets checkServerIdentity refuse a verified peer', async () => {
                let seen = '';
                const checkServerIdentity = (host: string, cert: any) => {
                    seen = `${host} ${cert.subject?.CN}`;
                    return new Error('refused by callback');
                };
                expect(await get(leaf.port, { ca: CA_CERT, checkServerIdentity } as any)).toBe('refused by callback');
                expect(seen).toBe('127.0.0.1 localhost');
            });

            await it('takes ca from an https.Agent', async () => {
                expect(await get(leaf.port, { agent: new Agent({ ca: CA_CERT } as any) })).toBe('ok');
            });

            await it("lets the Agent's ca override the request's", async () => {
                const agent = new Agent({ ca: CA_CERT } as any);
                expect(await get(leaf.port, { ca: OTHER_CA_CERT, agent })).toBe('ok');
            });

            await it('takes rejectUnauthorized: false from an https.Agent', async () => {
                const agent = new Agent({ rejectUnauthorized: false } as any);
                expect(await get(self.port, { agent })).toBe('ok');
            });
        } finally {
            leaf.close();
            chain.close();
            self.close();
        }
    });

    await describe('https.request client certificate', async () => {
        const server = await startServer(LEAF_CERT, LEAF_KEY, true);
        try {
            await it('sends no certificate without cert/key', async () => {
                expect(await get(server.port, { ca: CA_CERT })).toBe('ok');
                expect(server.lastClientCN()).toBe('');
            });

            await it('presents cert/key when the server asks', async () => {
                expect(await get(server.port, { ca: CA_CERT, cert: SELF_CERT, key: SELF_KEY })).toBe('ok');
                expect(server.lastClientCN()).toBe('localhost');
            });
        } finally {
            server.close();
        }
    });
};
