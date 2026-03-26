// Extended crypto tests — additional algorithms, edge cases, getHashes/getCiphers
// Ported from refs/node-test/parallel/test-crypto-*.js
// Original: MIT license, Node.js contributors

import { describe, it, expect } from '@gjsify/unit';
import * as crypto from 'node:crypto';

export default async () => {

  // ===================== Module exports =====================
  await describe('crypto module exports', async () => {
    await it('should export createHash', async () => {
      expect(typeof crypto.createHash).toBe('function');
    });
    await it('should export createHmac', async () => {
      expect(typeof crypto.createHmac).toBe('function');
    });
    await it('should export randomBytes', async () => {
      expect(typeof crypto.randomBytes).toBe('function');
    });
    await it('should export randomUUID', async () => {
      expect(typeof crypto.randomUUID).toBe('function');
    });
    await it('should export randomInt', async () => {
      expect(typeof crypto.randomInt).toBe('function');
    });
    await it('should export randomFillSync', async () => {
      expect(typeof crypto.randomFillSync).toBe('function');
    });
    await it('should export pbkdf2Sync', async () => {
      expect(typeof crypto.pbkdf2Sync).toBe('function');
    });
    await it('should export pbkdf2', async () => {
      expect(typeof crypto.pbkdf2).toBe('function');
    });
    await it('should export scryptSync', async () => {
      expect(typeof crypto.scryptSync).toBe('function');
    });
    await it('should export createCipheriv', async () => {
      expect(typeof crypto.createCipheriv).toBe('function');
    });
    await it('should export createDecipheriv', async () => {
      expect(typeof crypto.createDecipheriv).toBe('function');
    });
    await it('should export createSign', async () => {
      expect(typeof crypto.createSign).toBe('function');
    });
    await it('should export createVerify', async () => {
      expect(typeof crypto.createVerify).toBe('function');
    });
    await it('should export createDiffieHellman', async () => {
      expect(typeof crypto.createDiffieHellman).toBe('function');
    });
    await it('should export createECDH', async () => {
      expect(typeof crypto.createECDH).toBe('function');
    });
    await it('should export timingSafeEqual', async () => {
      expect(typeof crypto.timingSafeEqual).toBe('function');
    });
    await it('should export constants', async () => {
      expect(typeof crypto.constants).toBe('object');
    });
    await it('should export getHashes', async () => {
      expect(typeof crypto.getHashes).toBe('function');
    });
    await it('should export getCiphers', async () => {
      expect(typeof crypto.getCiphers).toBe('function');
    });
    await it('should export getCurves', async () => {
      expect(typeof crypto.getCurves).toBe('function');
    });
    await it('should export createSecretKey', async () => {
      expect(typeof crypto.createSecretKey).toBe('function');
    });
  });

  // ===================== getHashes =====================
  await describe('crypto.getHashes', async () => {
    await it('should return an array', async () => {
      const hashes = crypto.getHashes();
      expect(Array.isArray(hashes)).toBe(true);
    });

    await it('should contain sha256', async () => {
      const hashes = crypto.getHashes();
      const lower = hashes.map(h => h.toLowerCase());
      expect(lower.some(h => h === 'sha256')).toBe(true);
    });

    await it('should contain sha1', async () => {
      const hashes = crypto.getHashes();
      const lower = hashes.map(h => h.toLowerCase());
      expect(lower.some(h => h === 'sha1')).toBe(true);
    });

    await it('should contain md5', async () => {
      const hashes = crypto.getHashes();
      const lower = hashes.map(h => h.toLowerCase());
      expect(lower.some(h => h === 'md5')).toBe(true);
    });

    await it('should contain sha512', async () => {
      const hashes = crypto.getHashes();
      const lower = hashes.map(h => h.toLowerCase());
      expect(lower.some(h => h === 'sha512')).toBe(true);
    });

    await it('all entries should be strings', async () => {
      const hashes = crypto.getHashes();
      for (const h of hashes) {
        expect(typeof h).toBe('string');
      }
    });
  });

  // ===================== getCiphers =====================
  await describe('crypto.getCiphers', async () => {
    await it('should return an array', async () => {
      const ciphers = crypto.getCiphers();
      expect(Array.isArray(ciphers)).toBe(true);
    });

    await it('should contain aes ciphers', async () => {
      const ciphers = crypto.getCiphers();
      const lower = ciphers.map(c => c.toLowerCase());
      expect(lower.some(c => c.includes('aes'))).toBe(true);
    });

    await it('all entries should be strings', async () => {
      const ciphers = crypto.getCiphers();
      for (const c of ciphers) {
        expect(typeof c).toBe('string');
      }
    });
  });

  // ===================== getCurves =====================
  await describe('crypto.getCurves', async () => {
    await it('should return an array', async () => {
      const curves = crypto.getCurves();
      expect(Array.isArray(curves)).toBe(true);
    });

    await it('should contain common curves', async () => {
      const curves = crypto.getCurves();
      expect(curves).toContain('secp256k1');
      expect(curves).toContain('prime256v1');
    });

    await it('all entries should be strings', async () => {
      const curves = crypto.getCurves();
      for (const c of curves) {
        expect(typeof c).toBe('string');
      }
    });
  });

  // ===================== Hash extended =====================
  await describe('crypto.createHash extended', async () => {
    await it('sha384 should produce 48-byte digest', async () => {
      const hash = crypto.createHash('sha384').update('test').digest();
      expect(hash.length).toBe(48);
    });

    await it('sha512 should produce 64-byte digest', async () => {
      const hash = crypto.createHash('sha512').update('test').digest();
      expect(hash.length).toBe(64);
    });

    await it('md5 should produce 16-byte digest', async () => {
      const hash = crypto.createHash('md5').update('test').digest();
      expect(hash.length).toBe(16);
    });

    await it('sha1 should produce 20-byte digest', async () => {
      const hash = crypto.createHash('sha1').update('test').digest();
      expect(hash.length).toBe(20);
    });

    await it('sha256 should produce 32-byte digest', async () => {
      const hash = crypto.createHash('sha256').update('test').digest();
      expect(hash.length).toBe(32);
    });

    await it('should produce known SHA256 hex for empty string', async () => {
      const hash = crypto.createHash('sha256').update('').digest('hex');
      expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    });

    await it('should produce known MD5 hex for empty string', async () => {
      const hash = crypto.createHash('md5').update('').digest('hex');
      expect(hash).toBe('d41d8cd98f00b204e9800998ecf8427e');
    });

    await it('should produce known SHA1 hex for empty string', async () => {
      const hash = crypto.createHash('sha1').update('').digest('hex');
      expect(hash).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709');
    });

    await it('chained updates should produce correct hash', async () => {
      const hash1 = crypto.createHash('sha256').update('hello').update(' world').digest('hex');
      const hash2 = crypto.createHash('sha256').update('hello world').digest('hex');
      expect(hash1).toBe(hash2);
    });

    await it('should accept Uint8Array input', async () => {
      const arr = new TextEncoder().encode('test data');
      const hash = crypto.createHash('sha256').update(arr).digest('hex');
      expect(typeof hash).toBe('string');
      expect(hash.length).toBe(64);
    });

    await it('different data should produce different hashes', async () => {
      const h1 = crypto.createHash('sha256').update('abc').digest('hex');
      const h2 = crypto.createHash('sha256').update('def').digest('hex');
      expect(h1).not.toBe(h2);
    });

    await it('should support base64 encoding', async () => {
      const hash = crypto.createHash('sha256').update('test').digest('base64');
      expect(typeof hash).toBe('string');
      expect(hash.length).toBeGreaterThan(0);
    });

    await it('should throw for unknown algorithm', async () => {
      expect(() => crypto.createHash('nonexistent')).toThrow();
    });
  });

  // ===================== HMAC extended =====================
  await describe('crypto.createHmac extended', async () => {
    await it('HMAC-SHA256 should produce 32-byte digest', async () => {
      const hmac = crypto.createHmac('sha256', 'key').update('data').digest();
      expect(hmac.length).toBe(32);
    });

    await it('HMAC-MD5 should produce 16-byte digest', async () => {
      const hmac = crypto.createHmac('md5', 'key').update('data').digest();
      expect(hmac.length).toBe(16);
    });

    await it('HMAC-SHA1 should produce 20-byte digest', async () => {
      const hmac = crypto.createHmac('sha1', 'key').update('data').digest();
      expect(hmac.length).toBe(20);
    });

    await it('HMAC-SHA512 should produce 64-byte digest', async () => {
      const hmac = crypto.createHmac('sha512', 'key').update('data').digest();
      expect(hmac.length).toBe(64);
    });

    await it('should accept Uint8Array key', async () => {
      const key = new TextEncoder().encode('secret');
      const hmac = crypto.createHmac('sha256', key).update('data').digest('hex');
      expect(typeof hmac).toBe('string');
      expect(hmac.length).toBe(64);
    });

    await it('different keys should produce different HMACs', async () => {
      const h1 = crypto.createHmac('sha256', 'key1').update('data').digest('hex');
      const h2 = crypto.createHmac('sha256', 'key2').update('data').digest('hex');
      expect(h1).not.toBe(h2);
    });

    await it('different data should produce different HMACs', async () => {
      const h1 = crypto.createHmac('sha256', 'key').update('data1').digest('hex');
      const h2 = crypto.createHmac('sha256', 'key').update('data2').digest('hex');
      expect(h1).not.toBe(h2);
    });

    await it('chained updates should match single update', async () => {
      const h1 = crypto.createHmac('sha256', 'key').update('hello').update(' world').digest('hex');
      const h2 = crypto.createHmac('sha256', 'key').update('hello world').digest('hex');
      expect(h1).toBe(h2);
    });

    await it('empty data should produce valid HMAC', async () => {
      const hmac = crypto.createHmac('sha256', 'key').update('').digest('hex');
      expect(typeof hmac).toBe('string');
      expect(hmac.length).toBe(64);
    });

    await it('empty key should produce valid HMAC', async () => {
      const hmac = crypto.createHmac('sha256', '').update('data').digest('hex');
      expect(typeof hmac).toBe('string');
      expect(hmac.length).toBe(64);
    });
  });

  // ===================== randomBytes extended =====================
  await describe('crypto.randomBytes extended', async () => {
    await it('should return Buffer of requested size', async () => {
      const buf = crypto.randomBytes(32);
      expect(buf.length).toBe(32);
    });

    await it('should return different values on each call', async () => {
      const a = crypto.randomBytes(32);
      const b = crypto.randomBytes(32);
      // Extremely unlikely to be equal
      expect(a.toString('hex')).not.toBe(b.toString('hex'));
    });

    await it('should handle size 0', async () => {
      const buf = crypto.randomBytes(0);
      expect(buf.length).toBe(0);
    });

    await it('should handle size 1', async () => {
      const buf = crypto.randomBytes(1);
      expect(buf.length).toBe(1);
    });

    await it('should handle large sizes', async () => {
      const buf = crypto.randomBytes(1024);
      expect(buf.length).toBe(1024);
    });
  });

  // ===================== randomUUID extended =====================
  await describe('crypto.randomUUID extended', async () => {
    await it('should return a v4 UUID string', async () => {
      const uuid = crypto.randomUUID();
      expect(typeof uuid).toBe('string');
      expect(uuid.length).toBe(36);
    });

    await it('should match UUID v4 format', async () => {
      const uuid = crypto.randomUUID();
      const regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
      expect(regex.test(uuid)).toBe(true);
    });

    await it('should generate unique UUIDs', async () => {
      const uuids = new Set(Array.from({ length: 100 }, () => crypto.randomUUID()));
      expect(uuids.size).toBe(100);
    });

    await it('version nibble should be 4', async () => {
      const uuid = crypto.randomUUID();
      expect(uuid[14]).toBe('4');
    });

    await it('variant nibble should be 8, 9, a, or b', async () => {
      const uuid = crypto.randomUUID();
      expect(['8', '9', 'a', 'b']).toContain(uuid[19]);
    });
  });

  // ===================== randomInt extended =====================
  await describe('crypto.randomInt extended', async () => {
    await it('should return integer in [0, max)', async () => {
      for (let i = 0; i < 20; i++) {
        const val = crypto.randomInt(10);
        expect(val).toBeGreaterThan(-1);
        expect(val).toBeLessThan(10);
        expect(Number.isInteger(val)).toBe(true);
      }
    });

    await it('should return integer in [min, max)', async () => {
      for (let i = 0; i < 20; i++) {
        const val = crypto.randomInt(5, 15);
        expect(val).toBeGreaterThan(4);
        expect(val).toBeLessThan(15);
      }
    });

    await it('should handle max=1 (always returns 0)', async () => {
      for (let i = 0; i < 10; i++) {
        expect(crypto.randomInt(1)).toBe(0);
      }
    });

    await it('should handle min=0, max=2', async () => {
      const results = new Set<number>();
      for (let i = 0; i < 50; i++) {
        results.add(crypto.randomInt(0, 2));
      }
      // Should produce both 0 and 1
      expect(results.has(0)).toBe(true);
      expect(results.has(1)).toBe(true);
      expect(results.has(2)).toBe(false);
    });
  });

  // ===================== timingSafeEqual extended =====================
  await describe('crypto.timingSafeEqual extended', async () => {
    await it('should return true for equal arrays', async () => {
      const a = new Uint8Array([104, 101, 108, 108, 111]);
      const b = new Uint8Array([104, 101, 108, 108, 111]);
      expect(crypto.timingSafeEqual(a, b)).toBe(true);
    });

    await it('should return false for different arrays', async () => {
      const a = new Uint8Array([104, 101, 108, 108, 111]);
      const b = new Uint8Array([119, 111, 114, 108, 100]);
      expect(crypto.timingSafeEqual(a, b)).toBe(false);
    });

    await it('should throw for different lengths', async () => {
      const a = new Uint8Array([1, 2, 3, 4, 5]);
      const b = new Uint8Array([1, 2]);
      expect(() => crypto.timingSafeEqual(a, b)).toThrow();
    });

    await it('should work with Uint8Array', async () => {
      const a = new Uint8Array([1, 2, 3]);
      const b = new Uint8Array([1, 2, 3]);
      expect(crypto.timingSafeEqual(a, b)).toBe(true);
    });

    await it('should return false for single byte difference', async () => {
      const a = new Uint8Array([1, 2, 3, 4]);
      const b = new Uint8Array([1, 2, 3, 5]);
      expect(crypto.timingSafeEqual(a, b)).toBe(false);
    });

    await it('should work with empty arrays', async () => {
      const a = new Uint8Array(0);
      const b = new Uint8Array(0);
      expect(crypto.timingSafeEqual(a, b)).toBe(true);
    });
  });

  // ===================== constants =====================
  await describe('crypto.constants', async () => {
    await it('should be an object', async () => {
      expect(typeof crypto.constants).toBe('object');
    });

    await it('should have RSA_PKCS1_PADDING', async () => {
      expect(typeof crypto.constants.RSA_PKCS1_PADDING).toBe('number');
    });

    await it('should have RSA_PKCS1_OAEP_PADDING', async () => {
      expect(typeof crypto.constants.RSA_PKCS1_OAEP_PADDING).toBe('number');
    });

    await it('should have DH_CHECK_P_NOT_PRIME', async () => {
      expect(typeof crypto.constants.DH_CHECK_P_NOT_PRIME).toBe('number');
    });
  });
};
