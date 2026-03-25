// Ported from refs/node-test/parallel/test-crypto-dh.js
// Original: MIT license, Copyright (c) Node.js contributors

import { describe, it, expect } from '@gjsify/unit';
import { createDiffieHellman, getDiffieHellman } from 'node:crypto';
import { Buffer } from 'node:buffer';

export default async () => {

  await describe('crypto.createDiffieHellman', async () => {
    await it('should be a function', async () => {
      expect(typeof createDiffieHellman).toBe('function');
    });

    await it('should create DH with prime buffer', async () => {
      // Use a predefined group prime instead of generating (Node.js rejects small primes)
      const dh = getDiffieHellman('modp14');
      expect(dh).toBeDefined();
      expect(typeof dh.generateKeys).toBe('function');
    });

    await it('should generate keys', async () => {
      const dh = getDiffieHellman('modp14');
      const keys = dh.generateKeys();
      expect(keys).toBeDefined();
      expect(Buffer.isBuffer(keys)).toBe(true);
      expect(keys.length).toBeGreaterThan(0);
    });

    await it('should get prime and generator', async () => {
      const dh = getDiffieHellman('modp14');
      dh.generateKeys();
      const prime = dh.getPrime();
      const generator = dh.getGenerator();
      expect(Buffer.isBuffer(prime)).toBe(true);
      expect(Buffer.isBuffer(generator)).toBe(true);
      expect(prime.length).toBeGreaterThan(0);
      expect(generator.length).toBeGreaterThan(0);
    });

    await it('should compute shared secret', async () => {
      const alice = createDiffieHellman(512);
      alice.generateKeys();

      const bob = createDiffieHellman(alice.getPrime(), alice.getGenerator());
      bob.generateKeys();

      const aliceSecret = alice.computeSecret(bob.getPublicKey());
      const bobSecret = bob.computeSecret(alice.getPublicKey());

      expect(aliceSecret.toString('hex')).toBe(bobSecret.toString('hex'));
    });

    await it('should support hex encoding for keys', async () => {
      const dh = getDiffieHellman('modp5');
      dh.generateKeys();

      const pubHex = dh.getPublicKey('hex');
      const privHex = dh.getPrivateKey('hex');
      expect(typeof pubHex).toBe('string');
      expect(typeof privHex).toBe('string');
      expect(pubHex.length).toBeGreaterThan(0);
      expect(privHex.length).toBeGreaterThan(0);
    });

    await it('should create DH from prime buffer', async () => {
      const source = getDiffieHellman('modp5');
      const primeBuf = source.getPrime();

      const dh = createDiffieHellman(primeBuf);
      dh.generateKeys();
      expect(dh.getPrime('hex')).toBe(primeBuf.toString('hex'));
    });
  });

  await describe('crypto.getDiffieHellman', async () => {
    await it('should be a function', async () => {
      expect(typeof getDiffieHellman).toBe('function');
    });

    await it('should return a DH object for modp14', async () => {
      const dh = getDiffieHellman('modp14');
      expect(dh).toBeDefined();
      expect(typeof dh.generateKeys).toBe('function');
    });

    await it('should compute shared secret with predefined group', async () => {
      const alice = getDiffieHellman('modp14');
      alice.generateKeys();

      const bob = getDiffieHellman('modp14');
      bob.generateKeys();

      const aliceSecret = alice.computeSecret(bob.getPublicKey());
      const bobSecret = bob.computeSecret(alice.getPublicKey());

      expect(aliceSecret.toString('hex')).toBe(bobSecret.toString('hex'));
    });

    await it('should support modp5', async () => {
      const dh = getDiffieHellman('modp5');
      dh.generateKeys();
      const pub = dh.getPublicKey();
      expect(pub.length).toBeGreaterThan(0);
    });

    await it('should throw for unknown group', async () => {
      expect(() => getDiffieHellman('modp999')).toThrow();
    });
  });
};
