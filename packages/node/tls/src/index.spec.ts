import { describe, it, expect } from '@gjsify/unit';
import { DEFAULT_MIN_VERSION, DEFAULT_MAX_VERSION, createSecureContext } from 'tls';

export default async () => {
  await describe('tls', async () => {
    await it('should export TLS version constants', async () => {
      expect(DEFAULT_MIN_VERSION).toBe('TLSv1.2');
      expect(DEFAULT_MAX_VERSION).toBe('TLSv1.3');
    });

    await it('should have createSecureContext', async () => {
      expect(typeof createSecureContext).toBe('function');
      const ctx = createSecureContext();
      expect(ctx).toBeDefined();
    });
  });
};
