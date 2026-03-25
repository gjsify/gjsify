// Tests for W3C WebCrypto API
// Ported from refs/deno/tests/unit/webcrypto_test.ts and refs/wpt/WebCryptoAPI/
// Original: MIT license (Deno), 3-Clause BSD license (WPT)

import { describe, it, expect } from '@gjsify/unit';

export default async () => {

  // Use global crypto (native on Node.js, polyfill on GJS)
  const subtle = globalThis.crypto.subtle;

  // ==================== digest ====================

  await describe('SubtleCrypto.digest', async () => {
    await it('should hash with SHA-256', async () => {
      const data = new TextEncoder().encode('hello');
      const hash = await subtle.digest('SHA-256', data);
      expect(hash instanceof ArrayBuffer).toBe(true);
      expect(hash.byteLength).toBe(32);
      // Known SHA-256 of 'hello'
      const bytes = new Uint8Array(hash);
      expect(bytes[0]).toBe(0x2c);
      expect(bytes[1]).toBe(0xf2);
    });

    await it('should hash with SHA-1', async () => {
      const data = new TextEncoder().encode('hello');
      const hash = await subtle.digest('SHA-1', data);
      expect(hash.byteLength).toBe(20);
    });

    await it('should hash with SHA-384', async () => {
      const data = new TextEncoder().encode('hello');
      const hash = await subtle.digest('SHA-384', data);
      expect(hash.byteLength).toBe(48);
    });

    await it('should hash with SHA-512', async () => {
      const data = new TextEncoder().encode('hello');
      const hash = await subtle.digest('SHA-512', data);
      expect(hash.byteLength).toBe(64);
    });

    await it('should accept algorithm as object', async () => {
      const data = new TextEncoder().encode('hello');
      const hash = await subtle.digest({ name: 'SHA-256' }, data);
      expect(hash.byteLength).toBe(32);
    });

    await it('should hash empty data', async () => {
      const hash = await subtle.digest('SHA-256', new Uint8Array(0));
      expect(hash.byteLength).toBe(32);
      // SHA-256 of empty string
      const bytes = new Uint8Array(hash);
      expect(bytes[0]).toBe(0xe3);
      expect(bytes[1]).toBe(0xb0);
    });
  });

  // ==================== generateKey (AES) ====================

  await describe('SubtleCrypto.generateKey (AES)', async () => {
    await it('should generate AES-CBC 256 key', async () => {
      const key = await subtle.generateKey(
        { name: 'AES-CBC', length: 256 },
        true,
        ['encrypt', 'decrypt'],
      ) as CryptoKey;
      expect(key.type).toBe('secret');
      expect(key.extractable).toBe(true);
      expect(key.algorithm.name).toBe('AES-CBC');
      expect(key.usages).toContain('encrypt');
      expect(key.usages).toContain('decrypt');
    });

    await it('should generate AES-GCM 128 key', async () => {
      const key = await subtle.generateKey(
        { name: 'AES-GCM', length: 128 },
        true,
        ['encrypt', 'decrypt'],
      ) as CryptoKey;
      expect(key.type).toBe('secret');
      expect((key.algorithm as any).length).toBe(128);
    });

    await it('should generate AES-CTR 192 key', async () => {
      const key = await subtle.generateKey(
        { name: 'AES-CTR', length: 192 },
        true,
        ['encrypt', 'decrypt'],
      ) as CryptoKey;
      expect(key.type).toBe('secret');
      expect((key.algorithm as any).length).toBe(192);
    });
  });

  // ==================== generateKey (HMAC) ====================

  await describe('SubtleCrypto.generateKey (HMAC)', async () => {
    await it('should generate HMAC key with SHA-256', async () => {
      const key = await subtle.generateKey(
        { name: 'HMAC', hash: 'SHA-256' },
        true,
        ['sign', 'verify'],
      ) as CryptoKey;
      expect(key.type).toBe('secret');
      expect(key.algorithm.name).toBe('HMAC');
      expect((key.algorithm as any).hash.name).toBe('SHA-256');
    });
  });

  // ==================== importKey / exportKey (raw, jwk) ====================

  await describe('SubtleCrypto.importKey / exportKey', async () => {
    await it('should import raw AES key and export back', async () => {
      const rawKey = crypto.getRandomValues(new Uint8Array(32));
      const key = await subtle.importKey(
        'raw',
        rawKey,
        { name: 'AES-CBC' },
        true,
        ['encrypt', 'decrypt'],
      );
      expect(key.type).toBe('secret');

      const exported = await subtle.exportKey('raw', key) as ArrayBuffer;
      const exportedBytes = new Uint8Array(exported);
      expect(exportedBytes.length).toBe(32);
      for (let i = 0; i < 32; i++) {
        expect(exportedBytes[i]).toBe(rawKey[i]);
      }
    });

    await it('should import raw HMAC key', async () => {
      const rawKey = new Uint8Array(32);
      crypto.getRandomValues(rawKey);
      const key = await subtle.importKey(
        'raw',
        rawKey,
        { name: 'HMAC', hash: 'SHA-256' },
        true,
        ['sign', 'verify'],
      );
      expect(key.type).toBe('secret');
      expect(key.algorithm.name).toBe('HMAC');
    });

    await it('should import and export JWK AES key', async () => {
      const key = await subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt'],
      ) as CryptoKey;

      const jwk = await subtle.exportKey('jwk', key) as JsonWebKey;
      expect(jwk.kty).toBe('oct');
      expect(jwk.k).toBeDefined();
      expect(jwk.ext).toBe(true);

      const imported = await subtle.importKey(
        'jwk',
        jwk,
        { name: 'AES-GCM' },
        true,
        ['encrypt', 'decrypt'],
      );
      expect(imported.type).toBe('secret');
    });

    await it('should reject non-extractable key export', async () => {
      const key = await subtle.generateKey(
        { name: 'AES-CBC', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      ) as CryptoKey;
      let threw = false;
      try {
        await subtle.exportKey('raw', key);
      } catch (e) {
        threw = true;
      }
      expect(threw).toBe(true);
    });

    await it('should import raw PBKDF2 key', async () => {
      const password = new TextEncoder().encode('password');
      const key = await subtle.importKey(
        'raw',
        password,
        { name: 'PBKDF2' },
        false,
        ['deriveBits', 'deriveKey'],
      );
      expect(key.type).toBe('secret');
      expect(key.algorithm.name).toBe('PBKDF2');
      expect(key.extractable).toBe(false);
    });

    await it('should import raw HKDF key', async () => {
      const ikm = new TextEncoder().encode('input keying material');
      const key = await subtle.importKey(
        'raw',
        ikm,
        { name: 'HKDF' },
        false,
        ['deriveBits'],
      );
      expect(key.type).toBe('secret');
      expect(key.algorithm.name).toBe('HKDF');
    });
  });

  // ==================== encrypt / decrypt (AES) ====================

  await describe('SubtleCrypto.encrypt / decrypt (AES)', async () => {
    await it('should encrypt and decrypt with AES-CBC', async () => {
      const key = await subtle.generateKey(
        { name: 'AES-CBC', length: 256 },
        true,
        ['encrypt', 'decrypt'],
      ) as CryptoKey;

      const iv = crypto.getRandomValues(new Uint8Array(16));
      const plaintext = new TextEncoder().encode('Hello, WebCrypto!');

      const ciphertext = await subtle.encrypt(
        { name: 'AES-CBC', iv },
        key,
        plaintext,
      );
      expect(ciphertext.byteLength).toBeGreaterThan(0);

      const decrypted = await subtle.decrypt(
        { name: 'AES-CBC', iv },
        key,
        ciphertext,
      );
      const result = new TextDecoder().decode(decrypted);
      expect(result).toBe('Hello, WebCrypto!');
    });

    await it('should encrypt and decrypt with AES-GCM', async () => {
      const key = await subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt'],
      ) as CryptoKey;

      const iv = crypto.getRandomValues(new Uint8Array(12));
      const plaintext = new TextEncoder().encode('AES-GCM test');

      const ciphertext = await subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        plaintext,
      );
      // GCM adds 16-byte auth tag
      expect(ciphertext.byteLength).toBe(plaintext.length + 16);

      const decrypted = await subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        ciphertext,
      );
      expect(new TextDecoder().decode(decrypted)).toBe('AES-GCM test');
    });

    await it('should encrypt and decrypt with AES-CTR', async () => {
      const key = await subtle.generateKey(
        { name: 'AES-CTR', length: 128 },
        true,
        ['encrypt', 'decrypt'],
      ) as CryptoKey;

      const counter = crypto.getRandomValues(new Uint8Array(16));
      const plaintext = new TextEncoder().encode('CTR mode');

      const ciphertext = await subtle.encrypt(
        { name: 'AES-CTR', counter, length: 64 },
        key,
        plaintext,
      );
      expect(ciphertext.byteLength).toBe(plaintext.length);

      const decrypted = await subtle.decrypt(
        { name: 'AES-CTR', counter, length: 64 },
        key,
        ciphertext,
      );
      expect(new TextDecoder().decode(decrypted)).toBe('CTR mode');
    });

    await it('AES-GCM should support additionalData', async () => {
      const key = await subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt'],
      ) as CryptoKey;

      const iv = crypto.getRandomValues(new Uint8Array(12));
      const aad = new TextEncoder().encode('additional data');
      const plaintext = new TextEncoder().encode('authenticated');

      const ciphertext = await subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: aad },
        key,
        plaintext,
      );

      const decrypted = await subtle.decrypt(
        { name: 'AES-GCM', iv, additionalData: aad },
        key,
        ciphertext,
      );
      expect(new TextDecoder().decode(decrypted)).toBe('authenticated');
    });
  });

  // ==================== sign / verify (HMAC) ====================

  await describe('SubtleCrypto.sign / verify (HMAC)', async () => {
    await it('should sign and verify with HMAC SHA-256', async () => {
      const key = await subtle.generateKey(
        { name: 'HMAC', hash: 'SHA-256' },
        true,
        ['sign', 'verify'],
      ) as CryptoKey;

      const data = new TextEncoder().encode('message to sign');
      const signature = await subtle.sign('HMAC', key, data);
      expect(signature.byteLength).toBe(32); // SHA-256 = 32 bytes

      const valid = await subtle.verify('HMAC', key, signature, data);
      expect(valid).toBe(true);
    });

    await it('should reject wrong signature', async () => {
      const key = await subtle.generateKey(
        { name: 'HMAC', hash: 'SHA-256' },
        true,
        ['sign', 'verify'],
      ) as CryptoKey;

      const data = new TextEncoder().encode('message');
      const signature = await subtle.sign('HMAC', key, data);

      // Corrupt signature
      const badSig = new Uint8Array(signature);
      badSig[0] ^= 0xFF;

      const valid = await subtle.verify('HMAC', key, badSig, data);
      expect(valid).toBe(false);
    });

    await it('should reject wrong data', async () => {
      const key = await subtle.generateKey(
        { name: 'HMAC', hash: 'SHA-256' },
        true,
        ['sign', 'verify'],
      ) as CryptoKey;

      const data = new TextEncoder().encode('original');
      const signature = await subtle.sign('HMAC', key, data);

      const wrongData = new TextEncoder().encode('modified');
      const valid = await subtle.verify('HMAC', key, signature, wrongData);
      expect(valid).toBe(false);
    });

    await it('should sign with HMAC SHA-512', async () => {
      const key = await subtle.generateKey(
        { name: 'HMAC', hash: 'SHA-512' },
        true,
        ['sign', 'verify'],
      ) as CryptoKey;

      const data = new TextEncoder().encode('test');
      const signature = await subtle.sign('HMAC', key, data);
      expect(signature.byteLength).toBe(64); // SHA-512 = 64 bytes
    });
  });

  // ==================== deriveBits (PBKDF2) ====================

  await describe('SubtleCrypto.deriveBits (PBKDF2)', async () => {
    await it('should derive 256 bits with PBKDF2', async () => {
      const password = new TextEncoder().encode('password');
      const key = await subtle.importKey('raw', password, 'PBKDF2', false, ['deriveBits']);

      const salt = crypto.getRandomValues(new Uint8Array(16));
      const bits = await subtle.deriveBits(
        { name: 'PBKDF2', salt, iterations: 1000, hash: 'SHA-256' },
        key,
        256,
      );
      expect(bits.byteLength).toBe(32);
    });

    await it('should produce deterministic output', async () => {
      const password = new TextEncoder().encode('password');
      const salt = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);

      const key1 = await subtle.importKey('raw', password, 'PBKDF2', false, ['deriveBits']);
      const bits1 = await subtle.deriveBits(
        { name: 'PBKDF2', salt, iterations: 100, hash: 'SHA-256' },
        key1,
        256,
      );

      const key2 = await subtle.importKey('raw', password, 'PBKDF2', false, ['deriveBits']);
      const bits2 = await subtle.deriveBits(
        { name: 'PBKDF2', salt, iterations: 100, hash: 'SHA-256' },
        key2,
        256,
      );

      const a = new Uint8Array(bits1);
      const b = new Uint8Array(bits2);
      for (let i = 0; i < 32; i++) {
        expect(a[i]).toBe(b[i]);
      }
    });
  });

  // ==================== deriveBits (HKDF) ====================

  await describe('SubtleCrypto.deriveBits (HKDF)', async () => {
    await it('should derive 256 bits with HKDF', async () => {
      const ikm = new TextEncoder().encode('input keying material');
      const key = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);

      const salt = new Uint8Array(16);
      const info = new TextEncoder().encode('info');
      const bits = await subtle.deriveBits(
        { name: 'HKDF', salt, info, hash: 'SHA-256' },
        key,
        256,
      );
      expect(bits.byteLength).toBe(32);
    });
  });

  // ==================== deriveKey ====================

  await describe('SubtleCrypto.deriveKey', async () => {
    await it('should derive AES key from PBKDF2', async () => {
      const password = new TextEncoder().encode('password');
      const baseKey = await subtle.importKey('raw', password, 'PBKDF2', false, ['deriveKey']);

      const salt = crypto.getRandomValues(new Uint8Array(16));
      const derivedKey = await subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations: 1000, hash: 'SHA-256' },
        baseKey,
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt'],
      );

      expect(derivedKey.type).toBe('secret');
      expect(derivedKey.algorithm.name).toBe('AES-GCM');
      expect((derivedKey.algorithm as any).length).toBe(256);

      // Verify derived key works for encryption
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, derivedKey, new TextEncoder().encode('test'));
      const pt = await subtle.decrypt({ name: 'AES-GCM', iv }, derivedKey, ct);
      expect(new TextDecoder().decode(pt)).toBe('test');
    });
  });

  // ==================== generateKey / deriveBits (ECDH) ====================

  await describe('SubtleCrypto ECDH', async () => {
    await it('should generate ECDH P-256 key pair', async () => {
      const keyPair = await subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        ['deriveBits'],
      ) as CryptoKeyPair;

      expect(keyPair.publicKey.type).toBe('public');
      expect(keyPair.privateKey.type).toBe('private');
      expect(keyPair.publicKey.algorithm.name).toBe('ECDH');
      expect((keyPair.publicKey.algorithm as any).namedCurve).toBe('P-256');
    });

    await it('should derive shared secret between two key pairs', async () => {
      const keyPairA = await subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        ['deriveBits'],
      ) as CryptoKeyPair;

      const keyPairB = await subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        ['deriveBits'],
      ) as CryptoKeyPair;

      const secretA = await subtle.deriveBits(
        { name: 'ECDH', public: keyPairB.publicKey },
        keyPairA.privateKey,
        256,
      );

      const secretB = await subtle.deriveBits(
        { name: 'ECDH', public: keyPairA.publicKey },
        keyPairB.privateKey,
        256,
      );

      const a = new Uint8Array(secretA);
      const b = new Uint8Array(secretB);
      expect(a.length).toBe(32);
      for (let i = 0; i < a.length; i++) {
        expect(a[i]).toBe(b[i]);
      }
    });

    await it('should export and import ECDH JWK key', async () => {
      const keyPair = await subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        ['deriveBits'],
      ) as CryptoKeyPair;

      const pubJwk = await subtle.exportKey('jwk', keyPair.publicKey) as JsonWebKey;
      expect(pubJwk.kty).toBe('EC');
      expect(pubJwk.crv).toBe('P-256');
      expect(pubJwk.x).toBeDefined();
      expect(pubJwk.y).toBeDefined();

      // Re-import
      const imported = await subtle.importKey(
        'jwk',
        pubJwk,
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        [],
      );
      expect(imported.type).toBe('public');
    });
  });

  // ==================== CryptoKey ====================

  await describe('CryptoKey', async () => {
    await it('should have correct properties', async () => {
      const key = await subtle.generateKey(
        { name: 'AES-CBC', length: 256 },
        true,
        ['encrypt', 'decrypt'],
      ) as CryptoKey;
      expect(key.type).toBe('secret');
      expect(key.extractable).toBe(true);
      expect(key.algorithm).toBeDefined();
      expect(key.usages).toBeDefined();
    });

    await it('should have immutable algorithm and usages', async () => {
      const key = await subtle.generateKey(
        { name: 'AES-CBC', length: 256 },
        true,
        ['encrypt'],
      ) as CryptoKey;
      expect(key.algorithm.name).toBe('AES-CBC');
      expect(key.usages.length).toBe(1);
      expect(key.usages[0]).toBe('encrypt');
    });

    await it('should reject wrong key usage', async () => {
      const key = await subtle.generateKey(
        { name: 'AES-CBC', length: 256 },
        true,
        ['encrypt'],
      ) as CryptoKey;
      let threw = false;
      try {
        const iv = crypto.getRandomValues(new Uint8Array(16));
        await subtle.decrypt({ name: 'AES-CBC', iv }, key, new Uint8Array(32));
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });
  });

  // ==================== sign / verify (ECDSA) ====================

  await describe('SubtleCrypto ECDSA', async () => {
    await it('should generate ECDSA P-256 key pair', async () => {
      const keyPair = await subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['sign', 'verify'],
      ) as CryptoKeyPair;

      expect(keyPair.publicKey.type).toBe('public');
      expect(keyPair.privateKey.type).toBe('private');
      expect(keyPair.publicKey.algorithm.name).toBe('ECDSA');
      expect((keyPair.publicKey.algorithm as any).namedCurve).toBe('P-256');
    });

    await it('should sign and verify with ECDSA P-256 SHA-256', async () => {
      const keyPair = await subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['sign', 'verify'],
      ) as CryptoKeyPair;

      const data = new TextEncoder().encode('ECDSA test message');
      const signature = await subtle.sign(
        { name: 'ECDSA', hash: { name: 'SHA-256' } },
        keyPair.privateKey,
        data,
      );

      // P-256 signature = 64 bytes (32 bytes r + 32 bytes s)
      expect(signature.byteLength).toBe(64);

      const valid = await subtle.verify(
        { name: 'ECDSA', hash: { name: 'SHA-256' } },
        keyPair.publicKey,
        signature,
        data,
      );
      expect(valid).toBe(true);
    });

    await it('should reject corrupted ECDSA signature', async () => {
      const keyPair = await subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['sign', 'verify'],
      ) as CryptoKeyPair;

      const data = new TextEncoder().encode('test');
      const signature = await subtle.sign(
        { name: 'ECDSA', hash: { name: 'SHA-256' } },
        keyPair.privateKey,
        data,
      );

      const badSig = new Uint8Array(signature);
      badSig[0] ^= 0xFF;
      const valid = await subtle.verify(
        { name: 'ECDSA', hash: { name: 'SHA-256' } },
        keyPair.publicKey,
        badSig,
        data,
      );
      expect(valid).toBe(false);
    });

    await it('should reject wrong data in ECDSA verify', async () => {
      const keyPair = await subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['sign', 'verify'],
      ) as CryptoKeyPair;

      const data = new TextEncoder().encode('original');
      const signature = await subtle.sign(
        { name: 'ECDSA', hash: { name: 'SHA-256' } },
        keyPair.privateKey,
        data,
      );

      const wrongData = new TextEncoder().encode('modified');
      const valid = await subtle.verify(
        { name: 'ECDSA', hash: { name: 'SHA-256' } },
        keyPair.publicKey,
        signature,
        wrongData,
      );
      expect(valid).toBe(false);
    });

    await it('should sign different messages with different signatures', async () => {
      const keyPair = await subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['sign', 'verify'],
      ) as CryptoKeyPair;

      const sig1 = await subtle.sign(
        { name: 'ECDSA', hash: { name: 'SHA-256' } },
        keyPair.privateKey,
        new TextEncoder().encode('message A'),
      );
      const sig2 = await subtle.sign(
        { name: 'ECDSA', hash: { name: 'SHA-256' } },
        keyPair.privateKey,
        new TextEncoder().encode('message B'),
      );

      // Different messages should produce different signatures
      const a = new Uint8Array(sig1);
      const b = new Uint8Array(sig2);
      let same = true;
      for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) { same = false; break; }
      }
      expect(same).toBe(false);
    });

    await it('should sign and verify with ECDSA P-384', async () => {
      const keyPair = await subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-384' },
        true,
        ['sign', 'verify'],
      ) as CryptoKeyPair;

      const data = new TextEncoder().encode('P-384 test');
      const signature = await subtle.sign(
        { name: 'ECDSA', hash: { name: 'SHA-384' } },
        keyPair.privateKey,
        data,
      );

      // P-384 signature = 96 bytes (48 bytes r + 48 bytes s)
      expect(signature.byteLength).toBe(96);

      const valid = await subtle.verify(
        { name: 'ECDSA', hash: { name: 'SHA-384' } },
        keyPair.publicKey,
        signature,
        data,
      );
      expect(valid).toBe(true);
    });
  });

  // ==================== getRandomValues / randomUUID ====================

  await describe('crypto global', async () => {
    await it('getRandomValues should fill array', async () => {
      const arr = new Uint8Array(32);
      const result = crypto.getRandomValues(arr);
      expect(result).toBe(arr);
      // Should not be all zeros (extremely unlikely)
      let allZero = true;
      for (let i = 0; i < arr.length; i++) {
        if (arr[i] !== 0) { allZero = false; break; }
      }
      expect(allZero).toBe(false);
    });

    await it('randomUUID should return valid UUID v4', async () => {
      const uuid = crypto.randomUUID();
      expect(typeof uuid).toBe('string');
      expect(uuid.length).toBe(36);
      // Check format: 8-4-4-4-12
      const parts = uuid.split('-');
      expect(parts.length).toBe(5);
      expect(parts[0].length).toBe(8);
      expect(parts[1].length).toBe(4);
      expect(parts[2].length).toBe(4);
      expect(parts[3].length).toBe(4);
      expect(parts[4].length).toBe(12);
    });
  });
};
