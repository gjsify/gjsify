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
  // Ported from refs/wpt/html/webappapis/structured-clone/structured-clone-battery-of-tests.js
  // Original: 3-Clause BSD license, web-platform-tests contributors.
  // Ported from refs/node-test/parallel/test-structuredClone-global.js
  // Original: MIT license, Node.js contributors.
  await describe('structuredClone', async () => {
    await it('should be a function', async () => {
      expect(typeof structuredClone).toBe('function');
    });

    // --- Primitives ---
    await describe('primitives', async () => {
      await it('should clone undefined', async () => {
        expect(structuredClone(undefined)).toBeUndefined();
      });

      await it('should clone null', async () => {
        expect(structuredClone(null)).toBeNull();
      });

      await it('should clone true and false', async () => {
        expect(structuredClone(true)).toBe(true);
        expect(structuredClone(false)).toBe(false);
      });

      await it('should clone strings', async () => {
        expect(structuredClone('')).toBe('');
        expect(structuredClone('hello')).toBe('hello');
        expect(structuredClone('\u0000')).toBe('\u0000');
        expect(structuredClone('\uD800')).toBe('\uD800');
        expect(structuredClone('\uDC00')).toBe('\uDC00');
        expect(structuredClone('\uDBFF\uDFFD')).toBe('\uDBFF\uDFFD');
      });

      await it('should clone numbers', async () => {
        expect(structuredClone(0)).toBe(0);
        expect(structuredClone(0.2)).toBe(0.2);
        expect(structuredClone(9007199254740992)).toBe(9007199254740992);
        expect(structuredClone(-9007199254740992)).toBe(-9007199254740992);
      });

      await it('should clone -0', async () => {
        const cloned = structuredClone(-0);
        expect(Object.is(cloned, -0)).toBe(true);
      });

      await it('should clone NaN', async () => {
        const cloned = structuredClone(NaN);
        expect(Number.isNaN(cloned)).toBe(true);
      });

      await it('should clone Infinity and -Infinity', async () => {
        expect(structuredClone(Infinity)).toBe(Infinity);
        expect(structuredClone(-Infinity)).toBe(-Infinity);
      });

      await it('should clone BigInt values', async () => {
        expect(structuredClone(0n)).toBe(0n);
        expect(structuredClone(-0n)).toBe(-0n);
        expect(structuredClone(-9007199254740994000n)).toBe(-9007199254740994000n);
      });
    });

    // --- Wrapper objects ---
    await describe('wrapper objects', async () => {
      await it('should clone Boolean objects', async () => {
        const original = new Boolean(true);
        const cloned = structuredClone(original);
        expect(cloned instanceof Boolean).toBe(true);
        expect(cloned !== original).toBe(true);
        expect(String(cloned)).toBe('true');
      });

      await it('should clone Boolean false object', async () => {
        const original = new Boolean(false);
        const cloned = structuredClone(original);
        expect(cloned instanceof Boolean).toBe(true);
        expect(String(cloned)).toBe('false');
      });

      await it('should clone String objects', async () => {
        const original = new String('hello');
        const cloned = structuredClone(original);
        expect(cloned instanceof String).toBe(true);
        expect(cloned !== original).toBe(true);
        expect(String(cloned)).toBe('hello');
      });

      await it('should clone Number objects', async () => {
        const original = new Number(42);
        const cloned = structuredClone(original);
        expect(cloned instanceof Number).toBe(true);
        expect(cloned !== original).toBe(true);
        expect(Number(cloned)).toBe(42);
      });

      await it('should clone Number(-0) object', async () => {
        const original = new Number(-0);
        const cloned = structuredClone(original);
        expect(cloned instanceof Number).toBe(true);
        expect(Object.is(Number(cloned), -0)).toBe(true);
      });

      await it('should clone BigInt wrapper object', async () => {
        const original = Object(-9007199254740994n);
        const cloned = structuredClone(original);
        expect(typeof cloned).toBe('object');
        expect(cloned !== original).toBe(true);
      });
    });

    // --- Date ---
    await describe('Date', async () => {
      await it('should clone Date objects', async () => {
        const original = new Date(1609459200000);
        const cloned = structuredClone(original);
        expect(cloned instanceof Date).toBe(true);
        expect(cloned !== original).toBe(true);
        expect(cloned.getTime()).toBe(original.getTime());
      });

      await it('should clone Date(0) and Date(-0)', async () => {
        expect(structuredClone(new Date(0)).getTime()).toBe(0);
        expect(structuredClone(new Date(-0)).getTime()).toBe(0);
      });

      await it('should clone edge-case dates', async () => {
        expect(structuredClone(new Date(-8.64e15)).getTime()).toBe(-8.64e15);
        expect(structuredClone(new Date(8.64e15)).getTime()).toBe(8.64e15);
      });
    });

    // --- RegExp ---
    await describe('RegExp', async () => {
      await it('should clone RegExp preserving flags', async () => {
        const original = /foo/gim;
        const cloned = structuredClone(original);
        expect(cloned instanceof RegExp).toBe(true);
        expect(cloned !== original).toBe(true);
        expect(cloned.source).toBe('foo');
        expect(cloned.global).toBe(true);
        expect(cloned.ignoreCase).toBe(true);
        expect(cloned.multiline).toBe(true);
      });

      await it('should reset lastIndex to 0', async () => {
        const original = /foo/g;
        original.lastIndex = 2;
        const cloned = structuredClone(original);
        expect(cloned.lastIndex).toBe(0);
      });

      await it('should clone sticky flag', async () => {
        const original = new RegExp('foo', 'y');
        const cloned = structuredClone(original);
        expect(cloned.sticky).toBe(true);
      });

      await it('should clone unicode flag', async () => {
        const original = new RegExp('foo', 'u');
        const cloned = structuredClone(original);
        expect(cloned.unicode).toBe(true);
      });

      await it('should clone empty RegExp', async () => {
        const cloned = structuredClone(new RegExp(''));
        expect(cloned instanceof RegExp).toBe(true);
      });
    });

    // --- Error types ---
    await describe('Error', async () => {
      await it('should clone empty Error', async () => {
        const cloned = structuredClone(new Error());
        expect(cloned instanceof Error).toBe(true);
        expect(cloned.message).toBe('');
      });

      await it('should clone Error with message', async () => {
        const original = new Error('test message');
        const cloned = structuredClone(original);
        expect(cloned instanceof Error).toBe(true);
        expect(cloned.message).toBe('test message');
        expect(cloned !== original).toBe(true);
      });

      await it('should clone Error with cause', async () => {
        const original = new Error('msg', { cause: 'my cause' });
        const cloned = structuredClone(original);
        expect(cloned.message).toBe('msg');
        expect((cloned as any).cause).toBe('my cause');
      });

      await it('should clone all error subtypes', async () => {
        const constructors = [EvalError, RangeError, ReferenceError, SyntaxError, TypeError, URIError];
        for (const Ctor of constructors) {
          const original = new Ctor('test');
          const cloned = structuredClone(original);
          expect(cloned instanceof Ctor).toBe(true);
          expect(cloned.message).toBe('test');
          expect(cloned.name).toBe(Ctor.name);
        }
      });

      await it('should not preserve custom properties on Error', async () => {
        const original = new Error('test') as any;
        original.foo = 'bar';
        const cloned = structuredClone(original) as any;
        expect(cloned.foo).toBeUndefined();
      });
    });

    // --- ArrayBuffer ---
    await describe('ArrayBuffer', async () => {
      await it('should clone ArrayBuffer', async () => {
        const original = new ArrayBuffer(16);
        const view = new Uint8Array(original);
        view[0] = 42;
        view[15] = 99;
        const cloned = structuredClone(original);
        expect(cloned instanceof ArrayBuffer).toBe(true);
        expect(cloned !== original).toBe(true);
        expect(cloned.byteLength).toBe(16);
        const clonedView = new Uint8Array(cloned);
        expect(clonedView[0]).toBe(42);
        expect(clonedView[15]).toBe(99);
      });

      await it('cloned ArrayBuffer should be independent', async () => {
        const original = new ArrayBuffer(4);
        new Uint8Array(original)[0] = 1;
        const cloned = structuredClone(original);
        new Uint8Array(original)[0] = 99;
        expect(new Uint8Array(cloned)[0]).toBe(1);
      });
    });

    // --- TypedArrays ---
    await describe('TypedArrays', async () => {
      await it('should clone Uint8Array', async () => {
        const original = new Uint8Array([1, 2, 3, 4]);
        const cloned = structuredClone(original);
        expect(cloned instanceof Uint8Array).toBe(true);
        expect(cloned !== original).toBe(true);
        expect(cloned.length).toBe(4);
        expect(cloned[0]).toBe(1);
        expect(cloned[3]).toBe(4);
      });

      await it('should clone Int16Array', async () => {
        const original = new Int16Array([-1, 0, 32767]);
        const cloned = structuredClone(original);
        expect(cloned instanceof Int16Array).toBe(true);
        expect(cloned[0]).toBe(-1);
        expect(cloned[2]).toBe(32767);
      });

      await it('should clone Float64Array', async () => {
        const original = new Float64Array([1.5, -0, NaN, Infinity]);
        const cloned = structuredClone(original);
        expect(cloned instanceof Float64Array).toBe(true);
        expect(cloned[0]).toBe(1.5);
        expect(Object.is(cloned[1], -0)).toBe(true);
        expect(Number.isNaN(cloned[2])).toBe(true);
        expect(cloned[3]).toBe(Infinity);
      });

      await it('should clone BigInt64Array', async () => {
        const original = new BigInt64Array([0n, -1n, 9007199254740993n]);
        const cloned = structuredClone(original);
        expect(cloned instanceof BigInt64Array).toBe(true);
        expect(cloned[0]).toBe(0n);
        expect(cloned[1]).toBe(-1n);
        expect(cloned[2]).toBe(9007199254740993n);
      });

      await it('cloned TypedArray should be independent', async () => {
        const original = new Uint8Array([10, 20]);
        const cloned = structuredClone(original);
        original[0] = 99;
        expect(cloned[0]).toBe(10);
      });
    });

    // --- DataView ---
    await describe('DataView', async () => {
      await it('should clone DataView', async () => {
        const buf = new ArrayBuffer(8);
        const original = new DataView(buf, 2, 4);
        original.setUint8(0, 42);
        const cloned = structuredClone(original);
        expect(cloned instanceof DataView).toBe(true);
        expect(cloned !== original).toBe(true);
        expect(cloned.byteOffset).toBe(2);
        expect(cloned.byteLength).toBe(4);
        expect(cloned.getUint8(0)).toBe(42);
      });
    });

    // --- Map ---
    await describe('Map', async () => {
      await it('should clone Map with entries', async () => {
        const original = new Map([['a', 1], ['b', 2]]);
        const cloned = structuredClone(original);
        expect(cloned instanceof Map).toBe(true);
        expect(cloned !== original).toBe(true);
        expect(cloned.size).toBe(2);
        expect(cloned.get('a')).toBe(1);
        expect(cloned.get('b')).toBe(2);
      });

      await it('should deep clone Map values', async () => {
        const inner = { x: 1 };
        const original = new Map([['key', inner]]);
        const cloned = structuredClone(original);
        expect(cloned.get('key') !== inner).toBe(true);
        expect((cloned.get('key') as any).x).toBe(1);
      });
    });

    // --- Set ---
    await describe('Set', async () => {
      await it('should clone Set with values', async () => {
        const original = new Set([1, 'two', 3]);
        const cloned = structuredClone(original);
        expect(cloned instanceof Set).toBe(true);
        expect(cloned !== original).toBe(true);
        expect(cloned.size).toBe(3);
        expect(cloned.has(1)).toBe(true);
        expect(cloned.has('two')).toBe(true);
        expect(cloned.has(3)).toBe(true);
      });

      await it('should deep clone Set values', async () => {
        const inner = { x: 1 };
        const original = new Set([inner]);
        const cloned = structuredClone(original);
        const clonedInner = [...cloned][0] as any;
        expect(clonedInner !== inner).toBe(true);
        expect(clonedInner.x).toBe(1);
      });
    });

    // --- Blob and File ---
    await describe('Blob and File', async () => {
      await it('should clone Blob preserving type and size', async () => {
        if (typeof Blob === 'undefined') return; // skip if Blob not available
        const original = new Blob(['hello'], { type: 'text/plain' });
        const cloned = structuredClone(original);
        expect(cloned instanceof Blob).toBe(true);
        expect(cloned !== original).toBe(true);
        expect(cloned.size).toBe(original.size);
        expect(cloned.type).toBe('text/plain');
      });

      await it('should clone File preserving name and lastModified', async () => {
        if (typeof File === 'undefined') return; // skip if File not available
        const original = new File(['data'], 'test.txt', { type: 'text/plain', lastModified: 1609459200000 });
        const cloned = structuredClone(original);
        expect(cloned instanceof File).toBe(true);
        expect(cloned !== original).toBe(true);
        expect(cloned.name).toBe('test.txt');
        expect(cloned.lastModified).toBe(1609459200000);
        expect(cloned.type).toBe('text/plain');
      });
    });

    // --- Circular and shared references ---
    await describe('circular and shared references', async () => {
      await it('should handle self-referencing object', async () => {
        const original: any = { name: 'self' };
        original.self = original;
        const cloned = structuredClone(original);
        expect(cloned !== original).toBe(true);
        expect(cloned.name).toBe('self');
        expect(cloned.self).toBe(cloned);
        expect(cloned.self !== original).toBe(true);
      });

      await it('should handle self-referencing array', async () => {
        const original: any[] = [1, 2];
        original.push(original);
        const cloned = structuredClone(original);
        expect(cloned !== original).toBe(true);
        expect(cloned[0]).toBe(1);
        expect(cloned[1]).toBe(2);
        expect(cloned[2]).toBe(cloned);
      });

      await it('should preserve shared references (identity)', async () => {
        const shared = { value: 42 };
        const original = { a: shared, b: shared };
        const cloned = structuredClone(original);
        expect(cloned.a !== shared).toBe(true);
        expect(cloned.a).toBe(cloned.b);
      });

      await it('should handle circular reference in Map', async () => {
        const original = new Map<string, any>();
        original.set('self', original);
        const cloned = structuredClone(original);
        expect(cloned !== original).toBe(true);
        expect(cloned.get('self')).toBe(cloned);
      });
    });

    // --- Prototype and property behavior ---
    await describe('prototype and property behavior', async () => {
      await it('should not clone prototype properties', async () => {
        class Foo { bar() { return 42; } }
        const original = new Foo();
        const cloned = structuredClone(original) as any;
        expect(cloned.bar).toBeUndefined();
      });

      await it('should not clone non-enumerable properties', async () => {
        const original: any = {};
        Object.defineProperty(original, 'hidden', { value: 42, enumerable: false });
        original.visible = 1;
        const cloned = structuredClone(original);
        expect((cloned as any).visible).toBe(1);
        expect((cloned as any).hidden).toBeUndefined();
      });

      await it('should deep clone nested objects in arrays', async () => {
        const original = [{ a: 1 }, { b: 2 }];
        const cloned = structuredClone(original);
        expect(cloned[0] !== original[0]).toBe(true);
        expect((cloned[0] as any).a).toBe(1);
        expect((cloned[1] as any).b).toBe(2);
      });

      await it('should clone sparse arrays', async () => {
        const original = [1, , 3] as any[]; // eslint-disable-line no-sparse-arrays
        const cloned = structuredClone(original);
        expect(cloned.length).toBe(3);
        expect(cloned[0]).toBe(1);
        expect(1 in cloned).toBe(false);
        expect(cloned[2]).toBe(3);
      });
    });

    // --- Non-cloneable types (DataCloneError) ---
    await describe('non-cloneable types', async () => {
      await it('should throw for functions', async () => {
        let threw = false;
        try {
          structuredClone((() => {}) as any);
        } catch (e: any) {
          threw = true;
          expect(e.name).toBe('DataCloneError');
        }
        expect(threw).toBe(true);
      });

      await it('should throw for symbols', async () => {
        let threw = false;
        try {
          structuredClone(Symbol('test') as any);
        } catch (e: any) {
          threw = true;
          expect(e.name).toBe('DataCloneError');
        }
        expect(threw).toBe(true);
      });

      await it('should throw for WeakMap', async () => {
        let threw = false;
        try {
          structuredClone(new WeakMap() as any);
        } catch (e: any) {
          threw = true;
          expect(e.name).toBe('DataCloneError');
        }
        expect(threw).toBe(true);
      });

      await it('should throw for WeakSet', async () => {
        let threw = false;
        try {
          structuredClone(new WeakSet() as any);
        } catch (e: any) {
          threw = true;
          expect(e.name).toBe('DataCloneError');
        }
        expect(threw).toBe(true);
      });

      await it('should throw for WeakRef', async () => {
        let threw = false;
        try {
          structuredClone(new WeakRef({}) as any);
        } catch (e: any) {
          threw = true;
          expect(e.name).toBe('DataCloneError');
        }
        expect(threw).toBe(true);
      });
    });

    // --- Complex nested structures ---
    await describe('nested structures', async () => {
      await it('should clone Maps containing Sets', async () => {
        const original = new Map([['items', new Set([1, 2, 3])]]);
        const cloned = structuredClone(original);
        const clonedSet = cloned.get('items') as Set<number>;
        expect(clonedSet instanceof Set).toBe(true);
        expect(clonedSet.size).toBe(3);
        expect(clonedSet.has(1)).toBe(true);
      });

      await it('should clone objects with mixed types', async () => {
        const original = {
          date: new Date(0),
          regexp: /test/gi,
          map: new Map([['key', 'value']]),
          set: new Set([1, 2]),
          nested: { arr: [1, new Uint8Array([10, 20])] },
        };
        const cloned = structuredClone(original);
        expect(cloned !== original).toBe(true);
        expect(cloned.date instanceof Date).toBe(true);
        expect(cloned.date.getTime()).toBe(0);
        expect(cloned.regexp instanceof RegExp).toBe(true);
        expect(cloned.regexp.source).toBe('test');
        expect(cloned.map instanceof Map).toBe(true);
        expect(cloned.map.get('key')).toBe('value');
        expect(cloned.set instanceof Set).toBe(true);
        expect(cloned.set.has(1)).toBe(true);
        expect((cloned.nested.arr[1] as Uint8Array)[0]).toBe(10);
      });
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
