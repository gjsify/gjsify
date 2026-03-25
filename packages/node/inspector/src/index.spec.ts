import { describe, it, expect } from '@gjsify/unit';
import { Session, open, close, url, waitForDebugger } from 'node:inspector';

export default async () => {
  await describe('inspector', async () => {
    await it('should export Session class', async () => {
      expect(Session).toBeDefined();
    });

    await it('should create a Session instance', async () => {
      const session = new Session();
      expect(session).toBeDefined();
      expect(typeof session.connect).toBe('function');
      expect(typeof session.disconnect).toBe('function');
      expect(typeof session.post).toBe('function');
    });

    await it('should export open as a function', async () => {
      expect(typeof open).toBe('function');
    });

    await it('should export close as a function', async () => {
      expect(typeof close).toBe('function');
    });

    await it('should return undefined from url()', async () => {
      expect(url()).toBeUndefined();
    });

    await it('should export waitForDebugger as a function', async () => {
      expect(typeof waitForDebugger).toBe('function');
    });
  });
};
