// Tests for AES-GCM cipher mode
// Reference: NIST SP 800-38D test vectors

import { describe, it, expect } from '@gjsify/unit';
import { createCipheriv, createDecipheriv } from 'crypto';
import { Buffer } from 'buffer';

export default async () => {

  await describe('AES-GCM', async () => {
    await it('should support aes-256-gcm algorithm', async () => {
      const key = Buffer.alloc(32, 'a');
      const iv = Buffer.alloc(12, 'b');
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      expect(cipher).toBeDefined();
    });

    await it('should support aes-128-gcm algorithm', async () => {
      const key = Buffer.alloc(16, 'a');
      const iv = Buffer.alloc(12, 'b');
      const cipher = createCipheriv('aes-128-gcm', key, iv);
      expect(cipher).toBeDefined();
    });

    await it('should encrypt and decrypt round-trip', async () => {
      const key = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8');
      const iv = Buffer.alloc(12, 0);
      const plaintext = 'Hello, AES-GCM!';

      // Encrypt
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      let encrypted = cipher.update(plaintext, 'utf8');
      encrypted = Buffer.concat([encrypted, cipher.final()]);
      const tag = cipher.getAuthTag();
      expect(tag).toBeDefined();
      expect(tag.length).toBe(16);

      // Decrypt
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      let decrypted = decipher.update(encrypted);
      decrypted = Buffer.concat([decrypted, decipher.final()]);

      expect(decrypted.toString('utf8')).toBe(plaintext);
    });

    await it('should fail with wrong auth tag', async () => {
      const key = Buffer.alloc(32, 'k');
      const iv = Buffer.alloc(12, 'i');
      const plaintext = 'secret data';

      const cipher = createCipheriv('aes-256-gcm', key, iv);
      let encrypted = cipher.update(plaintext, 'utf8');
      encrypted = Buffer.concat([encrypted, cipher.final()]);
      const tag = cipher.getAuthTag();

      // Tamper with the tag
      const badTag = Buffer.from(tag);
      badTag[0] ^= 0xff;

      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(badTag);
      decipher.update(encrypted);
      expect(() => decipher.final()).toThrow();
    });

    await it('should support AAD (additional authenticated data)', async () => {
      const key = Buffer.alloc(32, 'k');
      const iv = Buffer.alloc(12, 'i');
      const plaintext = 'encrypted part';
      const aad = Buffer.from('authenticated but not encrypted');

      // Encrypt with AAD
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(aad);
      let encrypted = cipher.update(plaintext, 'utf8');
      encrypted = Buffer.concat([encrypted, cipher.final()]);
      const tag = cipher.getAuthTag();

      // Decrypt with same AAD
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      decipher.setAAD(aad);
      let decrypted = decipher.update(encrypted);
      decrypted = Buffer.concat([decrypted, decipher.final()]);
      expect(decrypted.toString('utf8')).toBe(plaintext);
    });

    await it('should fail with wrong AAD', async () => {
      const key = Buffer.alloc(32, 'k');
      const iv = Buffer.alloc(12, 'i');
      const plaintext = 'test';
      const aad = Buffer.from('original AAD');

      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(aad);
      let encrypted = cipher.update(plaintext, 'utf8');
      encrypted = Buffer.concat([encrypted, cipher.final()]);
      const tag = cipher.getAuthTag();

      // Decrypt with different AAD
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      decipher.setAAD(Buffer.from('tampered AAD'));
      decipher.update(encrypted);
      expect(() => decipher.final()).toThrow();
    });

    await it('should handle empty plaintext', async () => {
      const key = Buffer.alloc(32, 'k');
      const iv = Buffer.alloc(12, 'i');

      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const encrypted = cipher.final();
      const tag = cipher.getAuthTag();

      expect(encrypted.length).toBe(0);
      expect(tag.length).toBe(16);

      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      const decrypted = decipher.final();
      expect(decrypted.length).toBe(0);
    });

    await it('should produce different ciphertext for different IVs', async () => {
      const key = Buffer.alloc(32, 'k');
      const plaintext = 'same data';

      const cipher1 = createCipheriv('aes-256-gcm', key, Buffer.alloc(12, 1));
      let enc1 = cipher1.update(plaintext, 'utf8');
      enc1 = Buffer.concat([enc1, cipher1.final()]);

      const cipher2 = createCipheriv('aes-256-gcm', key, Buffer.alloc(12, 2));
      let enc2 = cipher2.update(plaintext, 'utf8');
      enc2 = Buffer.concat([enc2, cipher2.final()]);

      expect(enc1.toString('hex')).not.toBe(enc2.toString('hex'));
    });
  });
};
