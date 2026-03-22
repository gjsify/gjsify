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
  });
};
