import { describe, it, expect } from '@gjsify/unit';
import timers from 'timers';

export default async () => {
  await describe('timers', async () => {
    await describe('setTimeout', async () => {
      await it('should call callback after delay', async () => {
        const result = await new Promise<string>((resolve) => {
          timers.setTimeout(() => resolve('done'), 10);
        });
        expect(result).toBe('done');
      });

      await it('should pass arguments to callback', async () => {
        const result = await new Promise<string>((resolve) => {
          timers.setTimeout((a: string, b: string) => resolve(a + b), 10, 'hello', ' world');
        });
        expect(result).toBe('hello world');
      });

      await it('should return a Timeout object with ref/unref/hasRef', async () => {
        const timeout = timers.setTimeout(() => {}, 1000);
        expect(timeout.hasRef()).toBe(true);
        timeout.unref();
        expect(timeout.hasRef()).toBe(false);
        timeout.ref();
        expect(timeout.hasRef()).toBe(true);
        timers.clearTimeout(timeout);
      });
    });

    await describe('clearTimeout', async () => {
      await it('should cancel a pending timeout', async () => {
        let called = false;
        const timeout = timers.setTimeout(() => { called = true; }, 10);
        timers.clearTimeout(timeout);
        await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 50));
        expect(called).toBe(false);
      });
    });

    await describe('setInterval', async () => {
      await it('should call callback repeatedly', async () => {
        let count = 0;
        const interval = timers.setInterval(() => { count++; }, 10);
        await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 55));
        timers.clearInterval(interval);
        expect(count).toBeGreaterThan(1);
      });
    });

    await describe('setImmediate', async () => {
      await it('should call callback on next tick', async () => {
        const result = await new Promise<string>((resolve) => {
          timers.setImmediate(() => resolve('immediate'));
        });
        expect(result).toBe('immediate');
      });

      await it('should pass arguments to callback', async () => {
        const result = await new Promise<number>((resolve) => {
          timers.setImmediate((a: number, b: number) => resolve(a + b), 1, 2);
        });
        expect(result).toBe(3);
      });
    });

    await describe('clearImmediate', async () => {
      await it('should cancel a pending immediate', async () => {
        let called = false;
        const immediate = timers.setImmediate(() => { called = true; });
        timers.clearImmediate(immediate);
        await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 50));
        expect(called).toBe(false);
      });
    });

    // Ported from refs/node/test/parallel/test-timers-clear-null-does-not-throw-error.js
    await describe('clearTimeout/clearInterval with null/undefined', async () => {
      await it('clearTimeout(null) should not throw', async () => {
        expect(() => timers.clearTimeout(null as any)).not.toThrow();
      });

      await it('clearTimeout(undefined) should not throw', async () => {
        expect(() => timers.clearTimeout(undefined as any)).not.toThrow();
      });

      await it('clearInterval(null) should not throw', async () => {
        expect(() => timers.clearInterval(null as any)).not.toThrow();
      });

      await it('clearInterval(undefined) should not throw', async () => {
        expect(() => timers.clearInterval(undefined as any)).not.toThrow();
      });

      await it('clearImmediate(null) should not throw', async () => {
        expect(() => timers.clearImmediate(null as any)).not.toThrow();
      });
    });

    await describe('setTimeout with 0 delay', async () => {
      await it('should execute with 0 delay', async () => {
        const result = await new Promise<string>((resolve) => {
          timers.setTimeout(() => resolve('zero'), 0);
        });
        expect(result).toBe('zero');
      });
    });

    await describe('Timeout properties', async () => {
      await it('should have refresh method', async () => {
        const timeout = timers.setTimeout(() => {}, 1000);
        expect(typeof timeout.refresh).toBe('function');
        timers.clearTimeout(timeout);
      });

      await it('refresh should return the same object', async () => {
        const timeout = timers.setTimeout(() => {}, 1000);
        const result = timeout.refresh();
        expect(result === timeout).toBeTruthy();
        timers.clearTimeout(timeout);
      });

      await it('should have close method (alias for clearTimeout)', async () => {
        const timeout = timers.setTimeout(() => {}, 1000);
        expect(typeof timeout.close).toBe('function');
        timeout.close();
      });
    });

    await describe('Immediate properties', async () => {
      await it('should have ref/unref/hasRef', async () => {
        const immediate = timers.setImmediate(() => {});
        expect(typeof immediate.ref).toBe('function');
        expect(typeof immediate.unref).toBe('function');
        expect(typeof immediate.hasRef).toBe('function');
        timers.clearImmediate(immediate);
      });
    });

    await describe('setInterval stops on clearInterval', async () => {
      await it('should stop calling after clearInterval', async () => {
        let count = 0;
        const interval = timers.setInterval(() => { count++; }, 10);
        await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 35));
        timers.clearInterval(interval);
        const countAfterClear = count;
        await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 50));
        expect(count).toBe(countAfterClear);
      });
    });
  });
};
