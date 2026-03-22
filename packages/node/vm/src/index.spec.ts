import { describe, it, expect } from '@gjsify/unit';
import { runInThisContext, createContext, isContext, Script } from 'vm';

export default async () => {
  await describe('vm', async () => {
    await it('should export runInThisContext as a function', async () => {
      expect(typeof runInThisContext).toBe('function');
    });

    await it('should evaluate code in this context', async () => {
      const result = runInThisContext('1 + 1');
      expect(result).toBe(2);
    });

    await it('should create a context', async () => {
      const ctx = createContext({ a: 1 });
      expect(ctx.a).toBe(1);
    });

    await it('should return false for isContext', async () => {
      expect(isContext({})).toBe(false);
    });

    await it('should create a Script instance', async () => {
      const script = new Script('1 + 2');
      expect(script).toBeDefined();
      expect(typeof script.runInThisContext).toBe('function');
    });

    await it('should run Script in this context', async () => {
      const script = new Script('1 + 2');
      const result = script.runInThisContext();
      expect(result).toBe(3);
    });
  });
};
