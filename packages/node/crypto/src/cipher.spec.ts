import { describe, it, expect } from '@gjsify/unit';
import { createCipheriv, createDecipheriv, getCiphers } from 'crypto';
import { Buffer } from 'buffer';

export default async () => {
  await describe('crypto.getCiphers', async () => {
    await it('should return an array of cipher names', async () => {
      const ciphers = getCiphers();
      expect(Array.isArray(ciphers)).toBe(true);
      expect(ciphers.length).toBeGreaterThan(0);
    });

    await it('should include common ciphers', async () => {
      const ciphers = getCiphers();
      expect(ciphers).toContain('aes-256-cbc');
      expect(ciphers).toContain('aes-128-cbc');
    });
  });

  await describe('crypto.createCipheriv / createDecipheriv', async () => {
    await it('should encrypt and decrypt with aes-256-cbc', async () => {
      const algorithm = 'aes-256-cbc';
      const key = Buffer.alloc(32, 'a'); // 256-bit key
      const iv = Buffer.alloc(16, 'b');  // 128-bit IV

      // Encrypt
      const cipher = createCipheriv(algorithm, key, iv);
      let encrypted = cipher.update('Hello, World!', 'utf8', 'hex');
      encrypted += cipher.final('hex');

      // Decrypt
      const decipher = createDecipheriv(algorithm, key, iv);
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      expect(decrypted).toBe('Hello, World!');
    });

    await it('should encrypt and decrypt with aes-128-cbc', async () => {
      const key = Buffer.alloc(16, 'k');
      const iv = Buffer.alloc(16, 'i');

      const cipher = createCipheriv('aes-128-cbc', key, iv);
      let encrypted = cipher.update('test data', 'utf8', 'hex');
      encrypted += cipher.final('hex');

      const decipher = createDecipheriv('aes-128-cbc', key, iv);
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      expect(decrypted).toBe('test data');
    });

    await it('should work with Buffer input/output', async () => {
      const key = Buffer.alloc(32, 'x');
      const iv = Buffer.alloc(16, 'y');

      const cipher = createCipheriv('aes-256-cbc', key, iv);
      const encrypted = Buffer.concat([
        cipher.update(Buffer.from('binary data')),
        cipher.final(),
      ]);

      const decipher = createDecipheriv('aes-256-cbc', key, iv);
      const decrypted = Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ]);

      expect(decrypted.toString('utf8')).toBe('binary data');
    });
  });
};
