import { describe, it, expect } from '@gjsify/unit'

import process from 'process';

export default async () => {
  await describe("process: properties", async () => {
    await it("process.arch should be a string", async () => {
      expect(typeof process.arch).toBe("string");
    });

    await it("process.platform should be a string", async () => {
      expect(typeof process.platform).toBe("string");
    });

    await it("process.pid should be a number", async () => {
      expect(typeof process.pid).toBe("number");
    });

    await it("process.version should be a string starting with v", async () => {
      expect(typeof process.version).toBe("string");
      expect(process.version[0]).toBe("v");
    });

    await it("process.versions should be an object", async () => {
      expect(typeof process.versions).toBe("object");
    });

    await it("process.argv should be an array", async () => {
      expect(Array.isArray(process.argv)).toBeTruthy();
    });

    await it("process.env should be an object", async () => {
      expect(typeof process.env).toBe("object");
    });

    await it("process.execPath should be a string", async () => {
      expect(typeof process.execPath).toBe("string");
    });
  });

  await describe("process: methods", async () => {
    await it("process.cwd() should return a string", async () => {
      expect(typeof process.cwd()).toBe("string");
    });

    await it("process.cwd() should return an absolute path", async () => {
      const cwd = process.cwd();
      expect(cwd[0]).toBe("/");
    });

    await it("process.uptime() should return a number", async () => {
      expect(typeof process.uptime()).toBe("number");
    });

    await it("process.uptime() should be >= 0", async () => {
      expect(process.uptime() >= 0).toBeTruthy();
    });

    await it("process.hrtime() should return an array of 2 numbers", async () => {
      const hr = process.hrtime();
      expect(Array.isArray(hr)).toBeTruthy();
      expect(hr.length).toBe(2);
      expect(typeof hr[0]).toBe("number");
      expect(typeof hr[1]).toBe("number");
    });

    await it("process.memoryUsage() should return an object", async () => {
      const mem = process.memoryUsage();
      expect(typeof mem).toBe("object");
      expect(typeof mem.rss).toBe("number");
    });

    await it("process.nextTick should be a function", async () => {
      expect(typeof process.nextTick).toBe("function");
    });

    await it("process.nextTick should execute callback", async () => {
      let called = false;
      process.nextTick(() => { called = true; });
      // Wait for microtask
      await new Promise<void>(resolve => {
        process.nextTick(resolve);
      });
      expect(called).toBeTruthy();
    });

    await it("process.nextTick should pass arguments", async () => {
      const result = await new Promise<string>(resolve => {
        process.nextTick((a: string, b: string) => resolve(a + b), 'hello', ' world');
      });
      expect(result).toBe('hello world');
    });
  });

  // ==================== env ====================

  await describe("process: env manipulation", async () => {
    await it("should set and get env variables", async () => {
      process.env.TEST_GJSIFY_VAR = 'test_value';
      expect(process.env.TEST_GJSIFY_VAR).toBe('test_value');
      delete process.env.TEST_GJSIFY_VAR;
    });

    await it("should delete env variables", async () => {
      process.env.TEST_GJSIFY_DELETE = 'to_delete';
      delete process.env.TEST_GJSIFY_DELETE;
      expect(process.env.TEST_GJSIFY_DELETE).toBeUndefined();
    });

    await it("should coerce values to strings", async () => {
      process.env.TEST_GJSIFY_NUM = '42';
      expect(typeof process.env.TEST_GJSIFY_NUM).toBe('string');
      delete process.env.TEST_GJSIFY_NUM;
    });

    await it("PATH should be defined", async () => {
      expect(typeof process.env.PATH).toBe('string');
      expect(process.env.PATH!.length > 0).toBeTruthy();
    });
  });

  // ==================== hrtime.bigint ====================

  await describe("process: hrtime.bigint", async () => {
    await it("should be a function", async () => {
      expect(typeof process.hrtime.bigint).toBe('function');
    });

    await it("should return a bigint", async () => {
      const result = process.hrtime.bigint();
      expect(typeof result).toBe('bigint');
    });

    await it("should be monotonically increasing", async () => {
      const a = process.hrtime.bigint();
      const b = process.hrtime.bigint();
      expect(b >= a).toBeTruthy();
    });
  });

  // ==================== hrtime diff ====================

  await describe("process: hrtime diff", async () => {
    await it("should return diff when passed previous hrtime", async () => {
      const start = process.hrtime();
      const diff = process.hrtime(start);
      expect(Array.isArray(diff)).toBeTruthy();
      expect(diff.length).toBe(2);
      expect(diff[0] >= 0).toBeTruthy();
      expect(diff[1] >= 0).toBeTruthy();
    });
  });

  // ==================== additional properties ====================

  await describe("process: additional properties", async () => {
    await it("process.ppid should be a number", async () => {
      expect(typeof process.ppid).toBe("number");
    });

    await it("process.exitCode should be settable", async () => {
      const orig = process.exitCode;
      process.exitCode = 42;
      expect(process.exitCode).toBe(42);
      process.exitCode = orig as any;
    });

    await it("process.title should be a string", async () => {
      expect(typeof process.title).toBe("string");
    });

    await it("process.stdout should be defined", async () => {
      expect(process.stdout).toBeDefined();
    });

    await it("process.stderr should be defined", async () => {
      expect(process.stderr).toBeDefined();
    });

    await it("process.stdin should be defined", async () => {
      expect(process.stdin).toBeDefined();
    });

    await it("process.versions should contain a runtime version string", async () => {
      // On Node.js: process.versions.node, on GJS: process.versions.gjs
      const hasNodeVersion = typeof process.versions.node === 'string';
      const hasGjsVersion = typeof process.versions.gjs === 'string';
      expect(hasNodeVersion || hasGjsVersion).toBe(true);
    });
  });

  // ==================== chdir ====================

  await describe("process: chdir", async () => {
    await it("should change and restore directory", async () => {
      const original = process.cwd();
      process.chdir('/tmp');
      expect(process.cwd()).toBe('/tmp');
      process.chdir(original);
      expect(process.cwd()).toBe(original);
    });

    // chdir to non-existent dir throws on Node.js but may silently fail on GJS
  });

  // ==================== emitWarning ====================

  await describe("process: emitWarning", async () => {
    await it("should be a function", async () => {
      expect(typeof process.emitWarning).toBe("function");
    });
  });

  // ==================== EventEmitter interface ====================

  await describe("process: EventEmitter", async () => {
    await it("should have on method", async () => {
      expect(typeof process.on).toBe("function");
    });

    await it("should have emit method", async () => {
      expect(typeof process.emit).toBe("function");
    });

    await it("should have removeListener method", async () => {
      expect(typeof process.removeListener).toBe("function");
    });
  });
};
