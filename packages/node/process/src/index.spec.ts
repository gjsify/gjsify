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
  });
};
