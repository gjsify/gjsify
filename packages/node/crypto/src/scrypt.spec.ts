import { describe, it, expect } from '@gjsify/unit';
import { scrypt, scryptSync } from 'node:crypto';
import { Buffer } from 'node:buffer';

export default async () => {
  await describe('crypto.scryptSync', async () => {
    await it('should be a function', async () => {
      expect(typeof scryptSync).toBe('function');
    });

    await it('should derive a 64-byte key with default options', async () => {
      const key = scryptSync('password', 'salt', 64);
      expect(key).toBeDefined();
      expect(key.length).toBe(64);
      expect(key.toString('hex').substring(0, 64)).toBe(
        '745731af4484f323968969eda289aeee005b5903ac561e64a5aca121797bf773'
      );
    });

    await it('should derive a 32-byte key', async () => {
      const key = scryptSync('password', 'salt', 32);
      expect(key).toBeDefined();
      expect(key.length).toBe(32);
    });

    await it('should accept Buffer inputs', async () => {
      const key = scryptSync(Buffer.from('password'), Buffer.from('salt'), 64);
      expect(key.length).toBe(64);
      // Same result as string input
      expect(key.toString('hex').substring(0, 64)).toBe(
        '745731af4484f323968969eda289aeee005b5903ac561e64a5aca121797bf773'
      );
    });

    await it('should match RFC 7914 test vector (N=1024, r=8, p=16)', async () => {
      const key = scryptSync('password', 'NaCl', 64, { N: 1024, r: 8, p: 16 });
      expect(key.toString('hex')).toBe(
        'fdbabe1c9d3472007856e7190d01e9fe7c6ad7cbc8237830e77376634b3731622eaf30d92e22a3886ff109279d9830dac727afb94a83ee6d8360cbdfa2cc0640'
      );
    });

    await it('should produce different keys for different passwords', async () => {
      const key1 = scryptSync('password1', 'salt', 32);
      const key2 = scryptSync('password2', 'salt', 32);
      expect(key1.toString('hex') !== key2.toString('hex')).toBe(true);
    });

    await it('should produce different keys for different salts', async () => {
      const key1 = scryptSync('password', 'salt1', 32);
      const key2 = scryptSync('password', 'salt2', 32);
      expect(key1.toString('hex') !== key2.toString('hex')).toBe(true);
    });

    await it('should accept custom cost parameter N', async () => {
      const key = scryptSync('test', 'salt', 32, { N: 256 });
      expect(key.length).toBe(32);
    });
  });

  await describe('crypto.scrypt', async () => {
    await it('should be a function', async () => {
      expect(typeof scrypt).toBe('function');
    });

    await it('should derive key asynchronously', async () => {
      const key = await new Promise<Buffer>((resolve, reject) => {
        scrypt('password', 'salt', 64, (err, key) => {
          if (err) reject(err);
          else resolve(key);
        });
      });
      expect(key.length).toBe(64);
      expect(key.toString('hex').substring(0, 64)).toBe(
        '745731af4484f323968969eda289aeee005b5903ac561e64a5aca121797bf773'
      );
    });

    await it('should accept options parameter', async () => {
      const key = await new Promise<Buffer>((resolve, reject) => {
        scrypt('password', 'NaCl', 64, { N: 1024, r: 8, p: 16 }, (err, key) => {
          if (err) reject(err);
          else resolve(key);
        });
      });
      expect(key.toString('hex')).toBe(
        'fdbabe1c9d3472007856e7190d01e9fe7c6ad7cbc8237830e77376634b3731622eaf30d92e22a3886ff109279d9830dac727afb94a83ee6d8360cbdfa2cc0640'
      );
    });
  });
};
