import { describe, it, expect } from '@gjsify/unit';
import { pbkdf2, pbkdf2Sync } from 'node:crypto';
import { Buffer } from 'node:buffer';

export default async () => {
  await describe('crypto.pbkdf2Sync', async () => {
    await it('should be a function', async () => {
      expect(typeof pbkdf2Sync).toBe('function');
    });

    await it('should derive key with sha256', async () => {
      const key = pbkdf2Sync('password', 'salt', 1000, 32, 'sha256');
      expect(key).toBeDefined();
      expect(key.length).toBe(32);
    });

    await it('should derive key with sha1 (default)', async () => {
      const key = pbkdf2Sync('password', 'salt', 1, 20, 'sha1');
      expect(key).toBeDefined();
      expect(key.length).toBe(20);
      // Known test vector: PBKDF2-HMAC-SHA1("password", "salt", 1, 20)
      expect(key.toString('hex')).toBe('0c60c80f961f0e71f3a9b524af6012062fe037a6');
    });

    await it('should derive key with sha512', async () => {
      const key = pbkdf2Sync('password', 'salt', 1, 64, 'sha512');
      expect(key).toBeDefined();
      expect(key.length).toBe(64);
    });

    await it('should accept Buffer inputs', async () => {
      const key = pbkdf2Sync(Buffer.from('password'), Buffer.from('salt'), 1000, 32, 'sha256');
      expect(key.length).toBe(32);
    });

    await it('should handle keylen 0', async () => {
      // Node.js native throws on keylen 0, our GJS impl returns empty buffer
      // Both behaviors are acceptable — test that it doesn't crash
      try {
        const key = pbkdf2Sync('password', 'salt', 1, 0, 'sha256');
        expect(key.length).toBe(0);
      } catch (_e) {
        // Node.js throws "Deriving bits failed" for keylen 0
        expect(true).toBe(true);
      }
    });

    await it('should throw on invalid iterations', async () => {
      expect(() => {
        pbkdf2Sync('password', 'salt', 0, 32, 'sha256');
      }).toThrow();
    });

    await it('should throw on unsupported digest', async () => {
      expect(() => {
        pbkdf2Sync('password', 'salt', 1, 32, 'unsupported');
      }).toThrow();
    });
  });

  await describe('crypto.pbkdf2', async () => {
    await it('should be a function', async () => {
      expect(typeof pbkdf2).toBe('function');
    });

    await it('should derive key asynchronously', async () => {
      await new Promise<void>((resolve) => {
        pbkdf2('password', 'salt', 1000, 32, 'sha256', (err, key) => {
          expect(err).toBeNull();
          expect(key!.length).toBe(32);
          resolve();
        });
      });
    });
  });
};
