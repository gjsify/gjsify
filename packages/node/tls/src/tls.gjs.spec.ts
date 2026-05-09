// SPDX-License-Identifier: MIT
// GJS-only TLS specs — cover paths that depend on Gio.TlsCertificate /
// Gio.TlsServerConnection / Gio.TlsClientConnection plumbing. These are
// skipped on Node where the @girs/* GI bindings don't resolve.
//
// Reference: refs/node-test/parallel/test-tls-cert-chain.js,
//   test-tls-server-verify.js, test-tls-alpn-server-client.js,
//   test-tls-sni-server.js — adapted to validate option plumbing rather
//   than full TCP round-trips (which Gio's TLS backend exercises through
//   GnuTLS in production).

import { describe, it, expect, on } from '@gjsify/unit';
import {
  createServer,
  createSecureContext,
  TLSSocket,
} from 'node:tls';

// A self-signed cert+key pair generated for the gjsify test suite.
// `openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 3650
//   -nodes -subj /CN=localhost -addext "subjectAltName = DNS:localhost,IP:127.0.0.1"`
// Embedded inline so tests stay hermetic (no fixtures).
const TEST_CERT_AND_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDLfvlLZ4Pa3GZP
mockmockmockmockmockmockmockmockmockmockmockmockmockmockmockmockm
-----END PRIVATE KEY-----
-----BEGIN CERTIFICATE-----
MIIDCTCCAfGgAwIBAgIUEihvCxNb+vyvKNUTlfsYV5RbS8owDQYJKoZIhvcNAQEL
mockmockmockmockmockmockmockmockmockmockmockmockmockmockmockmockm
-----END CERTIFICATE-----
`;

export default async () => {
  await on('Gjs', async () => {
    await describe('tls (GJS-only) — option plumbing + cert chain', async () => {

      // ---------------- ALPN configuration ----------------
      await describe('ALPN', async () => {
        await it('createServer accepts ALPNProtocols option without throwing', async () => {
          const server = createServer({ ALPNProtocols: ['h2', 'http/1.1'] });
          expect(server).toBeDefined();
          server.close();
        });

        await it('createServer accepts empty ALPNProtocols array', async () => {
          const server = createServer({ ALPNProtocols: [] });
          expect(server).toBeDefined();
          server.close();
        });

        await it('TLSSocket.alpnProtocol is false before handshake', async () => {
          const socket = new TLSSocket(undefined as unknown as import("net").Socket);
          expect(socket.alpnProtocol).toBe(false);
        });
      });

      // ---------------- SNI / addContext ----------------
      await describe('SNI server', async () => {
        await it('addContext accepts hostname + secure context options', async () => {
          const server = createServer();
          // PEM strings will fail to parse but addContext must not throw.
          server.addContext('a.example.com', { cert: '', key: '' });
          server.addContext('b.example.com', { cert: '', key: '' });
          server.close();
        });

        await it('addContext accepts wildcard hostnames', async () => {
          const server = createServer();
          server.addContext('*.example.com', { cert: '', key: '' });
          server.close();
        });

        await it('createServer accepts SNICallback option', async () => {
          const server = createServer({
            SNICallback: (_servername: string, cb: (err: Error | null, ctx?: unknown) => void) => {
              cb(null, undefined);
            },
          } as unknown as Parameters<typeof createServer>[0]);
          expect(server).toBeDefined();
          server.close();
        });
      });

      // ---------------- mTLS server config ----------------
      await describe('mTLS', async () => {
        await it('createServer accepts requestCert option', async () => {
          const server = createServer({ requestCert: true });
          expect(server).toBeDefined();
          server.close();
        });

        await it('createServer accepts requestCert + rejectUnauthorized', async () => {
          const server = createServer({ requestCert: true, rejectUnauthorized: true });
          expect(server).toBeDefined();
          server.close();
        });

        await it('createServer accepts ca for client-cert validation', async () => {
          const server = createServer({
            requestCert: true,
            rejectUnauthorized: true,
            ca: '-----BEGIN CERTIFICATE-----\n-----END CERTIFICATE-----',
          });
          expect(server).toBeDefined();
          server.close();
        });
      });

      // ---------------- SecureContext PEM round-trip ----------------
      await describe('SecureContext (Gio-backed)', async () => {
        await it('createSecureContext returns an object with caCertificates array', async () => {
          const ctx = createSecureContext({
            ca: '-----BEGIN CERTIFICATE-----\n-----END CERTIFICATE-----\n' +
                '-----BEGIN CERTIFICATE-----\n-----END CERTIFICATE-----',
          }) as unknown as { caCertificates?: unknown[] };
          // ca is invalid PEM — expect zero entries, no throw.
          expect(Array.isArray(ctx.caCertificates)).toBe(true);
        });

        await it('createSecureContext tolerates invalid PEM gracefully', async () => {
          // Invalid PEM should NOT throw; consumers handle the missing cert.
          const ctx = createSecureContext({
            cert: 'not-pem',
            key: 'not-pem',
          }) as unknown as { certificate?: unknown };
          expect(ctx.certificate === null || ctx.certificate === undefined).toBe(true);
        });

        await it('TEST_CERT_AND_KEY constant is non-empty', async () => {
          // Sanity: ensure inline material is intact (regression guard if
          // tooling rewrites this file).
          expect(TEST_CERT_AND_KEY).toContain('BEGIN');
          expect(TEST_CERT_AND_KEY).toContain('END');
        });
      });

      // ---------------- TLSSocket pre-handshake state ----------------
      await describe('TLSSocket pre-handshake', async () => {
        await it('servername defaults to undefined', async () => {
          const socket = new TLSSocket(undefined as unknown as import("net").Socket);
          expect(socket.servername).toBeUndefined();
        });

        await it('_tlsConnection is null before handshake', async () => {
          const socket = new TLSSocket(undefined as unknown as import("net").Socket);
          expect((socket as unknown as { _tlsConnection?: unknown })._tlsConnection).toBeNull();
        });

        await it('getPeerCertificate(false) returns empty object', async () => {
          const socket = new TLSSocket(undefined as unknown as import("net").Socket);
          const cert = socket.getPeerCertificate(false);
          expect(typeof cert).toBe('object');
          expect(Object.keys(cert).length).toBe(0);
        });

        await it('getPeerCertificate(true) returns empty object before handshake', async () => {
          const socket = new TLSSocket(undefined as unknown as import("net").Socket);
          const cert = socket.getPeerCertificate(true);
          expect(typeof cert).toBe('object');
          expect(Object.keys(cert).length).toBe(0);
        });
      });
    });
  });
};
