import { describe, it, expect } from '@gjsify/unit';
import { setTimeout, setImmediate } from 'timers/promises';

export default async () => {
  await describe('timers/promises', async () => {
    await describe('setTimeout', async () => {
      await it('should resolve after delay', async () => {
        const start = Date.now();
        await setTimeout(20);
        const elapsed = Date.now() - start;
        expect(elapsed).toBeGreaterThan(10);
      });

      await it('should resolve with value', async () => {
        const result = await setTimeout(10, 'hello');
        expect(result).toBe('hello');
      });

      await it('should reject when signal is already aborted', async () => {
        const controller = new AbortController();
        controller.abort();
        let threw = false;
        try {
          await setTimeout(10, undefined, { signal: controller.signal });
        } catch (e: any) {
          threw = true;
          expect(e.name).toBe('AbortError');
        }
        expect(threw).toBe(true);
      });
    });

    await describe('setImmediate', async () => {
      await it('should resolve with value', async () => {
        const result = await setImmediate(42);
        expect(result).toBe(42);
      });
    });
  });
};
