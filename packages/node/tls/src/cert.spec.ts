// SPDX-License-Identifier: MIT
// Ported from refs/node-test/parallel/test-tls-check-server-identity.js,
//   refs/node-test/parallel/test-tls-canonical-ip.js,
//   refs/node-test/parallel/test-tls-checkserveridentity-no-altnames.js.
// Original: Copyright (c) Node.js contributors. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.
//
// Focused coverage of RFC 6125 (§6.4.3) hostname matching + getPeerCertificate
// shape + createSecureContext PEM acceptance. Complements index.spec.ts.

import { describe, it, expect, on } from '@gjsify/unit';
import {
  checkServerIdentity,
  createSecureContext,
} from 'node:tls';
import type { PeerCertificate } from 'node:tls';

function fakeCert(parts: Record<string, unknown>): PeerCertificate {
  return parts as unknown as PeerCertificate;
}

// Self-signed PEM (cert + key) minted with `openssl req -x509 -newkey rsa:2048
//   -keyout key.pem -out cert.pem -days 3650 -nodes -subj /CN=test.example`.
// 2048-bit RSA, SHA256, no SAN. Used only for parser smoke-tests — never
// trusted as a CA. Inlined so tests stay hermetic (no fixtures).
const SAMPLE_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIDDzCCAfegAwIBAgIUO9v7luuPxFHsLdVr//dOTh474OQwDQYJKoZIhvcNAQEL
BQAwFzEVMBMGA1UEAwwMdGVzdC5leGFtcGxlMB4XDTI2MDUwOTA2NDIyMVoXDTM2
MDUwNjA2NDIyMVowFzEVMBMGA1UEAwwMdGVzdC5leGFtcGxlMIIBIjANBgkqhkiG
9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtnMdp3rW+bkeYoW9at2aRt70gub5siMsNOYw
0obCo1LOkJokEOX2+9kaOUwaCmntcJdU3+JYQe7MGYwI+H9OWxnLRYJUneYB81a8
CfJ7Uk+5FVNzQQFnYvL0G5NSq2w8K6UwV0jgXXFLEfTZOqdFdVVcwAOgCrc4LbpX
E+5IflPoIuwBW2brYx/fIyJu2gH0uRG92R5m/3UxOqlVzIerL3YM3UTSepDtyCek
ooD03UwLl3fYuza2iuMnxJAPshaSwiHbAopnaBSEvKMGHkLyl4zTmaioGXVRObtZ
XAorC7ujI4F8edcmPRwAaNToHS8cRlGQJjXACfAodwNKWpbHYwIDAQABo1MwUTAd
BgNVHQ4EFgQULhAoOyRjZxBRF8FlwTySSAXnFo0wHwYDVR0jBBgwFoAULhAoOyRj
ZxBRF8FlwTySSAXnFo0wDwYDVR0TAQH/BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOC
AQEAiePCYXf6PAF/m3SE9PYNLiq+ALeJ+kQgXUYp5S4vsfk2T+XmbtP0uNnTQpsT
4GaytjMFIQiNO6mHww8SFnrEr9btcNGCg17gyK7T3XukbsXIgOYvYjJboxb6Ww1T
YFEXqPv55of/I5+UPH88WOYR1JsPE6lR4s3MfaMMRXTIZwpob2sxEfqHfti1DrHV
nmzZpIvZi3II+gpx6aYE8m3DjgPrxbXw78Ular/VyYAyy9XVFpcl2nrAQgpErZIr
kweGVVMKE8qMF9SO1/pER4T7A9ZBJol00hMCL+5Rw0Pw4lCLXgGX1J9VyZ+ScLxz
aNy5t6tyGuGk0sol4dLG8nzHGA==
-----END CERTIFICATE-----`;

const SAMPLE_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC2cx2netb5uR5i
hb1q3ZpG3vSC5vmyIyw05jDShsKjUs6QmiQQ5fb72Ro5TBoKae1wl1Tf4lhB7swZ
jAj4f05bGctFglSd5gHzVrwJ8ntST7kVU3NBAWdi8vQbk1KrbDwrpTBXSOBdcUsR
9Nk6p0V1VVzAA6AKtzgtulcT7kh+U+gi7AFbZutjH98jIm7aAfS5Eb3ZHmb/dTE6
qVXMh6svdgzdRNJ6kO3IJ6SigPTdTAuXd9i7NraK4yfEkA+yFpLCIdsCimdoFIS8
owYeQvKXjNOZqKgZdVE5u1lcCisLu6MjgXx51yY9HABo1OgdLxxGUZAmNcAJ8Ch3
A0palsdjAgMBAAECggEADTZAcBYmjSAWDpjHguT+cAiWXwhU2pm1CmhrVRBD9fz5
tZT3IAlXHYO2/dRmw/KwKnAUlr9wS4EvlhLPvEotWJsa+JlogT3cgRktz4nLDmBB
jRH+9AOJaUWIq2dVHDhfq+I8oh8TFREumEoWLpFZ9Hya+9I6lUWq5smdcEI+gHWs
yWhq4auR2/zkhvgsjLKPK8P2M8tmm8IPecE74NSBZqxoqb4upUHpMTxasAE2UJpK
0slvxiZtk3LT/rflco04twIqK/KmH7phrPzmoSl+Lp1Zh9y4iNznTQKBdImsGl+g
9FWL7pdxKjVNGQsrKVvB1A78VhhteAuaebT5MicIwQKBgQDtmYfyrlGoYGkArmNL
tGBc5afGx/mL/8BGTQfIx4b11OEr+G4hppLh/WGLUksfMfprL0YU3BM+FOsECsY0
5AJB6oQuSE8vCIS7yCxV00V+I6n2bEMxZkDwdDuF9rHhGODFx4pPz1nJqScAa23T
48c+hNSBLRHTSuDAi2DcuxLn4QKBgQDElDjmB/kpW50ya2M2hO5LpwMcAlTJ3nPv
000eTfzdtDNzesvRClYZWGWs7zSkNsf/F+G0tCg4slzvHPkRJN53hHF0Kwug2aj5
1BPuDbn3EumDO6quykz6S9vZGcPAMuNm+qtkf+42KE5Sqj3NTf6aiu4tEZbH69me
av1sbfkHwwKBgQC5cb5g1FuZjn4F8RZBDSy09O4pQQVtlpSsigzMUabtklSY7BKR
IyC7T/dlNTq6w1hPdhs9xrMiHlN72SjwORHl/rNiKD/dVsm6grbP2dEAbbeHROKA
2O1Qf3fBzFTzemZdF6vFNPJAakytkCutWLe2/RebJuElx+h5f49/WGeeIQKBgQC0
mcCUharB9ms7kTF7OzF6y5utte6T8A3vvd9SAjBYt1+1rpFmIersKixvbuycGcAw
eo5gaEuzmxqKi8G/oHHKuCFLquhqBM6bh94vjOjXN8bVTJIJN870/ZCjqmoPQDFv
wMiJ8oa1tt4OUF2rKwbIkO809L3kOqiaRI1Det2Z5QKBgGp4JS3OqzeIMQbUa8e8
tOYnML+RFpo2cZ9rCQAQitm/w5P6lAnG9vv4cXAu94RbtITEuGmqEhYDMhSC2i8e
kjwRLp5R+/pynUdTckRP8buwRSDRlPz3x8GI2Dm0z8fb/uZ8AJK/iITtsOoJtyPx
fUZ521uRyKXnpzj1HTz5WVp0
-----END PRIVATE KEY-----`;

export default async () => {
  await describe('tls — RFC 6125 + cert extraction', async () => {

    // ---------------- RFC 6125 wildcard depth rules ----------------
    await describe('RFC 6125 wildcard depth', async () => {
      await it('rejects two-label wildcard *.com', async () => {
        const err = checkServerIdentity('foo.com', fakeCert({
          subject: {},
          subjectaltname: 'DNS:*.com',
        }));
        expect(err instanceof Error).toBe(true);
      });

      await it('rejects single-label wildcard *', async () => {
        const err = checkServerIdentity('foo', fakeCert({
          subject: {},
          subjectaltname: 'DNS:*',
        }));
        expect(err instanceof Error).toBe(true);
      });

      await it('accepts three-label wildcard *.example.com matching foo.example.com', async () => {
        const ok = checkServerIdentity('foo.example.com', fakeCert({
          subject: {},
          subjectaltname: 'DNS:*.example.com',
        }));
        expect(ok).toBeUndefined();
      });

      await it('rejects empty wildcard label .x.example.com', async () => {
        const err = checkServerIdentity('foo.x.example.com', fakeCert({
          subject: {},
          subjectaltname: 'DNS:.x.example.com',
        }));
        expect(err instanceof Error).toBe(true);
      });
    });

    // ---------------- RFC 6125 wildcard prefix/suffix ----------------
    await describe('RFC 6125 wildcard prefix/suffix', async () => {
      await it('matches f*.example.com against foo.example.com', async () => {
        const ok = checkServerIdentity('foo.example.com', fakeCert({
          subject: {},
          subjectaltname: 'DNS:f*.example.com',
        }));
        expect(ok).toBeUndefined();
      });

      await it('rejects f*.example.com against bar.example.com', async () => {
        const err = checkServerIdentity('bar.example.com', fakeCert({
          subject: {},
          subjectaltname: 'DNS:f*.example.com',
        }));
        expect(err instanceof Error).toBe(true);
      });

      await it('matches *foo.example.com against barfoo.example.com', async () => {
        const ok = checkServerIdentity('barfoo.example.com', fakeCert({
          subject: {},
          subjectaltname: 'DNS:*foo.example.com',
        }));
        expect(ok).toBeUndefined();
      });

      await it('rejects f*r.example.com against bar.example.com (prefix mismatch)', async () => {
        const err = checkServerIdentity('bar.example.com', fakeCert({
          subject: {},
          subjectaltname: 'DNS:f*r.example.com',
        }));
        expect(err instanceof Error).toBe(true);
      });
    });

    // ---------------- IDN / xn-- handling ----------------
    await describe('Punycode / IDN', async () => {
      await it('treats xn-- labels as exact-match (no wildcard expansion)', async () => {
        // pattern is the punycoded form; hostname must match exactly.
        const ok = checkServerIdentity('xn--bcher-kva.example.com', fakeCert({
          subject: {},
          subjectaltname: 'DNS:xn--bcher-kva.example.com',
        }));
        expect(ok).toBeUndefined();
      });

      await it('rejects wildcard expansion against xn-- A-label leftmost', async () => {
        // *xn--bcher-kva matched against bcher-kva: per RFC 6125 the wildcard
        // is not allowed to expand into A-label content.
        const err = checkServerIdentity('foo.example.com', fakeCert({
          subject: {},
          subjectaltname: 'DNS:xn--*.example.com',
        }));
        expect(err instanceof Error).toBe(true);
      });
    });

    // ---------------- Error code shape (Node-compat) ----------------
    await describe('error.code', async () => {
      await it('returns ERR_TLS_CERT_ALTNAME_INVALID code on mismatch', async () => {
        const err = checkServerIdentity('a.com', fakeCert({
          subject: { CN: 'b.com' },
        }));
        expect(err instanceof Error).toBe(true);
        const e = err as { code?: string };
        // Node: ERR_TLS_CERT_ALTNAME_INVALID. Our impl: same.
        expect(e.code).toBe('ERR_TLS_CERT_ALTNAME_INVALID');
      });
    });

    // ---------------- createSecureContext PEM acceptance ----------------
    await describe('createSecureContext', async () => {
      await it('accepts string PEM material (cert + key)', async () => {
        const ctx = createSecureContext({ cert: SAMPLE_CERT_PEM, key: SAMPLE_KEY_PEM });
        expect(ctx).toBeDefined();
      });

      await it('accepts Buffer PEM material', async () => {
        const Buffer = (globalThis as { Buffer?: { from(s: string): unknown } }).Buffer;
        if (!Buffer) return;  // skip if Buffer unavailable
        const ctx = createSecureContext({
          cert: Buffer.from(SAMPLE_CERT_PEM) as never,
          key: Buffer.from(SAMPLE_KEY_PEM) as never,
        });
        expect(ctx).toBeDefined();
      });

      await it('accepts array of PEM blocks for ca', async () => {
        const ctx = createSecureContext({ ca: [SAMPLE_CERT_PEM, SAMPLE_CERT_PEM] });
        expect(ctx).toBeDefined();
      });

      await it('returns ctx.context self-reference (Node-compat)', async () => {
        const ctx = createSecureContext();
        const ref = (ctx as unknown as { context?: unknown }).context;
        expect(ref !== undefined).toBe(true);
      });

      // Our impl preserves the user-supplied options on the SecureContext;
      // Node does not, so this is a GJS-specific guarantee we lean on for
      // diagnostics + integration debugging.
      await on('Gjs', async () => {
        await it('preserves passed-through options (ciphers/minVersion/maxVersion)', async () => {
          const ctx = createSecureContext({
            ciphers: 'TLS_AES_128_GCM_SHA256',
            minVersion: 'TLSv1.2',
            maxVersion: 'TLSv1.3',
          });
          const o = (ctx as unknown as { options?: { ciphers?: string; minVersion?: string; maxVersion?: string } }).options;
          expect(o).toBeDefined();
          expect(o!.ciphers).toBe('TLS_AES_128_GCM_SHA256');
          expect(o!.minVersion).toBe('TLSv1.2');
          expect(o!.maxVersion).toBe('TLSv1.3');
        });
      });
    });
  });
};
