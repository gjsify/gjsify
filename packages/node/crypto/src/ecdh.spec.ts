// Ported from refs/node-test/parallel/test-crypto-ecdh.js
// Original: MIT license, Copyright (c) Node.js contributors

import { describe, it, expect } from '@gjsify/unit';
import { createECDH, getCurves } from 'node:crypto';
import { Buffer } from 'node:buffer';

export default async () => {

  await describe('crypto.getCurves', async () => {
    await it('should return an array', async () => {
      const curves = getCurves();
      expect(Array.isArray(curves)).toBe(true);
    });

    await it('should contain common curves', async () => {
      const curves = getCurves();
      expect(curves).toContain('secp256k1');
      expect(curves).toContain('prime256v1');
      expect(curves).toContain('secp384r1');
      expect(curves).toContain('secp521r1');
    });
  });

  await describe('crypto.createECDH', async () => {
    await it('should be a function', async () => {
      expect(typeof createECDH).toBe('function');
    });

    await it('should create an ECDH instance', async () => {
      const ecdh = createECDH('secp256k1');
      expect(ecdh).toBeDefined();
      expect(typeof ecdh.generateKeys).toBe('function');
    });

    await it('should generate keys for secp256k1', async () => {
      const ecdh = createECDH('secp256k1');
      const pub = ecdh.generateKeys();
      expect(Buffer.isBuffer(pub)).toBe(true);
      // Uncompressed public key: 0x04 + 32 bytes X + 32 bytes Y = 65 bytes
      expect(pub.length).toBe(65);
      expect(pub[0]).toBe(0x04);
    });

    await it('should generate keys for prime256v1', async () => {
      const ecdh = createECDH('prime256v1');
      const pub = ecdh.generateKeys();
      expect(Buffer.isBuffer(pub)).toBe(true);
      expect(pub.length).toBe(65);
      expect(pub[0]).toBe(0x04);
    });

    await it('should compute shared secret for secp256k1', async () => {
      const alice = createECDH('secp256k1');
      alice.generateKeys();

      const bob = createECDH('secp256k1');
      bob.generateKeys();

      const aliceSecret = alice.computeSecret(bob.getPublicKey());
      const bobSecret = bob.computeSecret(alice.getPublicKey());

      expect(aliceSecret.toString('hex')).toBe(bobSecret.toString('hex'));
      expect(aliceSecret.length).toBe(32);
    });

    await it('should compute shared secret for prime256v1', async () => {
      const alice = createECDH('prime256v1');
      alice.generateKeys();

      const bob = createECDH('prime256v1');
      bob.generateKeys();

      const aliceSecret = alice.computeSecret(bob.getPublicKey());
      const bobSecret = bob.computeSecret(alice.getPublicKey());

      expect(aliceSecret.toString('hex')).toBe(bobSecret.toString('hex'));
      expect(aliceSecret.length).toBe(32);
    });

    await it('should get/set private key', async () => {
      const ecdh = createECDH('secp256k1');
      ecdh.generateKeys();
      const priv = ecdh.getPrivateKey();
      expect(Buffer.isBuffer(priv)).toBe(true);
      // Node's native createECDH().getPrivateKey() uses OpenSSL's BN_bn2bin,
      // which strips leading zero bytes — ~1/256 of random 32-byte keys come
      // back shorter. Accept anything up to the curve byte length.
      expect(priv.length).toBeGreaterThan(0);
      expect(priv.length).toBeLessThan(33);

      const ecdh2 = createECDH('secp256k1');
      ecdh2.setPrivateKey(priv);
      expect(ecdh2.getPrivateKey('hex')).toBe(priv.toString('hex'));
    });

    await it('should support compressed public key format', async () => {
      const ecdh = createECDH('secp256k1');
      ecdh.generateKeys();

      const compressed = ecdh.getPublicKey(null, 'compressed');
      expect(Buffer.isBuffer(compressed)).toBe(true);
      expect(compressed.length).toBe(33);
      expect(compressed[0] === 0x02 || compressed[0] === 0x03).toBe(true);
    });

    await it('should support hex encoding', async () => {
      const ecdh = createECDH('secp256k1');
      ecdh.generateKeys();

      const pubHex = ecdh.getPublicKey('hex');
      expect(typeof pubHex).toBe('string');
      expect(pubHex.length).toBe(130); // 65 bytes * 2 hex chars
    });

    await it('should throw for unknown curve', async () => {
      expect(() => createECDH('nonexistent-curve')).toThrow();
    });
  });
};
