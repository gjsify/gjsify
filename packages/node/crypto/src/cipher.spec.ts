import { describe, it, expect } from '@gjsify/unit';
import { getCiphers } from 'crypto';

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
};
