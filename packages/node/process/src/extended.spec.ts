// Ported from refs/node-test/parallel/test-process-*.js
// Original: MIT license, Node.js contributors

import { describe, it, expect } from '@gjsify/unit';
import process from 'node:process';

export default async () => {

  // ===================== Signal handling =====================
  await describe('process signal handling', async () => {
    await it('should support registering SIGTERM handler', async () => {
      let handlerCalled = false;
      const handler = () => { handlerCalled = true; };
      process.on('SIGTERM', handler);
      expect(process.listenerCount('SIGTERM')).toBeGreaterThan(0);
      process.removeListener('SIGTERM', handler);
    });

    await it('should support registering SIGINT handler', async () => {
      const handler = () => {};
      process.on('SIGINT', handler);
      expect(process.listenerCount('SIGINT')).toBeGreaterThan(0);
      process.removeListener('SIGINT', handler);
    });
  });

  // ===================== process.stdout/stderr =====================
  await describe('process.stdout and process.stderr', async () => {
    await it('process.stdout should exist', async () => {
      expect(process.stdout).toBeDefined();
    });

    await it('process.stderr should exist', async () => {
      expect(process.stderr).toBeDefined();
    });

    await it('process.stdout should have write method', async () => {
      expect(typeof process.stdout.write).toBe('function');
    });

    await it('process.stderr should have write method', async () => {
      expect(typeof process.stderr.write).toBe('function');
    });
  });

  // ===================== process.stdin =====================
  await describe('process.stdin', async () => {
    await it('should exist', async () => {
      expect(process.stdin).toBeDefined();
    });
  });

  // ===================== process.nextTick ordering =====================
  await describe('process.nextTick ordering', async () => {
    await it('should execute callbacks in FIFO order', async () => {
      const order: number[] = [];
      await new Promise<void>((resolve) => {
        process.nextTick(() => { order.push(1); });
        process.nextTick(() => { order.push(2); });
        process.nextTick(() => {
          order.push(3);
          resolve();
        });
      });
      expect(order[0]).toBe(1);
      expect(order[1]).toBe(2);
      expect(order[2]).toBe(3);
    });

    await it('should pass arguments to callback', async () => {
      const result = await new Promise<string>((resolve) => {
        process.nextTick((a: string, b: string) => {
          resolve(a + b);
        }, 'hello', ' world');
      });
      expect(result).toBe('hello world');
    });
  });

  // ===================== process.env deep =====================
  await describe('process.env deep', async () => {
    await it('should support setting and deleting env vars', async () => {
      process.env.TEST_GJSIFY_VAR = 'test_value';
      expect(process.env.TEST_GJSIFY_VAR).toBe('test_value');
      delete process.env.TEST_GJSIFY_VAR;
      expect(process.env.TEST_GJSIFY_VAR).toBeUndefined();
    });

    await it('should coerce non-string values to strings', async () => {
      (process.env as any).TEST_NUM = 42;
      expect(typeof process.env.TEST_NUM).toBe('string');
      expect(process.env.TEST_NUM).toBe('42');
      delete process.env.TEST_NUM;
    });

    await it('should enumerate env vars with Object.keys', async () => {
      const keys = Object.keys(process.env);
      expect(keys.length).toBeGreaterThan(0);
      // PATH or HOME should be present
      const hasCommon = keys.includes('PATH') || keys.includes('HOME') || keys.includes('USER');
      expect(hasCommon).toBe(true);
    });
  });

  // ===================== process.hrtime =====================
  await describe('process.hrtime deep', async () => {
    await it('hrtime should return [seconds, nanoseconds]', async () => {
      const hr = process.hrtime();
      expect(Array.isArray(hr)).toBe(true);
      expect(hr.length).toBe(2);
      expect(typeof hr[0]).toBe('number');
      expect(typeof hr[1]).toBe('number');
      expect(hr[0]).toBeGreaterThan(-1);
      expect(hr[1]).toBeGreaterThan(-1);
    });

    await it('hrtime diff should measure elapsed time', async () => {
      const start = process.hrtime();
      // Small busy wait
      let sum = 0;
      for (let i = 0; i < 100000; i++) sum += i;
      const diff = process.hrtime(start);
      expect(diff[0]).toBeGreaterThan(-1);
      // Total nanoseconds should be positive
      const totalNs = diff[0] * 1e9 + diff[1];
      expect(totalNs).toBeGreaterThan(0);
    });

    await it('hrtime.bigint should return bigint', async () => {
      const t = process.hrtime.bigint();
      expect(typeof t).toBe('bigint');
      expect(t > 0n).toBe(true);
    });

    await it('hrtime.bigint should be monotonic', async () => {
      const a = process.hrtime.bigint();
      const b = process.hrtime.bigint();
      expect(b >= a).toBe(true);
    });
  });

  // ===================== process.memoryUsage =====================
  await describe('process.memoryUsage deep', async () => {
    await it('should return object with expected fields', async () => {
      const mem = process.memoryUsage();
      expect(typeof mem).toBe('object');
      expect(typeof mem.rss).toBe('number');
      expect(typeof mem.heapTotal).toBe('number');
      expect(typeof mem.heapUsed).toBe('number');
      expect(typeof mem.external).toBe('number');
    });

    await it('rss should be positive', async () => {
      const mem = process.memoryUsage();
      expect(mem.rss).toBeGreaterThan(0);
    });

    await it('heapUsed should be less than or equal to heapTotal', async () => {
      const mem = process.memoryUsage();
      expect(mem.heapUsed <= mem.heapTotal).toBe(true);
    });
  });

  // ===================== process.cpuUsage =====================
  await describe('process.cpuUsage deep', async () => {
    await it('should return user and system times', async () => {
      const usage = process.cpuUsage();
      expect(typeof usage.user).toBe('number');
      expect(typeof usage.system).toBe('number');
    });

    await it('should accept previous value for delta', async () => {
      const prev = process.cpuUsage();
      // Do some work
      let sum = 0;
      for (let i = 0; i < 100000; i++) sum += i;
      const delta = process.cpuUsage(prev);
      expect(typeof delta.user).toBe('number');
      expect(typeof delta.system).toBe('number');
      // Delta user time should be non-negative
      expect(delta.user >= 0).toBe(true);
    });
  });

  // ===================== process.emitWarning =====================
  await describe('process.emitWarning', async () => {
    await it('should be a function', async () => {
      expect(typeof process.emitWarning).toBe('function');
    });
  });

  // ===================== process.versions =====================
  await describe('process.versions deep', async () => {
    await it('should have versions object', async () => {
      expect(typeof process.versions).toBe('object');
      expect(process.versions !== null).toBe(true);
    });

    await it('should have v8 or gjs version', async () => {
      // On Node.js: v8 exists. On GJS: may have gjs or modules
      const hasEngine = process.versions.v8 !== undefined ||
                        (process.versions as any).gjs !== undefined ||
                        process.versions.modules !== undefined;
      expect(hasEngine).toBe(true);
    });
  });

  // ===================== process.config =====================
  await describe('process.config', async () => {
    await it('should be an object', async () => {
      expect(typeof process.config).toBe('object');
    });
  });
};
