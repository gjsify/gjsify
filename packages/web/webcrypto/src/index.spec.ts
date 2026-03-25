// Tests for W3C WebCrypto API
// Ported from refs/deno/tests/unit/webcrypto_test.ts, refs/wpt/WebCryptoAPI/,
// and refs/node-test/parallel/test-webcrypto-*.js
// Original: MIT license (Deno), 3-Clause BSD license (WPT), MIT license (Node.js contributors)

import { describe, it, expect } from '@gjsify/unit';

export default async () => {

  // Use global crypto (native on Node.js, polyfill on GJS)
  const subtle = globalThis.crypto.subtle;

  // ==================== getRandomValues ====================

  await describe('crypto.getRandomValues', async () => {
    await it('should fill Uint8Array', async () => {
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

    await it('should fill Int8Array', async () => {
      const arr = new Int8Array(10);
      const result = crypto.getRandomValues(arr);
      expect(result).toBe(arr);
    });

    await it('should fill Int16Array', async () => {
      const arr = new Int16Array(10);
      const result = crypto.getRandomValues(arr);
      expect(result).toBe(arr);
    });

    await it('should fill Int32Array', async () => {
      const arr = new Int32Array(10);
      const result = crypto.getRandomValues(arr);
      expect(result).toBe(arr);
    });

    await it('should fill Uint16Array', async () => {
      const arr = new Uint16Array(10);
      const result = crypto.getRandomValues(arr);
      expect(result).toBe(arr);
    });

    await it('should fill Uint32Array', async () => {
      const arr = new Uint32Array(10);
      const result = crypto.getRandomValues(arr);
      expect(result).toBe(arr);
    });

    await it('should fill Uint8ClampedArray', async () => {
      const arr = new Uint8ClampedArray(10);
      const result = crypto.getRandomValues(arr);
      expect(result).toBe(arr);
    });

    await it('should fill BigInt64Array', async () => {
      const arr = new BigInt64Array(4);
      const result = crypto.getRandomValues(arr);
      expect(result).toBe(arr);
    });

    await it('should fill BigUint64Array', async () => {
      const arr = new BigUint64Array(4);
      const result = crypto.getRandomValues(arr);
      expect(result).toBe(arr);
    });

    await it('should accept zero-length array', async () => {
      const arr = new Uint8Array(0);
      const result = crypto.getRandomValues(arr);
      expect(result).toBe(arr);
      expect(arr.length).toBe(0);
    });

    await it('should produce non-zero data for various typed arrays', async () => {
      // Each integer typed array should get random data (not all zeros)
      const constructors = [
        Int8Array, Int16Array, Int32Array,
        Uint8Array, Uint16Array, Uint32Array,
        Uint8ClampedArray,
      ] as const;
      for (const Ctor of constructors) {
        const buf = new Ctor(10);
        crypto.getRandomValues(buf);
        let hasNonZero = false;
        for (let i = 0; i < buf.length; i++) {
          if (buf[i] !== 0) { hasNonZero = true; break; }
        }
        expect(hasNonZero).toBe(true);
      }
    });

    await it('should throw for Float32Array', async () => {
      let threw = false;
      try {
        crypto.getRandomValues(new Float32Array(1) as unknown as Uint8Array);
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });

    await it('should throw for Float64Array', async () => {
      let threw = false;
      try {
        crypto.getRandomValues(new Float64Array(1) as unknown as Uint8Array);
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });

    await it('should throw for DataView', async () => {
      let threw = false;
      try {
        crypto.getRandomValues(new DataView(new ArrayBuffer(1)) as unknown as Uint8Array);
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });

    await it('should throw when byte length exceeds 65536', async () => {
      let threw = false;
      try {
        // 65537 bytes exceeds quota
        crypto.getRandomValues(new Uint8Array(65537));
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });

    await it('should accept exactly 65536 bytes', async () => {
      const arr = new Uint8Array(65536);
      const result = crypto.getRandomValues(arr);
      expect(result).toBe(arr);
    });

    await it('should return the same typed array reference', async () => {
      const arr = new Uint32Array(8);
      const returned = crypto.getRandomValues(arr);
      expect(returned).toBe(arr);
    });
  });

  // ==================== randomUUID ====================

  await describe('crypto.randomUUID', async () => {
    await it('should return valid UUID v4 format', async () => {
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

    await it('should contain only hex characters and dashes', async () => {
      const uuid = crypto.randomUUID();
      expect(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uuid)).toBe(true);
    });

    await it('should have version 4 indicator', async () => {
      const uuid = crypto.randomUUID();
      // The 13th character (index 14) should be '4' (version 4)
      expect(uuid[14]).toBe('4');
    });

    await it('should have correct variant bits', async () => {
      const uuid = crypto.randomUUID();
      // The 17th character (index 19) should be one of 8, 9, a, b
      expect(['8', '9', 'a', 'b'].indexOf(uuid[19]) >= 0).toBe(true);
    });

    await it('should produce unique UUIDs', async () => {
      const set = new Set<string>();
      for (let i = 0; i < 100; i++) {
        set.add(crypto.randomUUID());
      }
      expect(set.size).toBe(100);
    });
  });

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
      // SHA-256 of empty string: e3b0c44298fc1c14...
      const bytes = new Uint8Array(hash);
      expect(bytes[0]).toBe(0xe3);
      expect(bytes[1]).toBe(0xb0);
    });

    await it('should produce known SHA-1 digest', async () => {
      // SHA-1('') = da39a3ee5e6b4b0d3255bfef95601890afd80709
      const hash = await subtle.digest('SHA-1', new Uint8Array(0));
      const bytes = new Uint8Array(hash);
      expect(bytes[0]).toBe(0xda);
      expect(bytes[1]).toBe(0x39);
      expect(bytes[2]).toBe(0xa3);
    });

    await it('should produce known SHA-384 digest of empty', async () => {
      // SHA-384('') starts with 38b060a751ac9638...
      const hash = await subtle.digest('SHA-384', new Uint8Array(0));
      const bytes = new Uint8Array(hash);
      expect(bytes[0]).toBe(0x38);
      expect(bytes[1]).toBe(0xb0);
    });

    await it('should produce known SHA-512 digest of empty', async () => {
      // SHA-512('') starts with cf83e1357eefb8bd...
      const hash = await subtle.digest('SHA-512', new Uint8Array(0));
      const bytes = new Uint8Array(hash);
      expect(bytes[0]).toBe(0xcf);
      expect(bytes[1]).toBe(0x83);
    });

    await it('should accept ArrayBuffer as input', async () => {
      const data = new TextEncoder().encode('hello');
      const hash = await subtle.digest('SHA-256', data.buffer);
      expect(hash.byteLength).toBe(32);
      const bytes = new Uint8Array(hash);
      expect(bytes[0]).toBe(0x2c);
    });

    await it('should accept DataView as input', async () => {
      const data = new TextEncoder().encode('hello');
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const hash = await subtle.digest('SHA-256', dv);
      expect(hash.byteLength).toBe(32);
      const bytes = new Uint8Array(hash);
      expect(bytes[0]).toBe(0x2c);
    });

    await it('should produce consistent results for same input', async () => {
      const data = new TextEncoder().encode('consistent');
      const h1 = await subtle.digest('SHA-256', data);
      const h2 = await subtle.digest('SHA-256', data);
      const a = new Uint8Array(h1);
      const b = new Uint8Array(h2);
      for (let i = 0; i < a.length; i++) {
        expect(a[i]).toBe(b[i]);
      }
    });

    await it('should handle moderately large input', async () => {
      // 64KB of data
      const data = new Uint8Array(65536);
      for (let i = 0; i < data.length; i++) data[i] = i & 0xff;
      const hash = await subtle.digest('SHA-256', data);
      expect(hash.byteLength).toBe(32);
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

    await it('should generate AES-GCM 256 key', async () => {
      const key = await subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt'],
      ) as CryptoKey;
      expect(key.type).toBe('secret');
      expect(key.algorithm.name).toBe('AES-GCM');
      expect((key.algorithm as any).length).toBe(256);
    });

    await it('should generate AES-CBC 128 key', async () => {
      const key = await subtle.generateKey(
        { name: 'AES-CBC', length: 128 },
        true,
        ['encrypt', 'decrypt'],
      ) as CryptoKey;
      expect(key.type).toBe('secret');
      expect((key.algorithm as any).length).toBe(128);
    });

    await it('should generate non-extractable key', async () => {
      const key = await subtle.generateKey(
        { name: 'AES-CBC', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      ) as CryptoKey;
      expect(key.extractable).toBe(false);
    });

    await it('should produce unique keys each time', async () => {
      const key1 = await subtle.generateKey(
        { name: 'AES-CBC', length: 256 }, true, ['encrypt', 'decrypt'],
      ) as CryptoKey;
      const key2 = await subtle.generateKey(
        { name: 'AES-CBC', length: 256 }, true, ['encrypt', 'decrypt'],
      ) as CryptoKey;
      const raw1 = new Uint8Array(await subtle.exportKey('raw', key1) as ArrayBuffer);
      const raw2 = new Uint8Array(await subtle.exportKey('raw', key2) as ArrayBuffer);
      let same = true;
      for (let i = 0; i < raw1.length; i++) {
        if (raw1[i] !== raw2[i]) { same = false; break; }
      }
      expect(same).toBe(false);
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

    await it('should generate HMAC key with SHA-1', async () => {
      const key = await subtle.generateKey(
        { name: 'HMAC', hash: 'SHA-1' },
        true,
        ['sign', 'verify'],
      ) as CryptoKey;
      expect(key.type).toBe('secret');
      expect((key.algorithm as any).hash.name).toBe('SHA-1');
    });

    await it('should generate HMAC key with SHA-384', async () => {
      const key = await subtle.generateKey(
        { name: 'HMAC', hash: 'SHA-384' },
        true,
        ['sign', 'verify'],
      ) as CryptoKey;
      expect(key.type).toBe('secret');
      expect((key.algorithm as any).hash.name).toBe('SHA-384');
    });

    await it('should generate HMAC key with SHA-512', async () => {
      const key = await subtle.generateKey(
        { name: 'HMAC', hash: 'SHA-512' },
        true,
        ['sign', 'verify'],
      ) as CryptoKey;
      expect(key.type).toBe('secret');
      expect((key.algorithm as any).hash.name).toBe('SHA-512');
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

    await it('should import raw AES-128 key', async () => {
      const rawKey = crypto.getRandomValues(new Uint8Array(16));
      const key = await subtle.importKey(
        'raw', rawKey, { name: 'AES-CBC' }, true, ['encrypt', 'decrypt'],
      );
      expect(key.type).toBe('secret');
      expect((key.algorithm as any).length).toBe(128);
    });

    await it('should import raw AES-192 key', async () => {
      const rawKey = crypto.getRandomValues(new Uint8Array(24));
      const key = await subtle.importKey(
        'raw', rawKey, { name: 'AES-CBC' }, true, ['encrypt', 'decrypt'],
      );
      expect(key.type).toBe('secret');
      expect((key.algorithm as any).length).toBe(192);
    });

    await it('should import and export JWK HMAC key', async () => {
      const key = await subtle.generateKey(
        { name: 'HMAC', hash: 'SHA-256' },
        true,
        ['sign', 'verify'],
      ) as CryptoKey;

      const jwk = await subtle.exportKey('jwk', key) as JsonWebKey;
      expect(jwk.kty).toBe('oct');
      expect(jwk.k).toBeDefined();
      expect(jwk.alg).toBe('HS256');

      const imported = await subtle.importKey(
        'jwk', jwk, { name: 'HMAC', hash: 'SHA-256' }, true, ['sign', 'verify'],
      );
      expect(imported.type).toBe('secret');
      expect(imported.algorithm.name).toBe('HMAC');
    });

    await it('should import and export JWK AES-CBC key', async () => {
      const key = await subtle.generateKey(
        { name: 'AES-CBC', length: 256 },
        true,
        ['encrypt', 'decrypt'],
      ) as CryptoKey;

      const jwk = await subtle.exportKey('jwk', key) as JsonWebKey;
      expect(jwk.kty).toBe('oct');
      expect(jwk.alg).toBe('A256CBC');

      const imported = await subtle.importKey(
        'jwk', jwk, { name: 'AES-CBC' }, true, ['encrypt', 'decrypt'],
      );
      expect(imported.type).toBe('secret');
      expect(imported.algorithm.name).toBe('AES-CBC');
    });

    await it('should export ECDSA public key as raw', async () => {
      const keyPair = await subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['sign', 'verify'],
      ) as CryptoKeyPair;

      const raw = await subtle.exportKey('raw', keyPair.publicKey) as ArrayBuffer;
      // Uncompressed EC P-256 public key: 1 + 32 + 32 = 65 bytes
      expect(raw.byteLength).toBe(65);
      // First byte should be 0x04 (uncompressed point)
      expect(new Uint8Array(raw)[0]).toBe(0x04);
    });

    await it('should round-trip ECDSA JWK private key', async () => {
      const keyPair = await subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['sign', 'verify'],
      ) as CryptoKeyPair;

      const privJwk = await subtle.exportKey('jwk', keyPair.privateKey) as JsonWebKey;
      expect(privJwk.kty).toBe('EC');
      expect(privJwk.crv).toBe('P-256');
      expect(privJwk.d).toBeDefined();
      expect(privJwk.x).toBeDefined();
      expect(privJwk.y).toBeDefined();

      const imported = await subtle.importKey(
        'jwk', privJwk, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign'],
      );
      expect(imported.type).toBe('private');

      // Verify the imported key can sign
      const data = new TextEncoder().encode('round-trip test');
      const sig = await subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        imported,
        data,
      );
      expect(sig.byteLength).toBe(64);
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

    await it('AES-CBC 128-bit key round-trip', async () => {
      const key = await subtle.generateKey(
        { name: 'AES-CBC', length: 128 },
        true,
        ['encrypt', 'decrypt'],
      ) as CryptoKey;
      const iv = crypto.getRandomValues(new Uint8Array(16));
      const pt = new TextEncoder().encode('128-bit key test');
      const ct = await subtle.encrypt({ name: 'AES-CBC', iv }, key, pt);
      const dec = await subtle.decrypt({ name: 'AES-CBC', iv }, key, ct);
      expect(new TextDecoder().decode(dec)).toBe('128-bit key test');
    });

    await it('AES-CBC 192-bit key round-trip', async () => {
      const key = await subtle.generateKey(
        { name: 'AES-CBC', length: 192 },
        true,
        ['encrypt', 'decrypt'],
      ) as CryptoKey;
      const iv = crypto.getRandomValues(new Uint8Array(16));
      const pt = new TextEncoder().encode('192-bit key test');
      const ct = await subtle.encrypt({ name: 'AES-CBC', iv }, key, pt);
      const dec = await subtle.decrypt({ name: 'AES-CBC', iv }, key, ct);
      expect(new TextDecoder().decode(dec)).toBe('192-bit key test');
    });

    await it('AES-GCM 128-bit key round-trip', async () => {
      const key = await subtle.generateKey(
        { name: 'AES-GCM', length: 128 },
        true,
        ['encrypt', 'decrypt'],
      ) as CryptoKey;
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const pt = new TextEncoder().encode('GCM-128');
      const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, pt);
      expect(ct.byteLength).toBe(pt.length + 16);
      const dec = await subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
      expect(new TextDecoder().decode(dec)).toBe('GCM-128');
    });

    await it('AES-CTR 256-bit key round-trip', async () => {
      const key = await subtle.generateKey(
        { name: 'AES-CTR', length: 256 },
        true,
        ['encrypt', 'decrypt'],
      ) as CryptoKey;
      const counter = crypto.getRandomValues(new Uint8Array(16));
      const pt = new TextEncoder().encode('CTR-256 mode test data');
      const ct = await subtle.encrypt({ name: 'AES-CTR', counter, length: 64 }, key, pt);
      expect(ct.byteLength).toBe(pt.length);
      const dec = await subtle.decrypt({ name: 'AES-CTR', counter, length: 64 }, key, ct);
      expect(new TextDecoder().decode(dec)).toBe('CTR-256 mode test data');
    });

    await it('AES-GCM should fail with tampered ciphertext', async () => {
      const key = await subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt'],
      ) as CryptoKey;
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const pt = new TextEncoder().encode('tamper test');
      const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, pt);

      // Corrupt the ciphertext
      const tampered = new Uint8Array(ct);
      tampered[0] ^= 0xff;

      let threw = false;
      try {
        await subtle.decrypt({ name: 'AES-GCM', iv }, key, tampered);
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });

    await it('AES-GCM wrong AAD should fail decryption', async () => {
      const key = await subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt'],
      ) as CryptoKey;
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const aad = new TextEncoder().encode('correct aad');
      const wrongAad = new TextEncoder().encode('wrong aad');
      const pt = new TextEncoder().encode('aad check');
      const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, pt);

      let threw = false;
      try {
        await subtle.decrypt({ name: 'AES-GCM', iv, additionalData: wrongAad }, key, ct);
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });

    await it('AES-CBC should encrypt empty data', async () => {
      const key = await subtle.generateKey(
        { name: 'AES-CBC', length: 256 },
        true,
        ['encrypt', 'decrypt'],
      ) as CryptoKey;
      const iv = crypto.getRandomValues(new Uint8Array(16));
      const pt = new Uint8Array(0);
      const ct = await subtle.encrypt({ name: 'AES-CBC', iv }, key, pt);
      // CBC with empty input produces one block of padding (16 bytes)
      expect(ct.byteLength).toBe(16);
      const dec = await subtle.decrypt({ name: 'AES-CBC', iv }, key, ct);
      expect(dec.byteLength).toBe(0);
    });

    await it('AES-CTR should encrypt empty data', async () => {
      const key = await subtle.generateKey(
        { name: 'AES-CTR', length: 256 },
        true,
        ['encrypt', 'decrypt'],
      ) as CryptoKey;
      const counter = crypto.getRandomValues(new Uint8Array(16));
      const pt = new Uint8Array(0);
      const ct = await subtle.encrypt({ name: 'AES-CTR', counter, length: 64 }, key, pt);
      expect(ct.byteLength).toBe(0);
      const dec = await subtle.decrypt({ name: 'AES-CTR', counter, length: 64 }, key, ct);
      expect(dec.byteLength).toBe(0);
    });

    await it('AES-GCM should encrypt empty data', async () => {
      const key = await subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt'],
      ) as CryptoKey;
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const pt = new Uint8Array(0);
      const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, pt);
      // GCM with empty input = 16-byte auth tag only
      expect(ct.byteLength).toBe(16);
      const dec = await subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
      expect(dec.byteLength).toBe(0);
    });

    await it('different keys should produce different ciphertext', async () => {
      const key1 = await subtle.generateKey(
        { name: 'AES-CBC', length: 256 }, true, ['encrypt', 'decrypt'],
      ) as CryptoKey;
      const key2 = await subtle.generateKey(
        { name: 'AES-CBC', length: 256 }, true, ['encrypt', 'decrypt'],
      ) as CryptoKey;
      const iv = crypto.getRandomValues(new Uint8Array(16));
      const pt = new TextEncoder().encode('same plaintext');
      const ct1 = new Uint8Array(await subtle.encrypt({ name: 'AES-CBC', iv }, key1, pt));
      const ct2 = new Uint8Array(await subtle.encrypt({ name: 'AES-CBC', iv }, key2, pt));
      let same = true;
      for (let i = 0; i < ct1.length; i++) {
        if (ct1[i] !== ct2[i]) { same = false; break; }
      }
      expect(same).toBe(false);
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

    await it('should sign and verify with HMAC SHA-1', async () => {
      const key = await subtle.generateKey(
        { name: 'HMAC', hash: 'SHA-1' },
        true,
        ['sign', 'verify'],
      ) as CryptoKey;

      const data = new TextEncoder().encode('SHA-1 HMAC test');
      const sig = await subtle.sign('HMAC', key, data);
      expect(sig.byteLength).toBe(20); // SHA-1 = 20 bytes
      const valid = await subtle.verify('HMAC', key, sig, data);
      expect(valid).toBe(true);
    });

    await it('should sign and verify with HMAC SHA-384', async () => {
      const key = await subtle.generateKey(
        { name: 'HMAC', hash: 'SHA-384' },
        true,
        ['sign', 'verify'],
      ) as CryptoKey;

      const data = new TextEncoder().encode('SHA-384 HMAC test');
      const sig = await subtle.sign('HMAC', key, data);
      expect(sig.byteLength).toBe(48); // SHA-384 = 48 bytes
      const valid = await subtle.verify('HMAC', key, sig, data);
      expect(valid).toBe(true);
    });

    await it('HMAC SHA-512 sign and verify', async () => {
      const key = await subtle.generateKey(
        { name: 'HMAC', hash: 'SHA-512' },
        true,
        ['sign', 'verify'],
      ) as CryptoKey;

      const data = new TextEncoder().encode('SHA-512 verify test');
      const sig = await subtle.sign('HMAC', key, data);
      expect(sig.byteLength).toBe(64);
      const valid = await subtle.verify('HMAC', key, sig, data);
      expect(valid).toBe(true);
    });

    await it('should sign empty data with HMAC', async () => {
      const key = await subtle.generateKey(
        { name: 'HMAC', hash: 'SHA-256' },
        true,
        ['sign', 'verify'],
      ) as CryptoKey;

      const data = new Uint8Array(0);
      const sig = await subtle.sign('HMAC', key, data);
      expect(sig.byteLength).toBe(32);
      const valid = await subtle.verify('HMAC', key, sig, data);
      expect(valid).toBe(true);
    });

    await it('should produce deterministic HMAC signatures', async () => {
      const key = await subtle.generateKey(
        { name: 'HMAC', hash: 'SHA-256' },
        true,
        ['sign', 'verify'],
      ) as CryptoKey;

      const data = new TextEncoder().encode('deterministic');
      const sig1 = new Uint8Array(await subtle.sign('HMAC', key, data));
      const sig2 = new Uint8Array(await subtle.sign('HMAC', key, data));
      for (let i = 0; i < sig1.length; i++) {
        expect(sig1[i]).toBe(sig2[i]);
      }
    });

    await it('should produce different signatures with different keys', async () => {
      const key1 = await subtle.generateKey(
        { name: 'HMAC', hash: 'SHA-256' }, true, ['sign', 'verify'],
      ) as CryptoKey;
      const key2 = await subtle.generateKey(
        { name: 'HMAC', hash: 'SHA-256' }, true, ['sign', 'verify'],
      ) as CryptoKey;

      const data = new TextEncoder().encode('same data');
      const sig1 = new Uint8Array(await subtle.sign('HMAC', key1, data));
      const sig2 = new Uint8Array(await subtle.sign('HMAC', key2, data));
      let same = true;
      for (let i = 0; i < sig1.length; i++) {
        if (sig1[i] !== sig2[i]) { same = false; break; }
      }
      expect(same).toBe(false);
    });

    await it('should reject truncated signature', async () => {
      const key = await subtle.generateKey(
        { name: 'HMAC', hash: 'SHA-256' },
        true,
        ['sign', 'verify'],
      ) as CryptoKey;

      const data = new TextEncoder().encode('truncation test');
      const sig = await subtle.sign('HMAC', key, data);
      // Truncated signature (only half)
      const truncated = new Uint8Array(sig).slice(0, 16);
      const valid = await subtle.verify('HMAC', key, truncated, data);
      expect(valid).toBe(false);
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

    await it('should derive 128 bits with PBKDF2', async () => {
      const password = new TextEncoder().encode('short');
      const key = await subtle.importKey('raw', password, 'PBKDF2', false, ['deriveBits']);
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const bits = await subtle.deriveBits(
        { name: 'PBKDF2', salt, iterations: 1000, hash: 'SHA-256' },
        key,
        128,
      );
      expect(bits.byteLength).toBe(16);
    });

    await it('should derive 512 bits with PBKDF2', async () => {
      const password = new TextEncoder().encode('long-password');
      const key = await subtle.importKey('raw', password, 'PBKDF2', false, ['deriveBits']);
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const bits = await subtle.deriveBits(
        { name: 'PBKDF2', salt, iterations: 1000, hash: 'SHA-512' },
        key,
        512,
      );
      expect(bits.byteLength).toBe(64);
    });

    await it('different passwords produce different output', async () => {
      const salt = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
      const params = { name: 'PBKDF2', salt, iterations: 100, hash: 'SHA-256' } as const;

      const key1 = await subtle.importKey('raw', new TextEncoder().encode('pass1'), 'PBKDF2', false, ['deriveBits']);
      const key2 = await subtle.importKey('raw', new TextEncoder().encode('pass2'), 'PBKDF2', false, ['deriveBits']);
      const bits1 = new Uint8Array(await subtle.deriveBits(params, key1, 256));
      const bits2 = new Uint8Array(await subtle.deriveBits(params, key2, 256));
      let same = true;
      for (let i = 0; i < bits1.length; i++) {
        if (bits1[i] !== bits2[i]) { same = false; break; }
      }
      expect(same).toBe(false);
    });

    await it('different salts produce different output', async () => {
      const password = new TextEncoder().encode('password');
      const salt1 = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
      const salt2 = new Uint8Array([16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);

      const key1 = await subtle.importKey('raw', password, 'PBKDF2', false, ['deriveBits']);
      const key2 = await subtle.importKey('raw', password, 'PBKDF2', false, ['deriveBits']);
      const bits1 = new Uint8Array(await subtle.deriveBits(
        { name: 'PBKDF2', salt: salt1, iterations: 100, hash: 'SHA-256' }, key1, 256,
      ));
      const bits2 = new Uint8Array(await subtle.deriveBits(
        { name: 'PBKDF2', salt: salt2, iterations: 100, hash: 'SHA-256' }, key2, 256,
      ));
      let same = true;
      for (let i = 0; i < bits1.length; i++) {
        if (bits1[i] !== bits2[i]) { same = false; break; }
      }
      expect(same).toBe(false);
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

    await it('should derive 128 bits with HKDF', async () => {
      const ikm = new TextEncoder().encode('ikm');
      const key = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
      const bits = await subtle.deriveBits(
        { name: 'HKDF', salt: new Uint8Array(16), info: new Uint8Array(0), hash: 'SHA-256' },
        key,
        128,
      );
      expect(bits.byteLength).toBe(16);
    });

    await it('should produce deterministic HKDF output', async () => {
      const ikm = new TextEncoder().encode('deterministic ikm');
      const salt = new Uint8Array([10, 20, 30, 40]);
      const info = new TextEncoder().encode('deterministic info');

      const key1 = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
      const key2 = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
      const bits1 = new Uint8Array(await subtle.deriveBits(
        { name: 'HKDF', salt, info, hash: 'SHA-256' }, key1, 256,
      ));
      const bits2 = new Uint8Array(await subtle.deriveBits(
        { name: 'HKDF', salt, info, hash: 'SHA-256' }, key2, 256,
      ));
      for (let i = 0; i < bits1.length; i++) {
        expect(bits1[i]).toBe(bits2[i]);
      }
    });

    await it('different info produces different output', async () => {
      const ikm = new TextEncoder().encode('ikm');
      const salt = new Uint8Array(16);

      const key1 = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
      const key2 = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
      const bits1 = new Uint8Array(await subtle.deriveBits(
        { name: 'HKDF', salt, info: new TextEncoder().encode('info1'), hash: 'SHA-256' }, key1, 256,
      ));
      const bits2 = new Uint8Array(await subtle.deriveBits(
        { name: 'HKDF', salt, info: new TextEncoder().encode('info2'), hash: 'SHA-256' }, key2, 256,
      ));
      let same = true;
      for (let i = 0; i < bits1.length; i++) {
        if (bits1[i] !== bits2[i]) { same = false; break; }
      }
      expect(same).toBe(false);
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

    await it('should derive AES-CBC key from PBKDF2', async () => {
      const password = new TextEncoder().encode('cbc-password');
      const baseKey = await subtle.importKey('raw', password, 'PBKDF2', false, ['deriveKey']);
      const salt = crypto.getRandomValues(new Uint8Array(16));

      const derivedKey = await subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations: 1000, hash: 'SHA-256' },
        baseKey,
        { name: 'AES-CBC', length: 128 },
        true,
        ['encrypt', 'decrypt'],
      );
      expect(derivedKey.type).toBe('secret');
      expect(derivedKey.algorithm.name).toBe('AES-CBC');
      expect((derivedKey.algorithm as any).length).toBe(128);
    });

    await it('should derive HMAC key from HKDF', async () => {
      const ikm = new TextEncoder().encode('input keying material');
      const baseKey = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey']);

      const derivedKey = await subtle.deriveKey(
        { name: 'HKDF', salt: new Uint8Array(16), info: new TextEncoder().encode('hmac-info'), hash: 'SHA-256' },
        baseKey,
        { name: 'HMAC', hash: 'SHA-256' },
        true,
        ['sign', 'verify'],
      );
      expect(derivedKey.type).toBe('secret');
      expect(derivedKey.algorithm.name).toBe('HMAC');

      // Verify derived key works for signing
      const data = new TextEncoder().encode('derived hmac test');
      const sig = await subtle.sign('HMAC', derivedKey, data);
      expect(sig.byteLength).toBe(32);
      const valid = await subtle.verify('HMAC', derivedKey, sig, data);
      expect(valid).toBe(true);
    });

    await it('should derive AES key from HKDF', async () => {
      const ikm = new TextEncoder().encode('hkdf ikm');
      const baseKey = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey']);

      const derivedKey = await subtle.deriveKey(
        { name: 'HKDF', salt: new Uint8Array(16), info: new TextEncoder().encode('aes-info'), hash: 'SHA-256' },
        baseKey,
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt'],
      );
      expect(derivedKey.type).toBe('secret');
      expect(derivedKey.algorithm.name).toBe('AES-GCM');

      // Verify the derived key works
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, derivedKey, new TextEncoder().encode('hkdf-aes'));
      const pt = await subtle.decrypt({ name: 'AES-GCM', iv }, derivedKey, ct);
      expect(new TextDecoder().decode(pt)).toBe('hkdf-aes');
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

    await it('should generate ECDH P-384 key pair', async () => {
      const keyPair = await subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-384' },
        true,
        ['deriveBits'],
      ) as CryptoKeyPair;

      expect(keyPair.publicKey.type).toBe('public');
      expect(keyPair.privateKey.type).toBe('private');
      expect((keyPair.publicKey.algorithm as any).namedCurve).toBe('P-384');
    });

    await it('ECDH P-384 shared secret', async () => {
      const keyPairA = await subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-384' },
        true,
        ['deriveBits'],
      ) as CryptoKeyPair;
      const keyPairB = await subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-384' },
        true,
        ['deriveBits'],
      ) as CryptoKeyPair;

      const secretA = await subtle.deriveBits(
        { name: 'ECDH', public: keyPairB.publicKey },
        keyPairA.privateKey,
        384,
      );
      const secretB = await subtle.deriveBits(
        { name: 'ECDH', public: keyPairA.publicKey },
        keyPairB.privateKey,
        384,
      );

      const a = new Uint8Array(secretA);
      const b = new Uint8Array(secretB);
      expect(a.length).toBe(48);
      for (let i = 0; i < a.length; i++) {
        expect(a[i]).toBe(b[i]);
      }
    });

    await it('should derive key from ECDH', async () => {
      const keyPairA = await subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        ['deriveKey'],
      ) as CryptoKeyPair;
      const keyPairB = await subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        ['deriveKey'],
      ) as CryptoKeyPair;

      const derivedKey = await subtle.deriveKey(
        { name: 'ECDH', public: keyPairB.publicKey },
        keyPairA.privateKey,
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt'],
      );
      expect(derivedKey.type).toBe('secret');
      expect(derivedKey.algorithm.name).toBe('AES-GCM');
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

    await it('HMAC key should have hash in algorithm', async () => {
      const key = await subtle.generateKey(
        { name: 'HMAC', hash: 'SHA-512' },
        true,
        ['sign', 'verify'],
      ) as CryptoKey;
      expect(key.algorithm.name).toBe('HMAC');
      expect((key.algorithm as any).hash.name).toBe('SHA-512');
    });

    await it('EC key pair should have namedCurve in algorithm', async () => {
      const keyPair = await subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['sign', 'verify'],
      ) as CryptoKeyPair;
      expect((keyPair.publicKey.algorithm as any).namedCurve).toBe('P-256');
      expect((keyPair.privateKey.algorithm as any).namedCurve).toBe('P-256');
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

    await it('ECDSA should verify with imported public key', async () => {
      const keyPair = await subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['sign', 'verify'],
      ) as CryptoKeyPair;

      // Export and re-import public key
      const pubJwk = await subtle.exportKey('jwk', keyPair.publicKey) as JsonWebKey;
      const importedPub = await subtle.importKey(
        'jwk', pubJwk, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify'],
      );

      const data = new TextEncoder().encode('imported key verify');
      const sig = await subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        keyPair.privateKey,
        data,
      );
      const valid = await subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        importedPub,
        sig,
        data,
      );
      expect(valid).toBe(true);
    });
  });

  // ==================== Error handling ====================

  await describe('SubtleCrypto error handling', async () => {
    await it('should reject unsupported digest algorithm', async () => {
      let threw = false;
      try {
        await subtle.digest('MD5', new Uint8Array(0));
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });

    await it('should reject unsupported generateKey algorithm', async () => {
      let threw = false;
      try {
        await subtle.generateKey(
          { name: 'CHACHA20' } as any, true, ['encrypt', 'decrypt'],
        );
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });

    await it('should reject encrypt with sign-only key', async () => {
      const key = await subtle.generateKey(
        { name: 'HMAC', hash: 'SHA-256' }, true, ['sign', 'verify'],
      ) as CryptoKey;
      let threw = false;
      try {
        await subtle.encrypt({ name: 'AES-CBC', iv: new Uint8Array(16) }, key, new Uint8Array(16));
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });

    await it('should reject sign with encrypt-only key', async () => {
      const key = await subtle.generateKey(
        { name: 'AES-CBC', length: 256 }, true, ['encrypt'],
      ) as CryptoKey;
      let threw = false;
      try {
        await subtle.sign('HMAC', key, new Uint8Array(16));
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });

    await it('should reject invalid AES key length in generateKey', async () => {
      let threw = false;
      try {
        await subtle.generateKey(
          { name: 'AES-CBC', length: 100 } as any, true, ['encrypt', 'decrypt'],
        );
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });

    await it('should reject invalid AES raw import key length', async () => {
      let threw = false;
      try {
        // 15 bytes is not a valid AES key length
        await subtle.importKey('raw', new Uint8Array(15), { name: 'AES-CBC' }, true, ['encrypt', 'decrypt']);
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });

    await it('should reject empty key usages for AES', async () => {
      let threw = false;
      try {
        await subtle.generateKey({ name: 'AES-CBC', length: 256 }, true, []);
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });

    await it('should reject invalid key usages for HMAC', async () => {
      let threw = false;
      try {
        // encrypt is not valid for HMAC
        await subtle.generateKey(
          { name: 'HMAC', hash: 'SHA-256' }, true, ['encrypt'] as any,
        );
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });

    await it('should reject invalid key usages for AES', async () => {
      let threw = false;
      try {
        // sign is not valid for AES
        await subtle.generateKey(
          { name: 'AES-CBC', length: 256 }, true, ['sign'] as any,
        );
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });

    await it('should reject unsupported import format', async () => {
      let threw = false;
      try {
        await subtle.importKey(
          'pkcs8' as any, new Uint8Array(32), { name: 'AES-CBC' }, true, ['encrypt'],
        );
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });

    await it('should reject JWK with wrong kty for AES', async () => {
      let threw = false;
      try {
        await subtle.importKey(
          'jwk',
          { kty: 'EC', k: 'AAAA' } as JsonWebKey,
          { name: 'AES-CBC' },
          true,
          ['encrypt', 'decrypt'],
        );
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });

    await it('should reject JWK with wrong kty for HMAC', async () => {
      let threw = false;
      try {
        await subtle.importKey(
          'jwk',
          { kty: 'EC', k: 'AAAA' } as JsonWebKey,
          { name: 'HMAC', hash: 'SHA-256' },
          true,
          ['sign', 'verify'],
        );
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });
  });

  // ==================== subtle property existence ====================

  await describe('crypto / subtle structure', async () => {
    await it('crypto should have subtle property', async () => {
      expect(globalThis.crypto).toBeDefined();
      expect(globalThis.crypto.subtle).toBeDefined();
    });

    await it('subtle should have standard methods', async () => {
      expect(typeof subtle.digest).toBe('function');
      expect(typeof subtle.generateKey).toBe('function');
      expect(typeof subtle.importKey).toBe('function');
      expect(typeof subtle.exportKey).toBe('function');
      expect(typeof subtle.encrypt).toBe('function');
      expect(typeof subtle.decrypt).toBe('function');
      expect(typeof subtle.sign).toBe('function');
      expect(typeof subtle.verify).toBe('function');
      expect(typeof subtle.deriveBits).toBe('function');
      expect(typeof subtle.deriveKey).toBe('function');
    });

    await it('crypto should have getRandomValues and randomUUID', async () => {
      expect(typeof crypto.getRandomValues).toBe('function');
      expect(typeof crypto.randomUUID).toBe('function');
    });
  });
};
