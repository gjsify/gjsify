import { describe, it, expect } from '@gjsify/unit';
import tls, {
  TLSSocket,
  connect,
  createSecureContext,
  rootCertificates,
  DEFAULT_MIN_VERSION,
  DEFAULT_MAX_VERSION,
} from 'tls';

export default async () => {
  await describe('tls', async () => {

    // --- Constants ---
    await describe('constants', async () => {
      await it('should export DEFAULT_MIN_VERSION as TLSv1.2', async () => {
        expect(DEFAULT_MIN_VERSION).toBe('TLSv1.2');
      });

      await it('should export DEFAULT_MAX_VERSION as TLSv1.3', async () => {
        expect(DEFAULT_MAX_VERSION).toBe('TLSv1.3');
      });
    });

    // --- Module exports ---
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

      await it('should have all exports on default export', async () => {
        expect(typeof tls.TLSSocket).toBe('function');
        expect(typeof tls.connect).toBe('function');
        expect(typeof tls.createSecureContext).toBe('function');
        expect(Array.isArray(tls.rootCertificates)).toBe(true);
        expect(tls.DEFAULT_MIN_VERSION).toBe('TLSv1.2');
        expect(tls.DEFAULT_MAX_VERSION).toBe('TLSv1.3');
      });
    });

    // --- TLSSocket ---
    await describe('TLSSocket', async () => {
      await it('should be constructable', async () => {
        const socket = new TLSSocket();
        expect(socket).toBeDefined();
      });

      await it('should have encrypted property set to true', async () => {
        const socket = new TLSSocket();
        expect(socket.encrypted).toBe(true);
      });

      await it('should have authorized property', async () => {
        const socket = new TLSSocket();
        expect(typeof socket.authorized).toBe('boolean');
      });

      await it('should have getPeerCertificate method', async () => {
        const socket = new TLSSocket();
        expect(typeof socket.getPeerCertificate).toBe('function');
      });

      await it('should have getProtocol method', async () => {
        const socket = new TLSSocket();
        expect(typeof socket.getProtocol).toBe('function');
      });

      await it('should have getCipher method', async () => {
        const socket = new TLSSocket();
        expect(typeof socket.getCipher).toBe('function');
      });

      await it('getPeerCertificate should return object when not connected', async () => {
        const socket = new TLSSocket();
        const cert = socket.getPeerCertificate();
        expect(typeof cert).toBe('object');
      });

      await it('getProtocol should return a value when not connected', async () => {
        const socket = new TLSSocket();
        const proto = socket.getProtocol();
        // Node.js returns protocol version string or null
        expect(proto === null || typeof proto === 'string').toBe(true);
      });

      await it('getCipher should return object or undefined when not connected', async () => {
        const socket = new TLSSocket();
        const cipher = socket.getCipher();
        // Node.js returns undefined when not connected, our impl may return null
        expect(cipher === null || cipher === undefined || typeof cipher === 'object').toBe(true);
      });
    });

    // --- createSecureContext ---
    await describe('createSecureContext', async () => {
      await it('should return a context object', async () => {
        const ctx = createSecureContext();
        expect(ctx).toBeDefined();
        expect(typeof ctx).toBe('object');
      });

      await it('should accept options', async () => {
        const ctx = createSecureContext({ rejectUnauthorized: false });
        expect(ctx).toBeDefined();
      });

      await it('should have context property', async () => {
        const ctx = createSecureContext();
        expect(ctx.context).toBeDefined();
      });
    });
  });
};
