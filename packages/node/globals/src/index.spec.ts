import { describe, it, expect } from '@gjsify/unit';

export default async () => {

  // --- global / globalThis ---
  await describe('global', async () => {
    await it('should be the same as globalThis', async () => {
      expect((globalThis as any).global).toBe(globalThis);
    });

    await it('globalThis should be defined', async () => {
      expect(globalThis).toBeDefined();
    });
  });

  // --- process ---
  await describe('process', async () => {
    await it('should be defined on globalThis', async () => {
      expect(typeof (globalThis as any).process).toBe('object');
    });

    await it('should have env', async () => {
      expect(typeof (globalThis as any).process.env).toBe('object');
    });

    await it('should have cwd function', async () => {
      expect(typeof (globalThis as any).process.cwd).toBe('function');
    });

    await it('should have platform property', async () => {
      expect(typeof (globalThis as any).process.platform).toBe('string');
    });

    await it('should have argv array', async () => {
      expect(Array.isArray((globalThis as any).process.argv)).toBe(true);
    });

    await it('should have pid number', async () => {
      expect(typeof (globalThis as any).process.pid).toBe('number');
    });
  });

  // --- Buffer ---
  await describe('Buffer', async () => {
    await it('should be defined on globalThis', async () => {
      expect(typeof (globalThis as any).Buffer).toBe('function');
    });

    await it('should create a buffer from string', async () => {
      const buf = (globalThis as any).Buffer.from('hello');
      expect(buf.toString()).toBe('hello');
    });

    await it('should have alloc method', async () => {
      expect(typeof (globalThis as any).Buffer.alloc).toBe('function');
    });

    await it('should have isBuffer method', async () => {
      expect(typeof (globalThis as any).Buffer.isBuffer).toBe('function');
    });
  });

  // --- setImmediate / clearImmediate ---
  await describe('setImmediate', async () => {
    await it('should be a function', async () => {
      expect(typeof setImmediate).toBe('function');
    });

    await it('should call the callback asynchronously', async () => {
      const result = await new Promise<string>((resolve) => {
        setImmediate(() => resolve('called'));
      });
      expect(result).toBe('called');
    });

    await it('should pass arguments to callback', async () => {
      const result = await new Promise<number>((resolve) => {
        setImmediate((a: number, b: number) => resolve(a + b), 2, 3);
      });
      expect(result).toBe(5);
    });
  });

  await describe('clearImmediate', async () => {
    await it('should be a function', async () => {
      expect(typeof clearImmediate).toBe('function');
    });

    await it('should cancel a pending setImmediate', async () => {
      let called = false;
      const id = setImmediate(() => { called = true; });
      clearImmediate(id);
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      expect(called).toBe(false);
    });
  });

  // --- setTimeout / clearTimeout ---
  await describe('setTimeout (global)', async () => {
    await it('should be a function', async () => {
      expect(typeof setTimeout).toBe('function');
    });

    await it('should call callback after delay', async () => {
      const result = await new Promise<string>((resolve) => {
        setTimeout(() => resolve('timeout'), 10);
      });
      expect(result).toBe('timeout');
    });
  });

  await describe('clearTimeout (global)', async () => {
    await it('should be a function', async () => {
      expect(typeof clearTimeout).toBe('function');
    });
  });

  // --- setInterval / clearInterval ---
  await describe('setInterval (global)', async () => {
    await it('should be a function', async () => {
      expect(typeof setInterval).toBe('function');
    });
  });

  await describe('clearInterval (global)', async () => {
    await it('should be a function', async () => {
      expect(typeof clearInterval).toBe('function');
    });
  });

  // --- queueMicrotask ---
  await describe('queueMicrotask', async () => {
    await it('should be a function', async () => {
      expect(typeof queueMicrotask).toBe('function');
    });

    await it('should execute callback as a microtask', async () => {
      const result = await new Promise<string>((resolve) => {
        queueMicrotask(() => resolve('microtask'));
      });
      expect(result).toBe('microtask');
    });
  });

  // --- structuredClone ---
  await describe('structuredClone', async () => {
    await it('should be a function', async () => {
      expect(typeof structuredClone).toBe('function');
    });

    await it('should deep clone an object', async () => {
      const original = { a: 1, b: { c: 2 } };
      const clone = structuredClone(original);
      expect(clone.a).toBe(1);
      expect(clone.b.c).toBe(2);
      expect(clone !== original).toBe(true);
      expect(clone.b !== original.b).toBe(true);
    });

    await it('should clone arrays', async () => {
      const original = [1, 2, { x: 3 }];
      const clone = structuredClone(original);
      expect(clone.length).toBe(3);
      expect((clone[2] as any).x).toBe(3);
      expect(clone !== original).toBe(true);
    });
  });

  // --- TextEncoder / TextDecoder ---
  await describe('TextEncoder', async () => {
    await it('should be a function', async () => {
      expect(typeof TextEncoder).toBe('function');
    });

    await it('should encode a string to Uint8Array', async () => {
      const encoder = new TextEncoder();
      const encoded = encoder.encode('hello');
      expect(encoded instanceof Uint8Array).toBe(true);
      expect(encoded.length).toBe(5);
    });
  });

  await describe('TextDecoder', async () => {
    await it('should be a function', async () => {
      expect(typeof TextDecoder).toBe('function');
    });

    await it('should decode Uint8Array to string', async () => {
      const decoder = new TextDecoder();
      const decoded = decoder.decode(new Uint8Array([104, 101, 108, 108, 111]));
      expect(decoded).toBe('hello');
    });
  });

  // --- atob / btoa ---
  await describe('atob / btoa', async () => {
    await it('btoa should be a function', async () => {
      expect(typeof btoa).toBe('function');
    });

    await it('atob should be a function', async () => {
      expect(typeof atob).toBe('function');
    });

    await it('should round-trip encode/decode', async () => {
      const encoded = btoa('Hello, World!');
      expect(typeof encoded).toBe('string');
      expect(atob(encoded)).toBe('Hello, World!');
    });
  });

  // --- URL / URLSearchParams ---
  await describe('URL (global)', async () => {
    await it('should be a function', async () => {
      expect(typeof URL).toBe('function');
    });

    await it('should parse a URL', async () => {
      const url = new URL('https://example.com/path?key=val');
      expect(url.hostname).toBe('example.com');
      expect(url.pathname).toBe('/path');
    });
  });

  await describe('URLSearchParams (global)', async () => {
    await it('should be a function', async () => {
      expect(typeof URLSearchParams).toBe('function');
    });
  });

  // --- Error.captureStackTrace ---
  await describe('Error.captureStackTrace', async () => {
    await it('should be a function', async () => {
      expect(typeof (Error as any).captureStackTrace).toBe('function');
    });

    await it('should add a stack property to the target object', async () => {
      const obj: any = {};
      (Error as any).captureStackTrace(obj);
      expect(typeof obj.stack).toBe('string');
    });
  });

  // --- console ---
  await describe('console (global)', async () => {
    await it('should be an object', async () => {
      expect(typeof console).toBe('object');
    });

    await it('should have log/warn/error methods', async () => {
      expect(typeof console.log).toBe('function');
      expect(typeof console.warn).toBe('function');
      expect(typeof console.error).toBe('function');
    });
  });
};
