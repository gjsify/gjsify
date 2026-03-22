import { describe, it, expect } from '@gjsify/unit';
import { createInterface, clearLine, clearScreenDown, cursorTo, moveCursor } from 'readline';
import { Readable } from 'stream';

export default async () => {
  await describe('readline', async () => {
    await it('should export createInterface as a function', async () => {
      expect(typeof createInterface).toBe('function');
    });

    await it('should create an interface with input stream', async () => {
      const input = new Readable({ read() {} });
      const rl = createInterface({ input });
      expect(rl).toBeDefined();
      expect(typeof rl.close).toBe('function');
      rl.close();
    });

    await it('should export utility functions', async () => {
      expect(typeof clearLine).toBe('function');
      expect(typeof clearScreenDown).toBe('function');
      expect(typeof cursorTo).toBe('function');
      expect(typeof moveCursor).toBe('function');
    });
  });
};
