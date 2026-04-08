// Ported from refs/node-test/parallel/test-util-inspect.js,
// test-util-format.js, test-util-types.js, test-util-callbackify.js
// Original: MIT license, Node.js contributors

import { describe, it, expect } from '@gjsify/unit';
import * as util from 'node:util';

export default async () => {

  // ===================== inspect.colors =====================
  await describe('util.inspect.colors', async () => {
    await it('should be an object', async () => {
      expect(typeof util.inspect.colors).toBe('object');
    });

    await it('should have standard color entries', async () => {
      const colors = util.inspect.colors;
      expect(colors.red).toBeDefined();
      expect(colors.green).toBeDefined();
      expect(colors.yellow).toBeDefined();
      expect(colors.blue).toBeDefined();
      expect(colors.cyan).toBeDefined();
      expect(colors.magenta).toBeDefined();
      expect(colors.white).toBeDefined();
      expect(colors.gray).toBeDefined();
    });

    await it('each color should be [open, close] pair', async () => {
      const red = util.inspect.colors.red;
      expect(Array.isArray(red)).toBe(true);
      expect(red.length).toBe(2);
      expect(typeof red[0]).toBe('number');
      expect(typeof red[1]).toBe('number');
    });

    await it('should have bold/dim/underline modifiers', async () => {
      expect(util.inspect.colors.bold).toBeDefined();
      expect(util.inspect.colors.dim).toBeDefined();
      expect(util.inspect.colors.underline).toBeDefined();
    });

    await it('should have bright color variants', async () => {
      expect(util.inspect.colors.redBright).toBeDefined();
      expect(util.inspect.colors.greenBright).toBeDefined();
      expect(util.inspect.colors.cyanBright).toBeDefined();
    });

    await it('should have background colors', async () => {
      expect(util.inspect.colors.bgRed).toBeDefined();
      expect(util.inspect.colors.bgGreen).toBeDefined();
      expect(util.inspect.colors.bgBlue).toBeDefined();
    });
  });

  // ===================== inspect.styles =====================
  await describe('util.inspect.styles', async () => {
    await it('should be an object', async () => {
      expect(typeof util.inspect.styles).toBe('object');
    });

    await it('should map type names to color names', async () => {
      const styles = util.inspect.styles;
      expect(typeof styles.string).toBe('string');
      expect(typeof styles.number).toBe('string');
      expect(typeof styles.boolean).toBe('string');
      expect(typeof styles.undefined).toBe('string');
      expect(typeof styles.null).toBe('string');
    });

    await it('string style should be green', async () => {
      expect(util.inspect.styles.string).toBe('green');
    });

    await it('number style should be yellow', async () => {
      expect(util.inspect.styles.number).toBe('yellow');
    });
  });

  // ===================== inspect.custom =====================
  await describe('util.inspect.custom', async () => {
    await it('should be a symbol', async () => {
      expect(typeof util.inspect.custom).toBe('symbol');
    });

    await it('should equal Symbol.for nodejs.util.inspect.custom', async () => {
      const expected = Symbol.for('nodejs.util.inspect.custom');
      // @types/node declares inspect.custom as a nominal unique symbol, so direct
      // === comparison with a Symbol.for() lookup is reported as non-overlapping.
      expect((util.inspect.custom as symbol) === expected).toBe(true);
    });

    await it('should use custom inspect method', async () => {
      const obj = {
        [util.inspect.custom]() {
          return 'custom-output';
        },
      };
      const result = util.inspect(obj);
      expect(result).toBe('custom-output');
    });
  });

  // ===================== inspect.defaultOptions =====================
  await describe('util.inspect.defaultOptions', async () => {
    await it('should have expected default values', async () => {
      const opts = util.inspect.defaultOptions;
      expect(opts.showHidden).toBe(false);
      expect(opts.depth).toBe(2);
      expect(opts.colors).toBe(false);
      expect(typeof opts.maxArrayLength).toBe('number');
      expect(typeof opts.breakLength).toBe('number');
    });
  });

  // ===================== inspect edge cases =====================
  await describe('util.inspect edge cases', async () => {
    await it('should inspect null', async () => {
      expect(util.inspect(null)).toBe('null');
    });

    await it('should inspect undefined', async () => {
      expect(util.inspect(undefined)).toBe('undefined');
    });

    await it('should inspect numbers', async () => {
      expect(util.inspect(42)).toBe('42');
      expect(util.inspect(0)).toBe('0');
      expect(util.inspect(-1)).toBe('-1');
      expect(util.inspect(Infinity)).toBe('Infinity');
      expect(util.inspect(NaN)).toBe('NaN');
    });

    await it('should inspect strings with quotes', async () => {
      const result = util.inspect('hello');
      expect(result.includes('hello')).toBe(true);
    });

    await it('should inspect booleans', async () => {
      expect(util.inspect(true)).toBe('true');
      expect(util.inspect(false)).toBe('false');
    });

    await it('should inspect BigInt', async () => {
      expect(util.inspect(42n)).toBe('42n');
    });

    await it('should inspect Symbol', async () => {
      const result = util.inspect(Symbol('test'));
      expect(result).toBe('Symbol(test)');
    });

    await it('should inspect functions', async () => {
      function foo() {}
      const result = util.inspect(foo);
      expect(result).toContain('Function');
      expect(result).toContain('foo');
    });

    await it('should inspect anonymous functions', async () => {
      const result = util.inspect(() => {});
      expect(result).toContain('Function');
    });

    await it('should inspect arrays', async () => {
      const result = util.inspect([1, 2, 3]);
      expect(result).toContain('1');
      expect(result).toContain('2');
      expect(result).toContain('3');
    });

    await it('should inspect empty object', async () => {
      expect(util.inspect({})).toBe('{}');
    });

    await it('should inspect Date', async () => {
      const d = new Date('2025-01-01T00:00:00.000Z');
      const result = util.inspect(d);
      expect(result).toContain('2025');
    });

    await it('should inspect RegExp', async () => {
      const result = util.inspect(/test/gi);
      expect(result).toContain('test');
    });

    await it('should inspect Error', async () => {
      const result = util.inspect(new Error('oops'));
      // Error inspect format varies between platforms
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    await it('should inspect Map', async () => {
      const result = util.inspect(new Map([['a', 1]]));
      expect(result).toContain('Map');
    });

    await it('should inspect Set', async () => {
      const result = util.inspect(new Set([1, 2]));
      expect(result).toContain('Set');
    });

    await it('should respect depth option', async () => {
      const deep = { a: { b: { c: { d: 'deep' } } } };
      const shallow = util.inspect(deep, { depth: 0 });
      expect(shallow).toContain('[Object]');
    });
  });

  // ===================== format edge cases =====================
  await describe('util.format edge cases', async () => {
    await it('should handle %% as literal percent with args', async () => {
      // %% only produces single % when formatting is applied (with extra args)
      expect(util.format('100%%', 'extra')).toBe('100% extra');
    });

    await it('should handle %s with various types', async () => {
      expect(util.format('%s', 'hello')).toBe('hello');
      expect(util.format('%s', 42)).toBe('42');
      expect(util.format('%s', true)).toBe('true');
      expect(util.format('%s', null)).toBe('null');
      expect(util.format('%s', undefined)).toBe('undefined');
    });

    await it('should handle %d for numbers', async () => {
      expect(util.format('%d', 42)).toBe('42');
      expect(util.format('%d', '42')).toBe('42');
    });

    await it('should handle %j for JSON', async () => {
      expect(util.format('%j', { a: 1 })).toBe('{"a":1}');
      expect(util.format('%j', [1, 2])).toBe('[1,2]');
    });

    await it('should append extra args', async () => {
      const result = util.format('a', 'b', 'c');
      expect(result).toBe('a b c');
    });

    await it('should handle no format string', async () => {
      const result = util.format(42, 'hello');
      expect(result).toContain('42');
      expect(result).toContain('hello');
    });

    await it('should return empty string for no args', async () => {
      expect(util.format()).toBe('');
    });

    await it('should handle %i for integer', async () => {
      expect(util.format('%i', 42.9)).toBe('42');
    });

    await it('should handle %f for float', async () => {
      expect(util.format('%f', 42.5)).toBe('42.5');
    });
  });

  // ===================== util.types =====================
  await describe('util.types', async () => {
    await it('isDate should detect Date', async () => {
      expect(util.types.isDate(new Date())).toBe(true);
      expect(util.types.isDate('2025-01-01')).toBe(false);
      expect(util.types.isDate({})).toBe(false);
    });

    await it('isRegExp should detect RegExp', async () => {
      expect(util.types.isRegExp(/test/)).toBe(true);
      expect(util.types.isRegExp('test')).toBe(false);
    });

    await it('isMap should detect Map', async () => {
      expect(util.types.isMap(new Map())).toBe(true);
      expect(util.types.isMap({})).toBe(false);
    });

    await it('isSet should detect Set', async () => {
      expect(util.types.isSet(new Set())).toBe(true);
      expect(util.types.isSet([])).toBe(false);
    });

    await it('isPromise should detect Promise', async () => {
      expect(util.types.isPromise(Promise.resolve())).toBe(true);
      expect(util.types.isPromise({ then() {} })).toBe(false);
    });

    await it('isArrayBuffer should detect ArrayBuffer', async () => {
      expect(util.types.isArrayBuffer(new ArrayBuffer(8))).toBe(true);
      expect(util.types.isArrayBuffer(new Uint8Array(8))).toBe(false);
    });

    await it('isTypedArray should detect typed arrays', async () => {
      expect(util.types.isTypedArray(new Uint8Array(1))).toBe(true);
      expect(util.types.isTypedArray(new Float32Array(1))).toBe(true);
      expect(util.types.isTypedArray(new Int32Array(1))).toBe(true);
      expect(util.types.isTypedArray([])).toBe(false);
    });

    await it('isAsyncFunction should detect async functions', async () => {
      expect(util.types.isAsyncFunction(async () => {})).toBe(true);
      expect(util.types.isAsyncFunction(() => {})).toBe(false);
    });

    await it('isGeneratorFunction should detect generators', async () => {
      function* gen() { yield 1; }
      expect(util.types.isGeneratorFunction(gen)).toBe(true);
      expect(util.types.isGeneratorFunction(() => {})).toBe(false);
    });

    await it('isWeakMap should detect WeakMap', async () => {
      expect(util.types.isWeakMap(new WeakMap())).toBe(true);
      expect(util.types.isWeakMap(new Map())).toBe(false);
    });

    await it('isWeakSet should detect WeakSet', async () => {
      expect(util.types.isWeakSet(new WeakSet())).toBe(true);
      expect(util.types.isWeakSet(new Set())).toBe(false);
    });

    await it('isDataView should detect DataView', async () => {
      expect(util.types.isDataView(new DataView(new ArrayBuffer(8)))).toBe(true);
      expect(util.types.isDataView(new ArrayBuffer(8))).toBe(false);
    });
  });

  // ===================== promisify =====================
  await describe('util.promisify', async () => {
    await it('should convert callback function to promise', async () => {
      function asyncOp(val: string, cb: (err: Error | null, result: string) => void) {
        setTimeout(() => cb(null, val.toUpperCase()), 10);
      }
      const promisified = util.promisify(asyncOp);
      const result = await promisified('hello');
      expect(result).toBe('HELLO');
    });

    await it('should reject on error', async () => {
      function failOp(cb: (err: Error) => void) {
        setTimeout(() => cb(new Error('fail')), 10);
      }
      const promisified = util.promisify(failOp);
      let caught = false;
      try {
        await promisified();
      } catch {
        caught = true;
      }
      expect(caught).toBe(true);
    });

    await it('should respect custom promisify symbol', async () => {
      function custom(cb: (err: Error | null) => void) {
        cb(null);
      }
      (custom as any)[util.promisify.custom] = () => Promise.resolve('custom-result');
      const promisified = util.promisify(custom);
      const result = await promisified();
      expect(result).toBe('custom-result');
    });
  });

  // ===================== callbackify =====================
  await describe('util.callbackify', async () => {
    await it('should convert async function to callback style', async () => {
      async function asyncFn() { return 'result'; }
      const callbackified = util.callbackify(asyncFn);
      const result = await new Promise<string>((resolve, reject) => {
        callbackified((err: Error | null, val: string) => {
          if (err) reject(err);
          else resolve(val);
        });
      });
      expect(result).toBe('result');
    });

    await it('should pass error for rejected promise', async () => {
      async function failFn() { throw new Error('async-error'); }
      const callbackified = util.callbackify(failFn);
      const err = await new Promise<Error>((resolve) => {
        callbackified((err: Error | null) => {
          resolve(err!);
        });
      });
      expect(err instanceof Error).toBe(true);
    });
  });

  // ===================== deprecate =====================
  await describe('util.deprecate', async () => {
    await it('should return a function', async () => {
      const deprecated = util.deprecate(() => 42, 'deprecated');
      expect(typeof deprecated).toBe('function');
    });

    await it('deprecated function should preserve behavior', async () => {
      const deprecated = util.deprecate(() => 42, 'deprecated');
      expect(deprecated()).toBe(42);
    });
  });

  // ===================== inherits =====================
  await describe('util.inherits', async () => {
    await it('should set up prototype chain', async () => {
      function Parent(this: any) { this.name = 'parent'; }
      Parent.prototype.greet = function() { return 'hello'; };
      function Child(this: any) { (Parent as any).call(this); }
      util.inherits(Child as any, Parent as any);
      const child = new (Child as any)();
      expect(child.greet()).toBe('hello');
      expect(child instanceof (Child as any)).toBe(true);
    });

    await it('should set super_ property', async () => {
      function A() {}
      function B() {}
      util.inherits(B as any, A as any);
      expect((B as any).super_).toBe(A);
    });
  });

  // ===================== isDeepStrictEqual =====================
  await describe('util.isDeepStrictEqual', async () => {
    await it('should compare primitives', async () => {
      expect(util.isDeepStrictEqual(1, 1)).toBe(true);
      expect(util.isDeepStrictEqual(1, 2)).toBe(false);
      expect(util.isDeepStrictEqual('a', 'a')).toBe(true);
      expect(util.isDeepStrictEqual(true, true)).toBe(true);
      expect(util.isDeepStrictEqual(true, false)).toBe(false);
    });

    await it('should compare objects deeply', async () => {
      expect(util.isDeepStrictEqual({ a: 1 }, { a: 1 })).toBe(true);
      expect(util.isDeepStrictEqual({ a: 1 }, { a: 2 })).toBe(false);
      expect(util.isDeepStrictEqual({ a: { b: 1 } }, { a: { b: 1 } })).toBe(true);
    });

    await it('should compare arrays', async () => {
      expect(util.isDeepStrictEqual([1, 2, 3], [1, 2, 3])).toBe(true);
      expect(util.isDeepStrictEqual([1, 2], [1, 2, 3])).toBe(false);
    });

    await it('should compare Date objects', async () => {
      const d1 = new Date('2025-01-01');
      const d2 = new Date('2025-01-01');
      const d3 = new Date('2025-12-31');
      expect(util.isDeepStrictEqual(d1, d2)).toBe(true);
      expect(util.isDeepStrictEqual(d1, d3)).toBe(false);
    });

    await it('should compare RegExp', async () => {
      expect(util.isDeepStrictEqual(/abc/g, /abc/g)).toBe(true);
      expect(util.isDeepStrictEqual(/abc/g, /abc/i)).toBe(false);
    });

    await it('should distinguish null and undefined', async () => {
      expect(util.isDeepStrictEqual(null, undefined)).toBe(false);
      expect(util.isDeepStrictEqual(null, null)).toBe(true);
    });
  });

  // ===================== TextEncoder/TextDecoder =====================
  await describe('util TextEncoder/TextDecoder exports', async () => {
    await it('should export TextEncoder', async () => {
      expect(util.TextEncoder).toBeDefined();
    });

    await it('should export TextDecoder', async () => {
      expect(util.TextDecoder).toBeDefined();
    });
  });
};
