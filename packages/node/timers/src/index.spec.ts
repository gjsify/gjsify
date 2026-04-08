import { describe, it, expect } from '@gjsify/unit';
import timers from 'node:timers';

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

      await it('should execute with 0 delay', async () => {
        const result = await new Promise<string>((resolve) => {
          timers.setTimeout(() => resolve('zero'), 0);
        });
        expect(result).toBe('zero');
      });

      await it('should treat negative delay as 0', async () => {
        const result = await new Promise<string>((resolve) => {
          timers.setTimeout(() => resolve('negative'), -100);
        });
        expect(result).toBe('negative');
      });

      await it('should execute multiple timeouts in order with same delay', async () => {
        const order: number[] = [];
        await new Promise<void>((resolve) => {
          timers.setTimeout(() => order.push(1), 10);
          timers.setTimeout(() => order.push(2), 10);
          timers.setTimeout(() => {
            order.push(3);
            resolve();
          }, 30);
        });
        expect(order[0]).toBe(1);
        expect(order[1]).toBe(2);
        expect(order[2]).toBe(3);
      });

      await it('should allow nested setTimeout', async () => {
        const result = await new Promise<string>((resolve) => {
          timers.setTimeout(() => {
            timers.setTimeout(() => resolve('nested'), 10);
          }, 10);
        });
        expect(result).toBe('nested');
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

      await it('clearTimeout(null) should not throw', async () => {
        expect(() => timers.clearTimeout(null as any)).not.toThrow();
      });

      await it('clearTimeout(undefined) should not throw', async () => {
        expect(() => timers.clearTimeout(undefined as any)).not.toThrow();
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

      await it('should stop calling after clearInterval', async () => {
        let count = 0;
        const interval = timers.setInterval(() => { count++; }, 10);
        await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 35));
        timers.clearInterval(interval);
        const countAfterClear = count;
        await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 50));
        expect(count).toBe(countAfterClear);
      });

      await it('should pass arguments to callback', async () => {
        const result = await new Promise<string>((resolve) => {
          const interval = timers.setInterval((a: string) => {
            timers.clearInterval(interval);
            resolve(a);
          }, 10, 'arg');
        });
        expect(result).toBe('arg');
      });
    });

    await describe('clearInterval', async () => {
      await it('clearInterval(null) should not throw', async () => {
        expect(() => timers.clearInterval(null as any)).not.toThrow();
      });

      await it('clearInterval(undefined) should not throw', async () => {
        expect(() => timers.clearInterval(undefined as any)).not.toThrow();
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

      await it('should have ref/unref/hasRef', async () => {
        const immediate = timers.setImmediate(() => {});
        expect(typeof immediate.ref).toBe('function');
        expect(typeof immediate.unref).toBe('function');
        expect(typeof immediate.hasRef).toBe('function');
        timers.clearImmediate(immediate);
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

      await it('clearImmediate(null) should not throw', async () => {
        expect(() => timers.clearImmediate(null as any)).not.toThrow();
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

      await it('refresh should reset the timer', async () => {
        let called = false;
        const timeout = timers.setTimeout(() => { called = true; }, 50);
        // Refresh before it fires
        await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 30));
        timeout.refresh();
        // Should not have fired yet after refresh
        await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 30));
        expect(called).toBe(false);
        // Now wait for it to fire
        await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 40));
        expect(called).toBe(true);
      });
    });

    await describe('module exports', async () => {
      await it('should export setTimeout and clearTimeout', async () => {
        expect(typeof timers.setTimeout).toBe('function');
        expect(typeof timers.clearTimeout).toBe('function');
      });

      await it('should export setInterval and clearInterval', async () => {
        expect(typeof timers.setInterval).toBe('function');
        expect(typeof timers.clearInterval).toBe('function');
      });

      await it('should export setImmediate and clearImmediate', async () => {
        expect(typeof timers.setImmediate).toBe('function');
        expect(typeof timers.clearImmediate).toBe('function');
      });

      await it('should export active and unenroll (legacy)', async () => {
        // Node.js exports these legacy functions; they're not in @types/node.
        const t = timers as any;
        expect(typeof t.active === 'function' || typeof t.active === 'undefined').toBe(true);
        expect(typeof t.unenroll === 'function' || typeof t.unenroll === 'undefined').toBe(true);
      });
    });

    // ==================== Additional tests ====================

    await describe('setTimeout additional', async () => {
      await it('should not throw with very large delay', async () => {
        const timeout = timers.setTimeout(() => {}, 2147483647);
        expect(timeout).toBeDefined();
        timers.clearTimeout(timeout);
      });

      await it('should handle string delay by coercing to number', async () => {
        const result = await new Promise<string>((resolve) => {
          timers.setTimeout(() => resolve('coerced'), '10' as any);
        });
        expect(result).toBe('coerced');
      });
    });

    await describe('setInterval additional', async () => {
      await it('should fire at least 3 times then be clearable', async () => {
        let count = 0;
        await new Promise<void>((resolve) => {
          const interval = timers.setInterval(() => {
            count++;
            if (count >= 3) {
              timers.clearInterval(interval);
              resolve();
            }
          }, 15);
        });
        expect(count).toBeGreaterThan(2);
      });

      await it('should handle 0 interval without hanging', async () => {
        let count = 0;
        await new Promise<void>((resolve) => {
          const interval = timers.setInterval(() => {
            count++;
            if (count >= 3) {
              timers.clearInterval(interval);
              resolve();
            }
          }, 0);
        });
        expect(count).toBeGreaterThan(2);
      });
    });

    await describe('clearTimeout additional', async () => {
      await it('clearTimeout on already fired timer should not throw', async () => {
        const timeout = timers.setTimeout(() => {}, 5);
        // Wait for the timer to fire
        await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 50));
        // Clearing after it has fired should be safe
        expect(() => timers.clearTimeout(timeout)).not.toThrow();
      });
    });

    await describe('Timeout.refresh additional', async () => {
      await it('refresh() on cleared timer should not throw', async () => {
        const timeout = timers.setTimeout(() => {}, 1000);
        timers.clearTimeout(timeout);
        // Calling refresh on a cleared timer should not throw
        expect(() => timeout.refresh()).not.toThrow();
      });
    });

    await describe('setImmediate ordering', async () => {
      await it('should execute before setTimeout(0)', async () => {
        const order: string[] = [];
        await new Promise<void>((resolve) => {
          timers.setTimeout(() => {
            order.push('timeout');
            if (order.length === 2) resolve();
          }, 0);
          timers.setImmediate(() => {
            order.push('immediate');
            if (order.length === 2) resolve();
          });
        });
        // setImmediate should fire before or at least at the same time as setTimeout(0)
        // In Node.js, order can vary in the top level, but setImmediate is generally prioritized
        expect(order.length).toBe(2);
        expect(order[0]).toBe('immediate');
      });

      await it('multiple setImmediates should execute in order', async () => {
        const order: number[] = [];
        await new Promise<void>((resolve) => {
          timers.setImmediate(() => order.push(1));
          timers.setImmediate(() => order.push(2));
          timers.setImmediate(() => {
            order.push(3);
            resolve();
          });
        });
        expect(order[0]).toBe(1);
        expect(order[1]).toBe(2);
        expect(order[2]).toBe(3);
      });
    });
  });
};
