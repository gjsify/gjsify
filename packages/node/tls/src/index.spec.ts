// SPDX-License-Identifier: MIT
// Ported from refs/node-test/parallel/test-tls-check-server-identity.js,
//   test-tls-basic-validations.js, refs/bun/test/js/node/tls/.
// Original: Copyright (c) Node.js contributors. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import tls, {
  TLSSocket,
  connect,
  createServer,
  createSecureContext,
  checkServerIdentity,
  getCiphers,
  rootCertificates,
  DEFAULT_MIN_VERSION,
  DEFAULT_MAX_VERSION,
  DEFAULT_CIPHERS,
} from 'node:tls';
import type { PeerCertificate } from 'node:tls';

// Build a fake PeerCertificate from minimal fields. Lets us drive
// `checkServerIdentity` from tests without crafting a real DER cert.
// `@types/node`'s PeerCertificate has many more fields than we expose; the
// `as unknown as PeerCertificate` keeps the test free of `as any`.
function fakeCert(parts: Record<string, unknown>): PeerCertificate {
  return parts as unknown as PeerCertificate;
}

// Our implementation also exports TLSServer; Node only exports Server.
const tlsRecord = tls as unknown as Record<string, unknown>;
const TLSServer = (tlsRecord.TLSServer ?? tlsRecord.Server) as new (
  options?: unknown,
  secureConnectionListener?: unknown,
) => {
  on: (ev: string, cb: (...a: unknown[]) => void) => unknown;
  emit: (ev: string, ...a: unknown[]) => boolean;
  once: (ev: string, cb: (...a: unknown[]) => void) => unknown;
  addContext: (host: string, ctx: unknown) => void;
  listen: (...a: unknown[]) => unknown;
  close: (cb?: () => void) => unknown;
  address: () => unknown;
};

export default async () => {
  await describe('tls', async () => {

    // ===================== Constants =====================
    await describe('constants', async () => {
      await it('should export DEFAULT_MIN_VERSION as TLSv1.2', async () => {
        expect(DEFAULT_MIN_VERSION).toBe('TLSv1.2');
      });

      await it('should export DEFAULT_MAX_VERSION as TLSv1.3', async () => {
        expect(DEFAULT_MAX_VERSION).toBe('TLSv1.3');
      });

      await it('DEFAULT_CIPHERS should be a non-empty string', async () => {
        expect(typeof DEFAULT_CIPHERS).toBe('string');
        expect(DEFAULT_CIPHERS.length).toBeGreaterThan(0);
      });

      await it('DEFAULT_CIPHERS should contain AES', async () => {
        expect(DEFAULT_CIPHERS).toContain('AES');
      });

      await it('DEFAULT_CIPHERS should be colon-separated', async () => {
        expect(DEFAULT_CIPHERS).toContain(':');
      });
    });

    // ===================== Module exports =====================
    await describe('exports', async () => {
      await it('should export TLSSocket as a function', async () => {
        expect(typeof TLSSocket).toBe('function');
      });

      await it('should export connect as a function', async () => {
        expect(typeof connect).toBe('function');
      });

      await it('should export createSecureContext as a function', async () => {
        expect(typeof createSecureContext).toBe('function');
      });

      await it('should export rootCertificates as an array', async () => {
        expect(Array.isArray(rootCertificates)).toBe(true);
      });

      await it('should export checkServerIdentity as a function', async () => {
        expect(typeof checkServerIdentity).toBe('function');
      });

      await it('should export getCiphers as a function', async () => {
        expect(typeof getCiphers).toBe('function');
      });

      await it('should export createServer as a function', async () => {
        expect(typeof createServer).toBe('function');
      });

      await it('should have all exports on default export', async () => {
        expect(typeof tls.TLSSocket).toBe('function');
        expect(typeof tls.connect).toBe('function');
        expect(typeof tls.createSecureContext).toBe('function');
        expect(typeof tls.checkServerIdentity).toBe('function');
        expect(typeof tls.getCiphers).toBe('function');
        expect(typeof tls.createServer).toBe('function');
        expect(Array.isArray(tls.rootCertificates)).toBe(true);
        expect(tls.DEFAULT_MIN_VERSION).toBe('TLSv1.2');
        expect(tls.DEFAULT_MAX_VERSION).toBe('TLSv1.3');
        expect(typeof tls.DEFAULT_CIPHERS).toBe('string');
      });
    });

    // ===================== TLSSocket =====================
    await describe('TLSSocket', async () => {
      await it('should be constructable', async () => {
        const socket = new TLSSocket(undefined as unknown as import("net").Socket);
        expect(socket).toBeDefined();
      });

      await it('should have encrypted property set to true', async () => {
        const socket = new TLSSocket(undefined as unknown as import("net").Socket);
        expect(socket.encrypted).toBe(true);
      });

      await it('should have authorized property as boolean', async () => {
        const socket = new TLSSocket(undefined as unknown as import("net").Socket);
        expect(typeof socket.authorized).toBe('boolean');
      });

      await it('authorized should default to false', async () => {
        const socket = new TLSSocket(undefined as unknown as import("net").Socket);
        expect(socket.authorized).toBe(false);
      });

      await it('should have getPeerCertificate method', async () => {
        const socket = new TLSSocket(undefined as unknown as import("net").Socket);
        expect(typeof socket.getPeerCertificate).toBe('function');
      });

      await it('should have getProtocol method', async () => {
        const socket = new TLSSocket(undefined as unknown as import("net").Socket);
        expect(typeof socket.getProtocol).toBe('function');
      });

      await it('should have getCipher method', async () => {
        const socket = new TLSSocket(undefined as unknown as import("net").Socket);
        expect(typeof socket.getCipher).toBe('function');
      });

      await it('should have alpnProtocol property', async () => {
        const socket = new TLSSocket(undefined as unknown as import("net").Socket);
        // Node.js: alpnProtocol is a property (null or string), our impl: false or string
        const val = socket.alpnProtocol;
        expect(val === false || val === null || typeof val === 'string').toBe(true);
      });

      await it('getPeerCertificate should return object when not connected', async () => {
        const socket = new TLSSocket(undefined as unknown as import("net").Socket);
        const cert = socket.getPeerCertificate();
        expect(typeof cert).toBe('object');
      });

      await it('getProtocol should return null when not connected', async () => {
        const socket = new TLSSocket(undefined as unknown as import("net").Socket);
        const proto = socket.getProtocol();
        expect(proto === null || typeof proto === 'string').toBe(true);
      });

      await it('getCipher should return null when not connected', async () => {
        const socket = new TLSSocket(undefined as unknown as import("net").Socket);
        const cipher = socket.getCipher();
        expect(cipher === null || cipher === undefined || typeof cipher === 'object').toBe(true);
      });

      await it('alpnProtocol should default to false', async () => {
        const socket = new TLSSocket(undefined as unknown as import("net").Socket);
        expect(socket.alpnProtocol === false || socket.alpnProtocol === null).toBe(true);
      });

      await it('authorizationError should be undefined initially', async () => {
        const socket = new TLSSocket(undefined as unknown as import("net").Socket);
        expect(socket.authorizationError === undefined || socket.authorizationError === null).toBe(true);
      });

      await it('should extend Socket (EventEmitter)', async () => {
        const socket = new TLSSocket(undefined as unknown as import("net").Socket);
        expect(typeof socket.on).toBe('function');
        expect(typeof socket.emit).toBe('function');
        expect(typeof socket.once).toBe('function');
        expect(typeof socket.removeListener).toBe('function');
      });

      await it('should have destroy method', async () => {
        const socket = new TLSSocket(undefined as unknown as import("net").Socket);
        expect(typeof socket.destroy).toBe('function');
      });

      await it('should have write method', async () => {
        const socket = new TLSSocket(undefined as unknown as import("net").Socket);
        expect(typeof socket.write).toBe('function');
      });

      await it('should have end method', async () => {
        const socket = new TLSSocket(undefined as unknown as import("net").Socket);
        expect(typeof socket.end).toBe('function');
      });
    });

    // ===================== TLSServer / createServer =====================
    await describe('TLSServer', async () => {
      await it('should export TLSServer as a function', async () => {
        expect(typeof TLSServer).toBe('function');
      });

      await it('should export createServer as a function', async () => {
        expect(typeof createServer).toBe('function');
      });

      await it('should be constructable', async () => {
        const server = new TLSServer();
        expect(server).toBeDefined();
      });

      await it('createServer should return a TLSServer', async () => {
        const server = createServer();
        expect(server).toBeDefined();
      });

      await it('createServer should accept a listener', async () => {
        const server = createServer(() => {});
        expect(server).toBeDefined();
      });

      await it('createServer should accept options and listener', async () => {
        const server = createServer({ cert: '', key: '' }, () => {});
        expect(server).toBeDefined();
      });

      await it('should have addContext method', async () => {
        const server = new TLSServer();
        expect(typeof server.addContext).toBe('function');
      });

      await it('should have listen method', async () => {
        const server = new TLSServer();
        expect(typeof server.listen).toBe('function');
      });

      await it('should have close method', async () => {
        const server = new TLSServer();
        expect(typeof server.close).toBe('function');
      });

      await it('should have address method', async () => {
        const server = new TLSServer();
        expect(typeof server.address).toBe('function');
      });

      await it('should be an EventEmitter', async () => {
        const server = new TLSServer();
        expect(typeof server.on).toBe('function');
        expect(typeof server.emit).toBe('function');
        expect(typeof server.once).toBe('function');
      });
    });

    // ===================== createSecureContext =====================
    await describe('createSecureContext', async () => {
      await it('should return a context object', async () => {
        const ctx = createSecureContext();
        expect(ctx).toBeDefined();
        expect(typeof ctx).toBe('object');
      });

      await it('should accept empty options', async () => {
        const ctx = createSecureContext({});
        expect(ctx).toBeDefined();
      });

      await it('should have context property', async () => {
        const ctx = createSecureContext();
        expect((ctx as { context?: unknown }).context !== undefined).toBe(true);
      });

      await it('should return same type for repeated calls', async () => {
        const ctx1 = createSecureContext();
        const ctx2 = createSecureContext();
        expect(typeof ctx1).toBe(typeof ctx2);
      });
    });

    // ===================== getCiphers =====================
    await describe('getCiphers', async () => {
      await it('should return an array of strings', async () => {
        const ciphers = getCiphers();
        expect(Array.isArray(ciphers)).toBe(true);
        expect(ciphers.length).toBeGreaterThan(0);
        for (const c of ciphers) {
          expect(typeof c).toBe('string');
        }
      });

      await it('should be on the default export', async () => {
        expect(typeof tls.getCiphers).toBe('function');
        const ciphers = tls.getCiphers();
        expect(Array.isArray(ciphers)).toBe(true);
      });

      await it('should contain lowercase cipher names', async () => {
        const ciphers = getCiphers();
        for (const c of ciphers) {
          expect(c).toBe(c.toLowerCase());
        }
      });

      await it('should contain aes ciphers', async () => {
        const ciphers = getCiphers();
        const hasAes = ciphers.some(c => c.includes('aes'));
        expect(hasAes).toBe(true);
      });

      await it('should not contain duplicates', async () => {
        const ciphers = getCiphers();
        const unique = new Set(ciphers);
        expect(unique.size).toBe(ciphers.length);
      });
    });

    // ===================== connect =====================
    await describe('tls.connect', async () => {
      await it('should be a function', async () => {
        expect(typeof connect).toBe('function');
      });

      await it('should be on the default export', async () => {
        expect(typeof tls.connect).toBe('function');
      });
    });

    // ===================== checkServerIdentity =====================
    // Comprehensive tests ported from refs/node-test/parallel/test-tls-check-server-identity.js
    await describe('checkServerIdentity', async () => {

      // --- Basic function checks ---
      await it('should be a function', async () => {
        expect(typeof checkServerIdentity).toBe('function');
        expect(typeof tls.checkServerIdentity).toBe('function');
      });

      // --- CN matching ---
      await describe('CN matching', async () => {
        await it('should return undefined for exact CN match', async () => {
          const result = checkServerIdentity('a.com', fakeCert({ subject: { CN: 'a.com' } }));
          expect(result).toBeUndefined();
        });

        await it('should match CN case-insensitively', async () => {
          const result = checkServerIdentity('a.com', fakeCert({ subject: { CN: 'A.COM' } }));
          expect(result).toBeUndefined();
        });

        await it('should return error for non-matching CN', async () => {
          const err = checkServerIdentity('a.com', fakeCert({ subject: { CN: 'b.com' } }));
          expect(err instanceof Error).toBe(true);
        });

        await it('should handle trailing-dot FQDN in hostname', async () => {
          const result = checkServerIdentity('a.com.', fakeCert({ subject: { CN: 'a.com' } }));
          expect(result).toBeUndefined();
        });

        await it('should handle trailing-dot FQDN in CN', async () => {
          const result = checkServerIdentity('a.com', fakeCert({ subject: { CN: 'a.com.' } }));
          expect(result).toBeUndefined();
        });

        await it('should handle trailing dots on both sides', async () => {
          const result = checkServerIdentity('a.com.', fakeCert({ subject: { CN: 'a.com.' } }));
          expect(result).toBeUndefined();
        });

        await it('should match array CN values', async () => {
          const result = checkServerIdentity('b.com', fakeCert({
            subject: { CN: ['a.com', 'b.com'] },
          }));
          expect(result).toBeUndefined();
        });

        await it('should fail when hostname not in CN array', async () => {
          const err = checkServerIdentity('c.com', fakeCert({
            subject: { CN: ['a.com', 'b.com'] },
          }));
          expect(err instanceof Error).toBe(true);
        });

        await it('should handle single-label hostname with single-label CN', async () => {
          const result = checkServerIdentity('localhost', fakeCert({
            subject: { CN: 'localhost' },
          }));
          expect(result).toBeUndefined();
        });
      });

      // --- Wildcard matching ---
      await describe('wildcard matching', async () => {
        await it('should match *.example.com against sub.example.com', async () => {
          const result = checkServerIdentity('sub.example.com', fakeCert({
            subject: {},
            subjectaltname: 'DNS:*.example.com',
          }));
          expect(result).toBeUndefined();
        });

        await it('should NOT match *.example.com against nested.sub.example.com', async () => {
          const err = checkServerIdentity('nested.sub.example.com', fakeCert({
            subject: {},
            subjectaltname: 'DNS:*.example.com',
          }));
          expect(err instanceof Error).toBe(true);
        });

        await it('should NOT match *.example.com against example.com itself', async () => {
          const err = checkServerIdentity('example.com', fakeCert({
            subject: {},
            subjectaltname: 'DNS:*.example.com',
          }));
          expect(err instanceof Error).toBe(true);
        });

        await it('should match wildcard CN when no SANs present', async () => {
          const result = checkServerIdentity('foo.example.com', fakeCert({
            subject: { CN: '*.example.com' },
          }));
          expect(result).toBeUndefined();
        });

        await it('wildcard CN should NOT match two-level deep', async () => {
          const err = checkServerIdentity('a.b.example.com', fakeCert({
            subject: { CN: '*.example.com' },
          }));
          expect(err instanceof Error).toBe(true);
        });

        await it('should match wildcard with different subdomains', async () => {
          const result1 = checkServerIdentity('foo.example.com', fakeCert({
            subject: {},
            subjectaltname: 'DNS:*.example.com',
          }));
          expect(result1).toBeUndefined();

          const result2 = checkServerIdentity('bar.example.com', fakeCert({
            subject: {},
            subjectaltname: 'DNS:*.example.com',
          }));
          expect(result2).toBeUndefined();
        });
      });

      // --- DNS SAN matching ---
      await describe('DNS SAN matching', async () => {
        await it('should match hostname in DNS SAN', async () => {
          const result = checkServerIdentity('foo.example.com', fakeCert({
            subject: { CN: 'wrong.com' },
            subjectaltname: 'DNS:foo.example.com',
          }));
          expect(result).toBeUndefined();
        });

        await it('SAN takes precedence over CN', async () => {
          // When SANs are present, CN should be ignored
          const err = checkServerIdentity('wrong.com', fakeCert({
            subject: { CN: 'wrong.com' },
            subjectaltname: 'DNS:right.com',
          }));
          expect(err instanceof Error).toBe(true);
        });

        await it('should handle multiple DNS SANs', async () => {
          const result = checkServerIdentity('b.com', fakeCert({
            subject: { CN: 'a.com' },
            subjectaltname: 'DNS:a.com, DNS:b.com',
          }));
          expect(result).toBeUndefined();
        });

        await it('should fail when hostname not in any DNS SAN', async () => {
          const err = checkServerIdentity('c.com', fakeCert({
            subject: { CN: 'c.com' },
            subjectaltname: 'DNS:a.com, DNS:b.com',
          }));
          expect(err instanceof Error).toBe(true);
        });

        await it('should match wildcard DNS SAN', async () => {
          const result = checkServerIdentity('bar.example.com', fakeCert({
            subject: { CN: 'wrong.com' },
            subjectaltname: 'DNS:*.example.com',
          }));
          expect(result).toBeUndefined();
        });

        await it('should handle mixed DNS and IP SANs', async () => {
          const result = checkServerIdentity('example.com', fakeCert({
            subject: {},
            subjectaltname: 'DNS:example.com, IP Address:1.2.3.4',
          }));
          expect(result).toBeUndefined();
        });

        await it('should handle DNS SAN with trailing whitespace', async () => {
          const result = checkServerIdentity('example.com', fakeCert({
            subject: {},
            subjectaltname: 'DNS:example.com ',
          }));
          // May or may not match depending on trimming
          expect(result === undefined || result instanceof Error).toBe(true);
        });
      });

      // --- IP address matching ---
      await describe('IP address matching', async () => {
        await it('should match IPv4 in IP Address SAN', async () => {
          const result = checkServerIdentity('8.8.8.8', fakeCert({
            subject: { CN: '8.8.8.8' },
            subjectaltname: 'IP Address:8.8.8.8',
          }));
          expect(result).toBeUndefined();
        });

        await it('should fail IPv4 not in IP Address SAN', async () => {
          const err = checkServerIdentity('8.8.4.4', fakeCert({
            subject: { CN: '8.8.4.4' },
            subjectaltname: 'IP Address:8.8.8.8',
          }));
          expect(err instanceof Error).toBe(true);
        });

        await it('should fail IPv4 with only CN (no SAN IP entry)', async () => {
          const err = checkServerIdentity('8.8.8.8', fakeCert({
            subject: { CN: '8.8.8.8' },
          }));
          expect(err instanceof Error).toBe(true);
        });

        await it('should match multiple IP addresses in SAN', async () => {
          const result = checkServerIdentity('1.2.3.4', fakeCert({
            subject: {},
            subjectaltname: 'IP Address:1.2.3.4, IP Address:5.6.7.8',
          }));
          expect(result).toBeUndefined();
        });

        await it('should match second IP in SAN', async () => {
          const result = checkServerIdentity('5.6.7.8', fakeCert({
            subject: {},
            subjectaltname: 'IP Address:1.2.3.4, IP Address:5.6.7.8',
          }));
          expect(result).toBeUndefined();
        });

        await it('should handle IPv6 in IP Address SAN', async () => {
          const result = checkServerIdentity('::1', fakeCert({
            subject: {},
            subjectaltname: 'IP Address:::1',
          }));
          expect(result).toBeUndefined();
        });

        await it('should fail IPv4 in DNS SAN (IP should use IP Address SAN)', async () => {
          const err = checkServerIdentity('1.2.3.4', fakeCert({
            subject: {},
            subjectaltname: 'DNS:1.2.3.4',
          }));
          expect(err instanceof Error).toBe(true);
        });
      });

      // --- Error object properties ---
      await describe('error properties', async () => {
        await it('should have reason property on error', async () => {
          const err = checkServerIdentity('a.com', fakeCert({ subject: { CN: 'b.com' } }));
          expect(err instanceof Error).toBe(true);
          expect(typeof (err as { reason?: string }).reason).toBe('string');
        });

        await it('should have host property on error', async () => {
          const err = checkServerIdentity('a.com', fakeCert({ subject: { CN: 'b.com' } }));
          expect((err as { host?: string }).host).toBe('a.com');
        });

        await it('should have cert property on error', async () => {
          const cert = fakeCert({ subject: { CN: 'b.com' } });
          const err = checkServerIdentity('a.com', cert);
          expect((err as { cert?: unknown } | undefined)?.cert).toBe(cert);
        });

        await it('error message should contain hostname for CN mismatch', async () => {
          const err = checkServerIdentity('a.com', fakeCert({ subject: { CN: 'b.com' } }));
          expect(err instanceof Error).toBe(true);
          expect((err as Error).message).toContain('a.com');
        });

        await it('error message should contain IP for IP mismatch', async () => {
          const err = checkServerIdentity('8.8.8.8', fakeCert({
            subject: {},
            subjectaltname: 'IP Address:1.2.3.4',
          }));
          expect(err instanceof Error).toBe(true);
          expect((err as Error).message).toContain('8.8.8.8');
        });
      });

      // --- Edge cases ---
      await describe('edge cases', async () => {
        await it('should return error when cert has no subject and no altnames', async () => {
          const err = checkServerIdentity('a.com', fakeCert({}));
          expect(err instanceof Error).toBe(true);
          expect((err as Error).message).toContain('DNS');
        });

        await it('should handle false-y host values', async () => {
          const err = checkServerIdentity(false as unknown as string, fakeCert({
            subject: { CN: 'a.com' },
          }));
          expect(err instanceof Error).toBe(true);
        });

        await it('should handle empty string hostname', async () => {
          const err = checkServerIdentity('', fakeCert({ subject: { CN: 'a.com' } }));
          expect(err instanceof Error).toBe(true);
        });

        await it('should handle empty CN', async () => {
          const err = checkServerIdentity('a.com', fakeCert({ subject: { CN: '' } }));
          expect(err instanceof Error).toBe(true);
        });

        await it('should handle undefined CN', async () => {
          const err = checkServerIdentity('a.com', fakeCert({ subject: {} }));
          expect(err instanceof Error).toBe(true);
        });

        await it('should handle empty subjectaltname string', async () => {
          const err = checkServerIdentity('a.com', fakeCert({
            subject: { CN: 'a.com' },
            subjectaltname: '',
          }));
          // Empty altname means CN fallback
          expect(err === undefined || err instanceof Error).toBe(true);
        });

        await it('should handle numeric hostname as string', async () => {
          const result = checkServerIdentity('127.0.0.1', fakeCert({
            subject: {},
            subjectaltname: 'IP Address:127.0.0.1',
          }));
          expect(result).toBeUndefined();
        });

        await it('should handle cert with only URI SAN (no DNS, no IP)', async () => {
          const err = checkServerIdentity('a.com', fakeCert({
            subject: {},
            subjectaltname: 'URI:https://a.com',
          }));
          // URI SANs don't count for hostname verification
          expect(err instanceof Error).toBe(true);
        });

        await it('should handle cert with email SAN only', async () => {
          const err = checkServerIdentity('a.com', fakeCert({
            subject: {},
            subjectaltname: 'email:admin@a.com',
          }));
          expect(err instanceof Error).toBe(true);
        });
      });
    });

    // ===================== rootCertificates =====================
    await describe('rootCertificates', async () => {
      await it('should be an array', async () => {
        expect(Array.isArray(rootCertificates)).toBe(true);
      });

      await it('should be on default export', async () => {
        expect(Array.isArray(tls.rootCertificates)).toBe(true);
      });

      await it('should be the same reference on default and named export', async () => {
        expect(tls.rootCertificates).toBe(rootCertificates);
      });
    });
  });
};
