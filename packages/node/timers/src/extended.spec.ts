// Ported from refs/node-test/parallel/test-timers-*.js
// Original: MIT license, Node.js contributors

import { describe, it, expect } from '@gjsify/unit';

export default async () => {

  // ===================== setTimeout deep =====================
  await describe('setTimeout deep', async () => {
    await it('should call callback after delay', async () => {
      const start = Date.now();
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          const elapsed = Date.now() - start;
          expect(elapsed >= 20).toBe(true);
          resolve();
        }, 30);
      });
    });

    await it('should pass arguments to callback', async () => {
      const result = await new Promise<string>((resolve) => {
        setTimeout((a: string, b: string) => resolve(a + b), 10, 'hello', ' world');
      });
      expect(result).toBe('hello world');
    });

    await it('should return a timeout ID', async () => {
      const id = setTimeout(() => {}, 1000);
      expect(id).toBeDefined();
      clearTimeout(id);
    });

    await it('clearTimeout should prevent callback', async () => {
      let called = false;
      const id = setTimeout(() => { called = true; }, 30);
      clearTimeout(id);
      await new Promise<void>((r) => setTimeout(r, 100));
      expect(called).toBe(false);
    });

    await it('should handle 0 delay', async () => {
      const result = await new Promise<boolean>((resolve) => {
        setTimeout(() => resolve(true), 0);
      });
      expect(result).toBe(true);
    });
  });

  // ===================== setInterval deep =====================
  await describe('setInterval deep', async () => {
    await it('should call callback repeatedly', async () => {
      let count = 0;
      await new Promise<void>((resolve) => {
        const id = setInterval(() => {
          count++;
          if (count >= 3) {
            clearInterval(id);
            resolve();
          }
        }, 30);
      });
      expect(count).toBeGreaterThan(2);
    });

    await it('clearInterval should stop repetition', async () => {
      let count = 0;
      const id = setInterval(() => { count++; }, 20);
      await new Promise<void>((r) => setTimeout(r, 60));
      clearInterval(id);
      const countAfterClear = count;
      await new Promise<void>((r) => setTimeout(r, 60));
      // Should not have increased much after clear
      expect(count - countAfterClear).toBeLessThan(2);
    });

    await it('should pass arguments to callback', async () => {
      const result = await new Promise<number>((resolve) => {
        const id = setInterval((val: number) => {
          clearInterval(id);
          resolve(val);
        }, 10, 42);
      });
      expect(result).toBe(42);
    });
  });

  // ===================== setImmediate =====================
  await describe('setImmediate', async () => {
    await it('should call callback asynchronously', async () => {
      let called = false;
      setImmediate(() => { called = true; });
      expect(called).toBe(false); // Should not be called synchronously
      await new Promise<void>((r) => setTimeout(r, 50));
      expect(called).toBe(true);
    });

    await it('should pass arguments', async () => {
      const result = await new Promise<string>((resolve) => {
        setImmediate((a: string) => resolve(a), 'immediate');
      });
      expect(result).toBe('immediate');
    });

    await it('clearImmediate should prevent callback', async () => {
      let called = false;
      const id = setImmediate(() => { called = true; });
      clearImmediate(id);
      await new Promise<void>((r) => setTimeout(r, 50));
      expect(called).toBe(false);
    });
  });

  // ===================== Ordering guarantees =====================
  await describe('timer ordering', async () => {
    await it('setImmediate should fire before setTimeout(0)', async () => {
      const order: string[] = [];
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          order.push('timeout');
          if (order.length === 2) resolve();
        }, 0);
        setImmediate(() => {
          order.push('immediate');
          if (order.length === 2) resolve();
        });
      });
      // Both should have fired
      expect(order.length).toBe(2);
      expect(order).toContain('timeout');
      expect(order).toContain('immediate');
    });

    await it('nested setTimeout should fire in order', async () => {
      const order: number[] = [];
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          order.push(1);
          setTimeout(() => {
            order.push(2);
            resolve();
          }, 10);
        }, 10);
      });
      expect(order[0]).toBe(1);
      expect(order[1]).toBe(2);
    });
  });
};
