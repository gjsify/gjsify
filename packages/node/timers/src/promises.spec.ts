import { describe, it, expect } from '@gjsify/unit';
import { setTimeout, setImmediate, setInterval } from 'timers/promises';

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

      await it('should resolve with undefined when no value', async () => {
        const result = await setTimeout(10);
        expect(result).toBeUndefined();
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

      await it('should reject when signal is aborted during wait', async () => {
        const controller = new AbortController();
        globalThis.setTimeout(() => controller.abort(), 10);
        let threw = false;
        try {
          await setTimeout(1000, undefined, { signal: controller.signal });
        } catch (e: any) {
          threw = true;
          expect(e.name).toBe('AbortError');
        }
        expect(threw).toBe(true);
      });

      await it('should accept 0 delay', async () => {
        const result = await setTimeout(0, 'zero');
        expect(result).toBe('zero');
      });
    });

    await describe('setImmediate', async () => {
      await it('should resolve with value', async () => {
        const result = await setImmediate(42);
        expect(result).toBe(42);
      });

      await it('should resolve with undefined when no value', async () => {
        const result = await setImmediate();
        expect(result).toBeUndefined();
      });

      await it('should reject when signal is already aborted', async () => {
        const controller = new AbortController();
        controller.abort();
        let threw = false;
        try {
          await setImmediate(undefined, { signal: controller.signal });
        } catch (e: any) {
          threw = true;
          expect(e.name).toBe('AbortError');
        }
        expect(threw).toBe(true);
      });
    });

    await describe('setInterval', async () => {
      await it('should be an async generator', async () => {
        const controller = new AbortController();
        const iter = setInterval(10, 'tick', { signal: controller.signal });
        expect(typeof iter[Symbol.asyncIterator]).toBe('function');
        controller.abort();
      });

      await it('should yield values at intervals', async () => {
        const controller = new AbortController();
        const values: string[] = [];
        try {
          for await (const val of setInterval(15, 'tick', { signal: controller.signal })) {
            values.push(val);
            if (values.length >= 3) {
              controller.abort();
            }
          }
        } catch (e: any) {
          expect(e.name).toBe('AbortError');
        }
        expect(values.length).toBe(3);
        expect(values[0]).toBe('tick');
      });

      await it('should reject immediately when signal is already aborted', async () => {
        const controller = new AbortController();
        controller.abort();
        let threw = false;
        try {
          for await (const _ of setInterval(10, 'tick', { signal: controller.signal })) {
            // Should not reach here
          }
        } catch (e: any) {
          threw = true;
          expect(e.name).toBe('AbortError');
        }
        expect(threw).toBe(true);
      });
    });

    await describe('exports', async () => {
      await it('should export setTimeout as a function', async () => {
        expect(typeof setTimeout).toBe('function');
      });

      await it('should export setImmediate as a function', async () => {
        expect(typeof setImmediate).toBe('function');
      });

      await it('should export setInterval as a function', async () => {
        expect(typeof setInterval).toBe('function');
      });
    });
  });
};
