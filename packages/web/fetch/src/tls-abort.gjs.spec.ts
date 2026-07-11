// TLS opt-out + abort behavior for @gjsify/fetch on GJS — original regression tests.
//
// Covers two Node-parity gaps closed in request.ts / index.ts:
//   1. Per-connection TLS: a request may opt out of certificate verification with
//      `rejectUnauthorized: false` (mirroring undici's `connect.rejectUnauthorized`) — applied to
//      THAT Soup.Message only via its `accept-certificate` signal, never the shared session. The
//      process-global `NODE_TLS_REJECT_UNAUTHORIZED=0` is also honored (as Node's fetch does).
//   2. Abort: an aborted signal rejects the fetch with an AbortError (name === 'AbortError'), and
//      the abort→cancel wiring is attached BEFORE send_async so an abort during connect/TTFB is not
//      lost (see request.ts `_send`).
//
// GJS-only (`.gjs.spec.ts`): the body runs under `on('Gjs', …)`, a no-op on Node. Soup/GLib/Gio are
// read from the GJS bootstrap `imports` (same idiom as soup-session.gjs.spec.ts) so the Node bundle
// never resolves `gi://*`. Request/fetch are read from `globalThis` (installed by
// `@gjsify/fetch/register`, pulled in by test.mts). `@gjsify/abort-controller` is pure-TS
// cross-runtime, so its static import is safe on both legs.

import { describe, it, expect, on } from '@gjsify/unit';
import { AbortController, AbortSignal } from '@gjsify/abort-controller';
import type SoupNS from '@girs/soup-3.0';
import type GLibNS from '@girs/glib-2.0';
import type GioNS from '@girs/gio-2.0';
import type { Request as GjsRequest } from './request.js';

/** The GJS bootstrap `imports` global — only the pieces these tests touch. */
interface GjsImports {
    gi: {
        versions: Record<string, string>;
        Soup: typeof SoupNS;
        GLib: typeof GLibNS;
        Gio: typeof GioNS;
    };
}

/**
 * @gjsify/fetch accepts two GJS-runtime extensions the DOM `RequestInit` does not model: a
 * per-request `rejectUnauthorized`, and the cross-runtime `@gjsify` `AbortSignal` (not DOM's — its
 * `onabort` type differs). Model both here instead of casting through `unknown` at each call site.
 */
type FetchInit = Omit<RequestInit, 'signal'> & {
    rejectUnauthorized?: boolean;
    signal?: AbortSignal;
};

// A REAL self-signed cert+key (RSA-2048, CN=localhost, SAN DNS:localhost + IP:127.0.0.1, 100y) so a
// live TLS handshake against the local Soup.Server actually completes. Embedded inline to stay
// hermetic (no fixtures) — same approach as packages/node/tls TEST_CERT_AND_KEY. Regenerate with:
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

export default async () => {
    await on('Gjs', async () => {
        // Read GJS runtime objects lazily (no static gi:// import → Node bundle stays clean).
        const gjs = (globalThis as unknown as { imports: GjsImports }).imports;
        const Soup = gjs.gi.Soup;
        const GLib = gjs.gi.GLib;
        const Gio = gjs.gi.Gio;
        // Request + fetch are installed as globals by `@gjsify/fetch/register` (via test.mts). Type
        // them with FetchInit so the GJS-only options type-check under the fetch package's DOM lib.
        const RequestCtor = (globalThis as unknown as { Request: new (input: string, init?: FetchInit) => GjsRequest })
            .Request;
        const fetchFn = (globalThis as unknown as { fetch: (input: string, init?: FetchInit) => Promise<Response> })
            .fetch;

        /** Start a fresh self-signed HTTPS Soup.Server on loopback; returns it plus its base URL. */
        const startHttpsServer = (): { server: SoupNS.Server; base: string } => {
            const cert = Gio.TlsCertificate.new_from_pem(SELF_SIGNED_CERT_AND_KEY, -1);
            const server = new Soup.Server({});
            server.set_tls_certificate(cert);
            server.add_handler(null, (_s: unknown, msg: SoupNS.ServerMessage) => {
                msg.set_status(200, null);
                msg.set_response('text/plain', Soup.MemoryUse.COPY, new TextEncoder().encode('ok'));
            });
            server.listen_local(
                0,
                (Soup.ServerListenOptions.HTTPS | Soup.ServerListenOptions.IPV4_ONLY) as SoupNS.ServerListenOptions,
            );
            return { server, base: server.get_uris()[0].to_string() };
        };

        await describe('@gjsify/fetch — per-connection TLS opt-out plumbing', async () => {
            await it('carries rejectUnauthorized:false from init onto the request', () => {
                const req = new RequestCtor('https://example.com/', { rejectUnauthorized: false });
                expect(req.rejectUnauthorized).toBe(false);
            });

            await it('defaults rejectUnauthorized to undefined (verification stays on)', () => {
                const req = new RequestCtor('https://example.com/');
                expect(req.rejectUnauthorized).toBe(undefined);
            });
        });

        await describe('@gjsify/fetch — abort surfaces as AbortError', async () => {
            await it('rejects with an AbortError when the signal is already aborted', async () => {
                const ctrl = new AbortController();
                ctrl.abort();
                let name = '';
                try {
                    // Already-aborted → rejects before any socket work, so no server is needed.
                    await fetchFn('http://127.0.0.1:1/', { signal: ctrl.signal });
                } catch (e) {
                    name = (e as Error).name;
                }
                expect(name).toBe('AbortError');
            });
        });

        await describe('@gjsify/fetch — self-signed TLS (per-connection opt-out, no shared-session leak)', async () => {
            await it('rejects a self-signed host by default (verification on)', async () => {
                const { server, base } = startHttpsServer();
                let rejected = false;
                try {
                    await fetchFn(base);
                } catch {
                    rejected = true;
                } finally {
                    server.disconnect();
                }
                expect(rejected).toBe(true);
            });

            await it('resolves when the request opts out with rejectUnauthorized:false', async () => {
                const { server, base } = startHttpsServer();
                let status = 0;
                let body = '';
                try {
                    const res = await fetchFn(base, { rejectUnauthorized: false });
                    status = res.status;
                    body = await res.text();
                } finally {
                    server.disconnect();
                }
                expect(status).toBe(200);
                expect(body).toBe('ok');
            });

            await it('honors NODE_TLS_REJECT_UNAUTHORIZED=0 for the default call', async () => {
                const { server, base } = startHttpsServer();
                const prev = GLib.getenv('NODE_TLS_REJECT_UNAUTHORIZED');
                GLib.setenv('NODE_TLS_REJECT_UNAUTHORIZED', '0', true);
                let status = 0;
                try {
                    const res = await fetchFn(base); // no per-request opt-out → env is what opens it
                    status = res.status;
                    await res.text();
                } finally {
                    if (prev === null) GLib.unsetenv('NODE_TLS_REJECT_UNAUTHORIZED');
                    else GLib.setenv('NODE_TLS_REJECT_UNAUTHORIZED', prev, true);
                    server.disconnect();
                }
                expect(status).toBe(200);
            });

            await it('lets an explicit rejectUnauthorized:true win over NODE_TLS_REJECT_UNAUTHORIZED=0', async () => {
                const { server, base } = startHttpsServer();
                const prev = GLib.getenv('NODE_TLS_REJECT_UNAUTHORIZED');
                GLib.setenv('NODE_TLS_REJECT_UNAUTHORIZED', '0', true);
                let rejected = false;
                try {
                    await fetchFn(base, { rejectUnauthorized: true });
                } catch {
                    rejected = true;
                } finally {
                    if (prev === null) GLib.unsetenv('NODE_TLS_REJECT_UNAUTHORIZED');
                    else GLib.setenv('NODE_TLS_REJECT_UNAUTHORIZED', prev, true);
                    server.disconnect();
                }
                expect(rejected).toBe(true);
            });

            await it('scopes the accepted cert to the message: a normal fetch elsewhere still verifies', async () => {
                // Two independent self-signed servers. Accepting server A's cert (per-message) must NOT
                // teach the shared Soup.Session to trust server B — B is a fresh host:port with no
                // pooled connection, so it must handshake + verify from scratch and reject.
                const a = startHttpsServer();
                const b = startHttpsServer();
                let insecureStatus = 0;
                let secureRejected = false;
                try {
                    const res = await fetchFn(a.base, { rejectUnauthorized: false });
                    insecureStatus = res.status;
                    await res.text();
                    try {
                        await fetchFn(b.base); // default on the SAME shared session must still verify
                    } catch {
                        secureRejected = true;
                    }
                } finally {
                    a.server.disconnect();
                    b.server.disconnect();
                }
                expect(insecureStatus).toBe(200);
                expect(secureRejected).toBe(true);
            });
        });

        await describe('@gjsify/fetch — AbortSignal.timeout against a hung server rejects promptly', async () => {
            await it('rejects with AbortError while waiting for response headers (connect-phase fix)', async () => {
                const server = new Soup.Server({});
                server.add_handler(null, (_s: unknown, msg: SoupNS.ServerMessage) => {
                    // Never respond: pause the message so the client blocks on time-to-first-byte. On
                    // `main` the abort wired only AFTER _send resolves is dropped here and the fetch
                    // hangs; the fix wires it before send_async, so AbortSignal.timeout cancels the
                    // in-flight send and index.ts maps the cancellation to an AbortError.
                    server.pause_message(msg);
                });
                server.listen_local(0, Soup.ServerListenOptions.IPV4_ONLY);
                const base = server.get_uris()[0].to_string();

                // Bounded so a regression fails the test instead of hanging CI: if the fetch has not
                // settled within 3s the watchdog rejects and the AbortError assertion below fails.
                let watchdogId = 0;
                const watchdog = new Promise<never>((_resolve, reject) => {
                    watchdogId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 3000, () => {
                        watchdogId = 0;
                        reject(new Error('fetch did not settle within 3s — connect-phase abort regressed'));
                        return GLib.SOURCE_REMOVE;
                    });
                });

                const startedUs = GLib.get_monotonic_time();
                let name = '';
                let elapsedMs = 0;
                try {
                    await Promise.race([fetchFn(base, { signal: AbortSignal.timeout(50) }), watchdog]);
                } catch (e) {
                    name = (e as Error).name;
                    elapsedMs = (GLib.get_monotonic_time() - startedUs) / 1000;
                } finally {
                    if (watchdogId) {
                        GLib.source_remove(watchdogId);
                        watchdogId = 0;
                    }
                    server.disconnect();
                }
                expect(name).toBe('AbortError');
                // The 50ms timeout must fire during connect/TTFB — well under the 3s watchdog.
                expect(elapsedMs < 2000).toBe(true);
            });
        });
    });
};
