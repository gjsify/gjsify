import { describe, it, expect } from '@gjsify/unit';
import { createHash, getHashes } from 'crypto';

export default async () => {
  await describe('crypto.createHash', async () => {
    await it('should hash empty string with sha256', async () => {
      const hash = createHash('sha256').update('').digest('hex');
      expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    });

    await it('should hash "hello" with sha256', async () => {
      const hash = createHash('sha256').update('hello').digest('hex');
      expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    });

    await it('should hash "hello" with md5', async () => {
      const hash = createHash('md5').update('hello').digest('hex');
      expect(hash).toBe('5d41402abc4b2a76b9719d911017c592');
    });

    await it('should hash "hello" with sha1', async () => {
      const hash = createHash('sha1').update('hello').digest('hex');
      expect(hash).toBe('aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d');
    });

    await it('should hash "hello" with sha512', async () => {
      const hash = createHash('sha512').update('hello').digest('hex');
      expect(hash).toBe('9b71d224bd62f3785d96d46ad3ea3d73319bfbc2890caadae2dff72519673ca72323c3d99ba5c11d7c7acc6e14b8c5da0c4663475c2e5c3adef46f73bcdec043');
    });

    await it('should support multiple update calls', async () => {
      const hash = createHash('sha256')
        .update('hello')
        .update(' ')
        .update('world')
        .digest('hex');
      const expected = createHash('sha256').update('hello world').digest('hex');
      expect(hash).toBe(expected);
    });

    await it('should return Buffer when no encoding specified', async () => {
      const result = createHash('md5').update('test').digest();
      expect(result).toBeDefined();
      expect(result.length).toBe(16);
    });

    await it('should support base64 encoding', async () => {
      const hash = createHash('sha256').update('hello').digest('base64');
      expect(typeof hash).toBe('string');
      expect(hash.length).toBeGreaterThan(0);
    });

    await it('should throw on unknown algorithm', async () => {
      let threw = false;
      try {
        createHash('unknown');
      } catch (e: any) {
        threw = true;
        expect(e.code).toBe('ERR_CRYPTO_HASH_UNKNOWN');
      }
      expect(threw).toBe(true);
    });

    await it('should throw when digest called twice', async () => {
      const hash = createHash('sha256').update('test');
      hash.digest();
      let threw = false;
      try {
        hash.digest();
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });
  });

  await describe('crypto.getHashes', async () => {
    await it('should return an array of supported algorithms', async () => {
      const hashes = getHashes();
      expect(hashes).toContain('sha256');
      expect(hashes).toContain('md5');
      expect(hashes).toContain('sha1');
      expect(hashes).toContain('sha512');
    });
  });
};
