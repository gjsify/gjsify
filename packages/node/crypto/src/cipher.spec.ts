import { describe, it, expect } from '@gjsify/unit';
import { createCipheriv, createDecipheriv, getCiphers } from 'crypto';
import { Buffer } from 'buffer';

export default async () => {

  // --- getCiphers ---
  await describe('crypto.getCiphers', async () => {
    await it('should return an array of cipher names', async () => {
      const ciphers = getCiphers();
      expect(Array.isArray(ciphers)).toBe(true);
      expect(ciphers.length).toBeGreaterThan(0);
    });

    await it('should include AES-CBC ciphers', async () => {
      const ciphers = getCiphers();
      expect(ciphers).toContain('aes-128-cbc');
      expect(ciphers).toContain('aes-192-cbc');
      expect(ciphers).toContain('aes-256-cbc');
    });

    await it('should include AES-CTR ciphers', async () => {
      const ciphers = getCiphers();
      expect(ciphers).toContain('aes-128-ctr');
      expect(ciphers).toContain('aes-256-ctr');
    });

    await it('should include AES-ECB ciphers', async () => {
      const ciphers = getCiphers();
      expect(ciphers).toContain('aes-128-ecb');
      expect(ciphers).toContain('aes-256-ecb');
    });

    await it('should return only strings', async () => {
      const ciphers = getCiphers();
      for (const c of ciphers) {
        expect(typeof c).toBe('string');
      }
    });
  });

  // --- AES-256-CBC round-trip ---
  await describe('crypto.createCipheriv / createDecipheriv (AES-256-CBC)', async () => {
    const algorithm = 'aes-256-cbc';
    const key = Buffer.from('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'hex');
    const iv = Buffer.from('00112233445566778899aabbccddeeff', 'hex');

    await it('should encrypt and decrypt a simple string', async () => {
      const cipher = createCipheriv(algorithm, key, iv);
      let encrypted = cipher.update('Hello World!', 'utf8', 'hex');
      encrypted += cipher.final('hex');

      expect(typeof encrypted).toBe('string');
      expect(encrypted.length).toBeGreaterThan(0);

      const decipher = createDecipheriv(algorithm, key, iv);
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      expect(decrypted).toBe('Hello World!');
    });

    await it('should encrypt and decrypt with Buffer input/output', async () => {
      const plaintext = Buffer.from('Buffer round-trip test');

      const cipher = createCipheriv(algorithm, key, iv);
      const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);

      expect(encrypted.length).toBeGreaterThan(0);

      const decipher = createDecipheriv(algorithm, key, iv);
      const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

      expect(decrypted.toString('utf8')).toBe('Buffer round-trip test');
    });

    await it('should handle empty string', async () => {
      const cipher = createCipheriv(algorithm, key, iv);
      let encrypted = cipher.update('', 'utf8', 'hex');
      encrypted += cipher.final('hex');

      const decipher = createDecipheriv(algorithm, key, iv);
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      expect(decrypted).toBe('');
    });

    await it('should handle block-aligned data (16 bytes)', async () => {
      const plaintext = 'Exactly16bytes!!'; // 16 bytes
      const cipher = createCipheriv(algorithm, key, iv);
      let encrypted = cipher.update(plaintext, 'utf8', 'hex');
      encrypted += cipher.final('hex');

      const decipher = createDecipheriv(algorithm, key, iv);
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      expect(decrypted).toBe(plaintext);
    });

    await it('should handle multi-block data', async () => {
      const plaintext = 'This is a longer message that spans multiple AES blocks for testing purposes!';
      const cipher = createCipheriv(algorithm, key, iv);
      let encrypted = cipher.update(plaintext, 'utf8', 'hex');
      encrypted += cipher.final('hex');

      const decipher = createDecipheriv(algorithm, key, iv);
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      expect(decrypted).toBe(plaintext);
    });

    await it('should fail to decrypt with wrong key', async () => {
      const cipher = createCipheriv(algorithm, key, iv);
      let encrypted = cipher.update('secret data', 'utf8', 'hex');
      encrypted += cipher.final('hex');

      const wrongKey = Buffer.from('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'hex');
      const decipher = createDecipheriv(algorithm, wrongKey, iv);
      let threw = false;
      try {
        decipher.update(encrypted, 'hex', 'utf8');
        decipher.final('utf8');
      } catch (e) {
        threw = true;
      }
      // Wrong key should produce garbage or throw (padding error)
      expect(threw).toBe(true);
    });

    await it('should produce different ciphertext with different IVs', async () => {
      const plaintext = 'Same plaintext';
      const iv2 = Buffer.from('ffeeddccbbaa99887766554433221100', 'hex');

      const cipher1 = createCipheriv(algorithm, key, iv);
      let enc1 = cipher1.update(plaintext, 'utf8', 'hex');
      enc1 += cipher1.final('hex');

      const cipher2 = createCipheriv(algorithm, key, iv2);
      let enc2 = cipher2.update(plaintext, 'utf8', 'hex');
      enc2 += cipher2.final('hex');

      expect(enc1 !== enc2).toBe(true);
    });
  });

  // --- AES-128-CBC round-trip ---
  await describe('crypto.createCipheriv / createDecipheriv (AES-128-CBC)', async () => {
    const algorithm = 'aes-128-cbc';
    const key = Buffer.from('0123456789abcdef0123456789abcdef', 'hex');
    const iv = Buffer.from('00112233445566778899aabbccddeeff', 'hex');

    await it('should encrypt and decrypt', async () => {
      const cipher = createCipheriv(algorithm, key, iv);
      let encrypted = cipher.update('AES-128 test', 'utf8', 'hex');
      encrypted += cipher.final('hex');

      const decipher = createDecipheriv(algorithm, key, iv);
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      expect(decrypted).toBe('AES-128 test');
    });
  });

  // --- AES-256-CTR round-trip ---
  await describe('crypto.createCipheriv / createDecipheriv (AES-256-CTR)', async () => {
    const algorithm = 'aes-256-ctr';
    const key = Buffer.from('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'hex');
    const iv = Buffer.from('00112233445566778899aabbccddeeff', 'hex');

    await it('should encrypt and decrypt', async () => {
      const cipher = createCipheriv(algorithm, key, iv);
      let encrypted = cipher.update('CTR mode test', 'utf8', 'hex');
      encrypted += cipher.final('hex');

      const decipher = createDecipheriv(algorithm, key, iv);
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      expect(decrypted).toBe('CTR mode test');
    });

    await it('CTR ciphertext should be same length as plaintext (no padding)', async () => {
      const plaintext = 'No padding in CTR!';
      const cipher = createCipheriv(algorithm, key, iv);
      const encrypted = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);

      // CTR mode: ciphertext length = plaintext length (no padding)
      expect(encrypted.length).toBe(plaintext.length);
    });
  });

  // --- AES-128-ECB ---
  await describe('crypto.createCipheriv / createDecipheriv (AES-128-ECB)', async () => {
    const algorithm = 'aes-128-ecb';
    const key = Buffer.from('0123456789abcdef0123456789abcdef', 'hex');

    await it('should encrypt and decrypt with null IV', async () => {
      const cipher = createCipheriv(algorithm, key, null);
      let encrypted = cipher.update('ECB mode test!', 'utf8', 'hex');
      encrypted += cipher.final('hex');

      const decipher = createDecipheriv(algorithm, key, null);
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      expect(decrypted).toBe('ECB mode test!');
    });
  });

  // --- Known test vector: AES-128-CBC (NIST-like) ---
  await describe('crypto: known test vectors', async () => {
    await it('AES-128-CBC: should produce known ciphertext', async () => {
      // Key and IV from refs/node/test/parallel/test-crypto-padding.js
      const key = Buffer.from('S3c.r.e.t.K.e.Y!', 'utf8'); // 16 bytes
      const iv = Buffer.from('blahFizz2011Buzz', 'utf8'); // 16 bytes

      const cipher = createCipheriv('aes-128-cbc', key, iv);
      let encrypted = cipher.update('Hello node world!', 'utf8', 'hex');
      encrypted += cipher.final('hex');

      expect(encrypted).toBe('7f57859550d4d2fdb9806da2a750461a9fe77253cd1cbd4b07beee4e070d561f');
    });

    await it('AES-128-CBC: should decrypt known ciphertext', async () => {
      const key = Buffer.from('S3c.r.e.t.K.e.Y!', 'utf8');
      const iv = Buffer.from('blahFizz2011Buzz', 'utf8');

      const decipher = createDecipheriv('aes-128-cbc', key, iv);
      let decrypted = decipher.update('7f57859550d4d2fdb9806da2a750461a9fe77253cd1cbd4b07beee4e070d561f', 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      expect(decrypted).toBe('Hello node world!');
    });

    await it('AES-128-CBC: 32-byte aligned plaintext', async () => {
      const key = Buffer.from('S3c.r.e.t.K.e.Y!', 'utf8');
      const iv = Buffer.from('blahFizz2011Buzz', 'utf8');

      const cipher = createCipheriv('aes-128-cbc', key, iv);
      let encrypted = cipher.update('Hello node world!AbC09876dDeFgHi', 'utf8', 'hex');
      encrypted += cipher.final('hex');

      expect(encrypted).toBe('7f57859550d4d2fdb9806da2a750461ab46e71b3d78ebe2d9684dfc87f7575b9886119866912cb8c7bcaf76c5ebc2378');
    });
  });

  // --- setAutoPadding ---
  await describe('crypto: setAutoPadding', async () => {
    await it('should support setAutoPadding(false) for block-aligned data', async () => {
      const key = Buffer.from('S3c.r.e.t.K.e.Y!', 'utf8');
      const iv = Buffer.from('blahFizz2011Buzz', 'utf8');
      const plaintext = 'Hello node world!AbC09876dDeFgHi'; // 32 bytes = 2 blocks

      const cipher = createCipheriv('aes-128-cbc', key, iv);
      cipher.setAutoPadding(false);
      let encrypted = cipher.update(plaintext, 'utf8', 'hex');
      encrypted += cipher.final('hex');

      // Without padding, 32 bytes of plaintext → 32 bytes of ciphertext
      expect(encrypted).toBe('7f57859550d4d2fdb9806da2a750461ab46e71b3d78ebe2d9684dfc87f7575b9');

      const decipher = createDecipheriv('aes-128-cbc', key, iv);
      decipher.setAutoPadding(false);
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      expect(decrypted).toBe(plaintext);
    });
  });

  // --- Multiple update calls ---
  await describe('crypto: multiple update calls', async () => {
    await it('should handle multiple update() calls', async () => {
      const key = Buffer.from('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'hex');
      const iv = Buffer.from('00112233445566778899aabbccddeeff', 'hex');

      const cipher = createCipheriv('aes-256-cbc', key, iv);
      let encrypted = '';
      encrypted += cipher.update('Hello ', 'utf8', 'hex');
      encrypted += cipher.update('World', 'utf8', 'hex');
      encrypted += cipher.update('!', 'utf8', 'hex');
      encrypted += cipher.final('hex');

      const decipher = createDecipheriv('aes-256-cbc', key, iv);
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      expect(decrypted).toBe('Hello World!');
    });
  });

  // --- Unicode data ---
  await describe('crypto: Unicode data', async () => {
    await it('should handle Unicode text', async () => {
      const key = Buffer.from('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'hex');
      const iv = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
      const plaintext = 'Héllo Wörld! 日本語 🎉';

      const cipher = createCipheriv('aes-256-cbc', key, iv);
      let encrypted = cipher.update(plaintext, 'utf8', 'hex');
      encrypted += cipher.final('hex');

      const decipher = createDecipheriv('aes-256-cbc', key, iv);
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      expect(decrypted).toBe(plaintext);
    });
  });

  // --- Base64 encoding ---
  await describe('crypto: base64 encoding', async () => {
    await it('should support base64 output encoding', async () => {
      const key = Buffer.from('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'hex');
      const iv = Buffer.from('00112233445566778899aabbccddeeff', 'hex');

      const cipher = createCipheriv('aes-256-cbc', key, iv);
      let encrypted = cipher.update('Base64 test', 'utf8', 'base64');
      encrypted += cipher.final('base64');

      const decipher = createDecipheriv('aes-256-cbc', key, iv);
      let decrypted = decipher.update(encrypted, 'base64', 'utf8');
      decrypted += decipher.final('utf8');

      expect(decrypted).toBe('Base64 test');
    });
  });
};
