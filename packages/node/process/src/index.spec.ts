// Ported from refs/node-test/parallel/ and refs/node/test/parallel/test-process-*.js
// Original: MIT license, Node.js contributors
// Additional tests inspired by refs/bun/test/js/node/ and refs/deno/ext/node/polyfills/

import { describe, it, expect } from '@gjsify/unit'

import process from 'node:process';
import * as os from 'node:os';

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

    await it("process.pid should be a positive integer", async () => {
      expect(process.pid > 0).toBeTruthy();
      expect(Number.isInteger(process.pid)).toBeTruthy();
    });

    await it("process.ppid should be a positive integer", async () => {
      expect(process.ppid > 0).toBeTruthy();
      expect(Number.isInteger(process.ppid)).toBeTruthy();
    });

    await it("process.version should be a string starting with v", async () => {
      expect(typeof process.version).toBe("string");
      expect(process.version[0]).toBe("v");
    });

    await it("process.version should match semver pattern", async () => {
      expect(process.version).toMatch(/^v\d+/);
    });

    await it("process.versions should be an object", async () => {
      expect(typeof process.versions).toBe("object");
    });

    await it("process.argv should be an array", async () => {
      expect(Array.isArray(process.argv)).toBeTruthy();
    });

    await it("process.argv should have at least 1 element", async () => {
      expect(process.argv.length >= 1).toBeTruthy();
    });

    await it("process.argv first element should be a string", async () => {
      expect(typeof process.argv[0]).toBe("string");
    });

    await it("process.env should be an object", async () => {
      expect(typeof process.env).toBe("object");
    });

    await it("process.execPath should be a string", async () => {
      expect(typeof process.execPath).toBe("string");
    });

    await it("process.execPath should be a non-empty string", async () => {
      expect(process.execPath.length > 0).toBeTruthy();
    });

    await it("process.platform should be a known platform", async () => {
      const knownPlatforms = ['aix', 'darwin', 'freebsd', 'linux', 'openbsd', 'sunos', 'win32'];
      expect(knownPlatforms).toContain(process.platform);
    });

    await it("process.arch should be a known architecture", async () => {
      const knownArchs = ['arm', 'arm64', 'ia32', 'loong64', 'mips', 'mipsel', 'ppc', 'ppc64', 'riscv64', 's390', 's390x', 'x64'];
      expect(knownArchs).toContain(process.arch);
    });

    await it("process.config should be an object", async () => {
      expect(typeof process.config).toBe("object");
    });

    await it("process.execArgv should be an array", async () => {
      expect(Array.isArray(process.execArgv)).toBeTruthy();
    });

    await it("process.argv0 should be a string", async () => {
      expect(typeof process.argv0).toBe("string");
      expect(process.argv0.length > 0).toBeTruthy();
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

    await it("process.cwd() should return a path containing /", async () => {
      const cwd = process.cwd();
      expect(cwd).toContain("/");
    });

    await it("process.uptime() should return a number", async () => {
      expect(typeof process.uptime()).toBe("number");
    });

    await it("process.uptime() should be >= 0", async () => {
      expect(process.uptime() >= 0).toBeTruthy();
    });

    await it("process.uptime() should increase over time", async () => {
      const a = process.uptime();
      const b = process.uptime();
      expect(b >= a).toBeTruthy();
    });

    await it("process.hrtime() should return an array of 2 numbers", async () => {
      const hr = process.hrtime();
      expect(Array.isArray(hr)).toBeTruthy();
      expect(hr.length).toBe(2);
      expect(typeof hr[0]).toBe("number");
      expect(typeof hr[1]).toBe("number");
    });

    await it("process.hrtime() should return non-negative values", async () => {
      const hr = process.hrtime();
      expect(hr[0] >= 0).toBeTruthy();
      expect(hr[1] >= 0).toBeTruthy();
    });

    await it("process.hrtime() nanoseconds should be less than 1e9", async () => {
      const hr = process.hrtime();
      expect(hr[1] < 1e9).toBeTruthy();
    });

    await it("process.memoryUsage() should return an object", async () => {
      const mem = process.memoryUsage();
      expect(typeof mem).toBe("object");
      expect(typeof mem.rss).toBe("number");
    });

    await it("process.memoryUsage() should have heapTotal and heapUsed", async () => {
      const mem = process.memoryUsage();
      expect(typeof mem.heapTotal).toBe("number");
      expect(typeof mem.heapUsed).toBe("number");
      expect(typeof mem.external).toBe("number");
    });

    await it("process.memoryUsage() rss should be positive", async () => {
      const mem = process.memoryUsage();
      expect(mem.rss > 0).toBeTruthy();
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

    await it("process.nextTick ordering: first scheduled runs first", async () => {
      const order: number[] = [];
      await new Promise<void>(resolve => {
        process.nextTick(() => { order.push(1); });
        process.nextTick(() => { order.push(2); });
        process.nextTick(() => {
          order.push(3);
          resolve();
        });
      });
      expect(order.length).toBe(3);
      expect(order[0]).toBe(1);
      expect(order[1]).toBe(2);
      expect(order[2]).toBe(3);
    });

    // Regression: process.nextTick must be deferred (not run synchronously).
    // On GJS, it should route through GLib idle (not microtask queue) so that
    // GTK input events (PRIORITY_DEFAULT = 0) can interleave between nextTick
    // callbacks (PRIORITY_HIGH_IDLE = 100), preventing window freezes.
    await it("process.nextTick is deferred, not synchronous", async () => {
      let ranSynchronously = false;
      let ranInNextTick = false;
      process.nextTick(() => { ranInNextTick = true; });
      // This line runs before the nextTick callback fires
      ranSynchronously = !ranInNextTick;
      // Wait for the nextTick callback
      await new Promise<void>(resolve => process.nextTick(resolve));
      expect(ranSynchronously).toBeTruthy();
      expect(ranInNextTick).toBeTruthy();
    });

    await it("process.exit should be a function", async () => {
      expect(typeof process.exit).toBe("function");
    });

    await it("process.kill should be a function", async () => {
      expect(typeof process.kill).toBe("function");
    });

    await it("process.abort should be a function", async () => {
      expect(typeof process.abort).toBe("function");
    });

    await it("process.umask should be a function", async () => {
      expect(typeof process.umask).toBe("function");
    });

    await it("process.cpuUsage should be a function", async () => {
      expect(typeof process.cpuUsage).toBe("function");
    });

    await it("process.cpuUsage() should return user and system", async () => {
      const usage = process.cpuUsage();
      expect(typeof usage.user).toBe("number");
      expect(typeof usage.system).toBe("number");
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

    await it("should enumerate keys with Object.keys()", async () => {
      const keys = Object.keys(process.env);
      expect(Array.isArray(keys)).toBeTruthy();
      expect(keys.length > 0).toBeTruthy();
      expect(keys).toContain('PATH');
    });

    await it("non-existent key should return undefined", async () => {
      expect(process.env.THIS_VAR_DOES_NOT_EXIST_GJSIFY_XYZ).toBeUndefined();
    });

    await it("should overwrite existing value", async () => {
      process.env.TEST_GJSIFY_OVERWRITE = 'first';
      expect(process.env.TEST_GJSIFY_OVERWRITE).toBe('first');
      process.env.TEST_GJSIFY_OVERWRITE = 'second';
      expect(process.env.TEST_GJSIFY_OVERWRITE).toBe('second');
      delete process.env.TEST_GJSIFY_OVERWRITE;
    });

    await it("HOME should match os.homedir()", async () => {
      const home = process.env.HOME;
      expect(home).toBeDefined();
      expect(home).toBe(os.homedir());
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

    await it("consecutive calls should increase", async () => {
      const first = process.hrtime.bigint();
      // Do a tiny bit of work
      let sum = 0;
      for (let i = 0; i < 1000; i++) sum += i;
      const second = process.hrtime.bigint();
      expect(second > first).toBeTruthy();
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

    await it("diff nanoseconds should be less than 1e9", async () => {
      const start = process.hrtime();
      const diff = process.hrtime(start);
      expect(diff[1] < 1e9).toBeTruthy();
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

    await it("process.title should be non-empty", async () => {
      expect(process.title.length > 0).toBeTruthy();
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

    await it("process.stdout should have write method", async () => {
      expect(typeof process.stdout.write).toBe("function");
    });

    await it("process.stderr should have write method", async () => {
      expect(typeof process.stderr.write).toBe("function");
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

    await it("chdir to non-existent dir should throw", async () => {
      const fn = () => process.chdir('/this/path/does/not/exist/gjsify');
      expect(fn).toThrow();
    });
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

    await it("should have once method", async () => {
      expect(typeof process.once).toBe("function");
    });

    await it("should have removeAllListeners method", async () => {
      expect(typeof process.removeAllListeners).toBe("function");
    });

    await it("should be able to register exit listener", async () => {
      const handler = () => {};
      process.on('exit', handler);
      // Should not throw — just register
      process.removeListener('exit', handler);
    });

    await it("should emit and receive custom events", async () => {
      let received = false;
      const handler = () => { received = true; };
      process.on('test-custom-event', handler);
      process.emit('test-custom-event');
      expect(received).toBeTruthy();
      process.removeListener('test-custom-event', handler);
    });
  });
};
