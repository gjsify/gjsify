// Ported from refs/node-test/parallel/test-vm-*.js
// Original: MIT license, Node.js contributors

import { describe, it, expect } from '@gjsify/unit';
import vm, {
  runInThisContext,
  runInNewContext,
  runInContext,
  createContext,
  isContext,
  compileFunction,
  Script,
} from 'node:vm';

export default async () => {
  await describe('vm', async () => {

    // ==================== exports ====================
    await describe('exports', async () => {
      await it('should export runInThisContext', async () => {
        expect(typeof runInThisContext).toBe('function');
      });

      await it('should export runInNewContext', async () => {
        expect(typeof runInNewContext).toBe('function');
      });

      await it('should export runInContext', async () => {
        expect(typeof runInContext).toBe('function');
      });

      await it('should export createContext', async () => {
        expect(typeof createContext).toBe('function');
      });

      await it('should export isContext', async () => {
        expect(typeof isContext).toBe('function');
      });

      await it('should export compileFunction', async () => {
        expect(typeof compileFunction).toBe('function');
      });

      await it('should export Script class', async () => {
        expect(typeof Script).toBe('function');
      });

      await it('should have all exports on default', async () => {
        expect(typeof vm.runInThisContext).toBe('function');
        expect(typeof vm.runInNewContext).toBe('function');
        expect(typeof vm.runInContext).toBe('function');
        expect(typeof vm.createContext).toBe('function');
        expect(typeof vm.isContext).toBe('function');
        expect(typeof vm.compileFunction).toBe('function');
        expect(typeof vm.Script).toBe('function');
      });
    });

    // ==================== runInThisContext ====================
    await describe('runInThisContext', async () => {
      await it('should evaluate arithmetic', async () => {
        expect(runInThisContext('1 + 1')).toBe(2);
      });

      await it('should evaluate string expressions', async () => {
        expect(runInThisContext('"hello" + " " + "world"')).toBe('hello world');
      });

      await it('should evaluate complex expressions', async () => {
        expect(runInThisContext('[1,2,3].map(x => x * 2).join(",")')).toBe('2,4,6');
      });

      await it('should return undefined for statements', async () => {
        const result = runInThisContext('var __vmtest_x = 42');
        expect(result).toBeUndefined();
      });

      await it('should throw SyntaxError for invalid code', async () => {
        expect(() => runInThisContext('function(')).toThrow();
      });

      await it('should throw ReferenceError for undefined variables', async () => {
        expect(() => runInThisContext('__nonexistent_var_abc123')).toThrow();
      });

      await it('should evaluate object literals', async () => {
        const result = runInThisContext('({a: 1, b: 2})');
        expect(result.a).toBe(1);
        expect(result.b).toBe(2);
      });

      await it('should evaluate closures and IIFEs', async () => {
        const result = runInThisContext('(function() { var x = 10; return x * 2; })()');
        expect(result).toBe(20);
      });

      await it('should evaluate arrow function IIFEs', async () => {
        const result = runInThisContext('(() => { const arr = [1,2,3]; return arr.reduce((a,b) => a+b, 0); })()');
        expect(result).toBe(6);
      });

      await it('should evaluate template literals', async () => {
        const result = runInThisContext('`hello ${"world"}`');
        expect(result).toBe('hello world');
      });

      await it('should evaluate ternary expressions', async () => {
        expect(runInThisContext('true ? "yes" : "no"')).toBe('yes');
        expect(runInThisContext('false ? "yes" : "no"')).toBe('no');
      });

      await it('should return null', async () => {
        expect(runInThisContext('null')).toBeNull();
      });

      await it('should return boolean values', async () => {
        expect(runInThisContext('true')).toBe(true);
        expect(runInThisContext('false')).toBe(false);
      });

      await it('should evaluate typeof expression', async () => {
        expect(runInThisContext('typeof undefined')).toBe('undefined');
        expect(runInThisContext('typeof 42')).toBe('number');
        expect(runInThisContext('typeof "str"')).toBe('string');
      });

      await it('should evaluate array creation and methods', async () => {
        const result = runInThisContext('Array.from({length: 3}, (_, i) => i)');
        expect(result[0]).toBe(0);
        expect(result[1]).toBe(1);
        expect(result[2]).toBe(2);
      });

      await it('should evaluate destructuring expressions', async () => {
        const result = runInThisContext('(() => { const [a, ...rest] = [1,2,3]; return rest; })()');
        expect(result[0]).toBe(2);
        expect(result[1]).toBe(3);
      });

      await it('should handle string with special characters', async () => {
        expect(runInThisContext('"line1\\nline2"')).toBe('line1\nline2');
      });

      await it('should evaluate regex creation', async () => {
        const result = runInThisContext('/^hello/i.test("Hello World")');
        expect(result).toBe(true);
      });

      await it('should evaluate Math operations', async () => {
        expect(runInThisContext('Math.max(1, 5, 3)')).toBe(5);
        expect(runInThisContext('Math.min(1, 5, 3)')).toBe(1);
      });

      await it('should evaluate JSON operations', async () => {
        const result = runInThisContext('JSON.parse(\'{"a":1}\')');
        expect(result.a).toBe(1);
      });

      await it('should handle empty string code', async () => {
        const result = runInThisContext('');
        expect(result).toBeUndefined();
      });

      await it('should handle code that is only comments', async () => {
        const result = runInThisContext('// just a comment');
        expect(result).toBeUndefined();
      });

      await it('should propagate TypeError', async () => {
        expect(() => runInThisContext('null.property')).toThrow();
      });

      await it('should propagate custom Error', async () => {
        let caught = false;
        try {
          runInThisContext('throw new Error("custom message")');
        } catch (e: unknown) {
          caught = true;
          expect((e as Error).message).toBe('custom message');
        }
        expect(caught).toBe(true);
      });

      await it('should evaluate string passed expression', async () => {
        expect(runInThisContext('"passed"')).toBe('passed');
      });

      await it('should evaluate Object.keys', async () => {
        const result = runInThisContext('Object.keys({x:1,y:2,z:3})');
        expect(result.length).toBe(3);
        expect(result[0]).toBe('x');
      });
    });

    // ==================== runInNewContext ====================
    await describe('runInNewContext', async () => {
      await it('should access sandbox variables', async () => {
        const result = runInNewContext('a + b', { a: 10, b: 20 });
        expect(result).toBe(30);
      });

      await it('should work with string values', async () => {
        const result = runInNewContext('greeting + " " + name', {
          greeting: 'Hello',
          name: 'World',
        });
        expect(result).toBe('Hello World');
      });

      await it('should work with empty context', async () => {
        const result = runInNewContext('typeof undefined');
        expect(result).toBe('undefined');
      });

      await it('should work with no context argument', async () => {
        const result = runInNewContext('1 + 2');
        expect(result).toBe(3);
      });

      await it('should access array methods via sandbox', async () => {
        const result = runInNewContext('items.join("-")', { items: ['a', 'b', 'c'] });
        expect(result).toBe('a-b-c');
      });

      await it('should evaluate expressions using sandbox values', async () => {
        const result = runInNewContext('a * b + c', { a: 2, b: 3, c: 4 });
        expect(result).toBe(10);
      });

      await it('should access nested objects in sandbox', async () => {
        const result = runInNewContext('obj.nested.value', { obj: { nested: { value: 99 } } });
        expect(result).toBe(99);
      });

      await it('should throw for invalid code in sandbox', async () => {
        expect(() => runInNewContext('function(')).toThrow();
      });

      await it('should evaluate string concatenation with many params', async () => {
        const result = runInNewContext('p + q + r + s + t', {
          p: 'ab', q: 'cd', r: 'ef', s: 'gh', t: 'ij',
        });
        expect(result).toBe('abcdefghij');
      });

      await it('should handle boolean sandbox values', async () => {
        expect(runInNewContext('flag ? "yes" : "no"', { flag: true })).toBe('yes');
        expect(runInNewContext('flag ? "yes" : "no"', { flag: false })).toBe('no');
      });

      await it('should handle null sandbox values', async () => {
        const result = runInNewContext('val === null', { val: null });
        expect(result).toBe(true);
      });

      await it('should handle function sandbox values', async () => {
        const result = runInNewContext('fn(5)', { fn: (x: number) => x * 2 });
        expect(result).toBe(10);
      });

      await it('should allow calling sandbox methods', async () => {
        const result = runInNewContext('arr.filter(x => x > 2)', { arr: [1, 2, 3, 4, 5] });
        expect(result.length).toBe(3);
        expect(result[0]).toBe(3);
      });

      await it('should handle sandbox with Symbol-keyed properties', async () => {
        // Symbol keys are not enumerable by Object.keys, so they won't be injected
        // The code should still work without them
        const sym = Symbol('test');
        const ctx: Record<string | symbol, unknown> = { val: 42 };
        ctx[sym] = 'hidden';
        const result = runInNewContext('val', ctx as Record<string, unknown>);
        expect(result).toBe(42);
      });

      await it('should handle empty sandbox', async () => {
        const result = runInNewContext('typeof Object', {});
        expect(result).toBe('function');
      });

      await it('should evaluate JSON stringify in sandbox', async () => {
        const result = runInNewContext('JSON.stringify(data)', { data: { x: 1 } });
        expect(result).toBe('{"x":1}');
      });

      await it('should throw ReferenceError for missing sandbox variable', async () => {
        expect(() => runInNewContext('missing_var', {})).toThrow();
      });

      await it('should handle array sandbox value', async () => {
        const result = runInNewContext('arr.length', { arr: [1, 2, 3] });
        expect(result).toBe(3);
      });

      await it('should propagate errors from sandbox code', async () => {
        let caught = false;
        try {
          runInNewContext('throw new Error("sandbox error")', {});
        } catch (e: unknown) {
          caught = true;
          expect((e as Error).message).toBe('sandbox error');
        }
        expect(caught).toBe(true);
      });

      await it('should handle regex in sandbox', async () => {
        const result = runInNewContext('pattern.test(str)', {
          pattern: /^hello/i,
          str: 'Hello World',
        });
        expect(result).toBe(true);
      });

      await it('should return undefined for statements in sandbox', async () => {
        const result = runInNewContext('var x = 42', {});
        expect(result).toBeUndefined();
      });

      await it('should isolate between calls', async () => {
        runInNewContext('var __isolated_x = 1', {});
        // The variable should not leak to the next call
        expect(() => runInNewContext('__isolated_x', {})).toThrow();
      });
    });

    // ==================== runInContext ====================
    await describe('runInContext', async () => {
      await it('should run in a created context', async () => {
        const ctx = createContext({ x: 10 });
        const result = runInContext('x + 5', ctx);
        expect(result).toBe(15);
      });

      await it('should run a string expression in empty context', async () => {
        const ctx = createContext();
        const result = runInContext('"passed"', ctx);
        expect(result).toBe('passed');
      });

      await it('should access pre-populated context', async () => {
        const ctx = createContext({ foo: 'bar', thing: 'lala' });
        expect(ctx.foo).toBe('bar');
        expect(ctx.thing).toBe('lala');
      });

      await it('should use context properties', async () => {
        const ctx = createContext({ a: 1, b: 2 });
        const result = runInContext('a + b', ctx);
        expect(result).toBe(3);
      });

      await it('should evaluate typeof on context values', async () => {
        const ctx = createContext({ num: 42, str: 'hello' });
        expect(runInContext('typeof num', ctx)).toBe('number');
        expect(runInContext('typeof str', ctx)).toBe('string');
      });

      await it('should handle context with array', async () => {
        const ctx = createContext({ items: [10, 20, 30] });
        const result = runInContext('items.reduce((a, b) => a + b, 0)', ctx);
        expect(result).toBe(60);
      });

      await it('should throw SyntaxError for invalid code', async () => {
        const ctx = createContext({});
        expect(() => runInContext('function(', ctx)).toThrow();
      });

      await it('should throw for errors in context code', async () => {
        const ctx = createContext({});
        let caught = false;
        try {
          runInContext('throw new Error("ctx error")', ctx);
        } catch (e: unknown) {
          caught = true;
          expect((e as Error).message).toBe('ctx error');
        }
        expect(caught).toBe(true);
      });
    });

    // ==================== createContext / isContext ====================
    await describe('createContext', async () => {
      await it('should return an object', async () => {
        const ctx = createContext();
        expect(typeof ctx).toBe('object');
      });

      await it('should mark as context (isContext returns true)', async () => {
        const ctx = createContext();
        expect(isContext(ctx)).toBe(true);
      });

      await it('should preserve existing properties', async () => {
        const ctx = createContext({ x: 42 });
        expect(ctx.x).toBe(42);
        expect(isContext(ctx)).toBe(true);
      });

      await it('should return same object when contextifying', async () => {
        const sandbox: Record<string, unknown> = {};
        const context = createContext(sandbox);
        expect(sandbox === context).toBe(true);
      });

      await it('should contextify object with many properties', async () => {
        const ctx = createContext({ a: 1, b: 'two', c: true, d: null, e: [1, 2] });
        expect(isContext(ctx)).toBe(true);
        expect(ctx.a).toBe(1);
        expect(ctx.b).toBe('two');
        expect(ctx.c).toBe(true);
        expect(ctx.d).toBeNull();
      });

      await it('should handle contextifying twice', async () => {
        const sandbox: Record<string, unknown> = { x: 1 };
        const ctx1 = createContext(sandbox);
        const ctx2 = createContext(sandbox);
        expect(isContext(ctx1)).toBe(true);
        expect(isContext(ctx2)).toBe(true);
        expect(ctx1 === ctx2).toBe(true);
      });

      await it('isContext should return false for plain objects', async () => {
        expect(isContext({})).toBe(false);
      });

      await it('isContext should throw for null', async () => {
        expect(() => isContext(null as unknown as object)).toThrow();
      });

      await it('isContext should throw for undefined', async () => {
        expect(() => isContext(undefined as unknown as object)).toThrow();
      });

      await it('isContext should throw for primitives', async () => {
        expect(() => isContext(42 as unknown as object)).toThrow();
        expect(() => isContext('string' as unknown as object)).toThrow();
        expect(() => isContext(true as unknown as object)).toThrow();
      });

      await it('isContext should return false for array', async () => {
        expect(isContext([])).toBe(false);
      });

      await it('should preserve context symbol as non-enumerable', async () => {
        const ctx = createContext({ visible: true });
        const keys = Object.keys(ctx);
        expect(keys.length).toBe(1);
        expect(keys[0]).toBe('visible');
      });
    });

    // ==================== compileFunction ====================
    await describe('compileFunction', async () => {
      await it('should compile a function with no params', async () => {
        const fn = compileFunction('return 42');
        expect(typeof fn).toBe('function');
        expect(fn()).toBe(42);
      });

      await it('should compile a function with params', async () => {
        const fn = compileFunction('return a + b', ['a', 'b']);
        expect(fn(3, 4)).toBe(7);
      });

      await it('should compile a function that returns a string', async () => {
        const fn = compileFunction('return name.toUpperCase()', ['name']);
        expect(fn('hello')).toBe('HELLO');
      });

      await it('should compile a function with string concatenation params', async () => {
        const fn = compileFunction('return p + q + r + s + t', ['p', 'q', 'r', 's', 't']);
        expect(fn('ab', 'cd', 'ef', 'gh', 'ij')).toBe('abcdefghij');
      });

      await it('should compile empty body', async () => {
        const fn = compileFunction('');
        expect(fn()).toBeUndefined();
      });

      await it('should compile with return statement only', async () => {
        const fn = compileFunction('return');
        expect(fn()).toBeUndefined();
      });

      await it('should throw SyntaxError for invalid code', async () => {
        expect(() => compileFunction('function(')).toThrow();
      });

      await it('should compile function that uses closures', async () => {
        const fn = compileFunction('var count = 0; count++; return count');
        expect(fn()).toBe(1);
      });

      await it('should compile function with conditional logic', async () => {
        const fn = compileFunction('return x > 0 ? "positive" : "non-positive"', ['x']);
        expect(fn(5)).toBe('positive');
        expect(fn(-1)).toBe('non-positive');
        expect(fn(0)).toBe('non-positive');
      });

      await it('should compile function that creates and returns objects', async () => {
        const fn = compileFunction('return { sum: a + b, product: a * b }', ['a', 'b']);
        const result = fn(3, 4);
        expect(result.sum).toBe(7);
        expect(result.product).toBe(12);
      });

      await it('should compile function that creates arrays', async () => {
        const fn = compileFunction('return [a, b, a + b]', ['a', 'b']);
        const result = fn(1, 2);
        expect(result[0]).toBe(1);
        expect(result[1]).toBe(2);
        expect(result[2]).toBe(3);
      });

      await it('should compile function with try-catch', async () => {
        const fn = compileFunction('try { return JSON.parse(s); } catch(e) { return null; }', ['s']);
        expect(fn('{"a":1}').a).toBe(1);
        expect(fn('invalid')).toBeNull();
      });

      await it('should compile function that throws', async () => {
        const fn = compileFunction('throw new Error("compiled error")');
        let caught = false;
        try {
          fn();
        } catch (e: unknown) {
          caught = true;
          expect((e as Error).message).toBe('compiled error');
        }
        expect(caught).toBe(true);
      });

      await it('should compile function with loop', async () => {
        const fn = compileFunction('var sum = 0; for (var i = 1; i <= n; i++) sum += i; return sum', ['n']);
        expect(fn(10)).toBe(55);
      });

      await it('should compile function with multiple statements', async () => {
        const fn = compileFunction('var x = a * 2; var y = b * 3; return x + y', ['a', 'b']);
        expect(fn(5, 10)).toBe(40);
      });
    });

    // ==================== Script ====================
    await describe('Script', async () => {
      await it('should be constructable', async () => {
        const script = new Script('1 + 2');
        expect(script).toBeDefined();
      });

      await it('should run in this context', async () => {
        const script = new Script('1 + 2');
        expect(script.runInThisContext()).toBe(3);
      });

      await it('should run a string expression', async () => {
        const script = new Script('"passed"');
        expect(script.runInThisContext()).toBe('passed');
      });

      await it('should run in new context', async () => {
        const script = new Script('x * y');
        expect(script.runInNewContext({ x: 6, y: 7 })).toBe(42);
      });

      await it('should run in created context', async () => {
        const ctx = createContext({ value: 100 });
        const script = new Script('value + 1');
        expect(script.runInContext(ctx)).toBe(101);
      });

      await it('should be reusable', async () => {
        const script = new Script('n + 1');
        expect(script.runInNewContext({ n: 1 })).toBe(2);
        expect(script.runInNewContext({ n: 10 })).toBe(11);
        expect(script.runInNewContext({ n: 100 })).toBe(101);
      });

      await it('should have createCachedData method', async () => {
        const script = new Script('1');
        const data = script.createCachedData();
        expect(data instanceof Uint8Array).toBe(true);
      });

      await it('should throw for invalid code at construction or execution', async () => {
        let threw = false;
        try {
          const script = new Script('function(');
          script.runInThisContext();
        } catch {
          threw = true;
        }
        expect(threw).toBe(true);
      });

      await it('should run same script with different contexts', async () => {
        const script = new Script('x + y');
        expect(script.runInNewContext({ x: 1, y: 2 })).toBe(3);
        expect(script.runInNewContext({ x: 10, y: 20 })).toBe(30);
        expect(script.runInNewContext({ x: 100, y: 200 })).toBe(300);
      });

      await it('should handle script that returns object', async () => {
        const script = new Script('({key: val})');
        const result = script.runInNewContext({ val: 'test' });
        expect((result as Record<string, unknown>).key).toBe('test');
      });

      await it('should handle script that uses array methods', async () => {
        const script = new Script('items.map(x => x * 2)');
        const result = script.runInNewContext({ items: [1, 2, 3] }) as number[];
        expect(result[0]).toBe(2);
        expect(result[1]).toBe(4);
        expect(result[2]).toBe(6);
      });

      await it('should handle script with conditionals', async () => {
        const script = new Script('x > 0 ? "positive" : "non-positive"');
        expect(script.runInNewContext({ x: 5 })).toBe('positive');
        expect(script.runInNewContext({ x: -1 })).toBe('non-positive');
      });

      await it('should propagate ReferenceError from script', async () => {
        const script = new Script('undeclaredVariable');
        expect(() => script.runInNewContext({})).toThrow();
      });

      await it('should propagate TypeError from script', async () => {
        const script = new Script('null.property');
        expect(() => script.runInThisContext()).toThrow();
      });

      await it('should run script that evaluates to boolean', async () => {
        const script = new Script('a === b');
        expect(script.runInNewContext({ a: 1, b: 1 })).toBe(true);
        expect(script.runInNewContext({ a: 1, b: 2 })).toBe(false);
      });

      await it('should run script with template literal', async () => {
        const script = new Script('`${greeting}, ${name}!`');
        const result = script.runInNewContext({ greeting: 'Hello', name: 'World' });
        expect(result).toBe('Hello, World!');
      });

      await it('should run script returning null', async () => {
        const script = new Script('null');
        expect(script.runInThisContext()).toBeNull();
      });

      await it('should run script returning undefined', async () => {
        const script = new Script('undefined');
        expect(script.runInThisContext()).toBeUndefined();
      });

      await it('should run empty script', async () => {
        const script = new Script('');
        expect(script.runInThisContext()).toBeUndefined();
      });

      await it('should run script that is only a comment', async () => {
        const script = new Script('// just a comment');
        expect(script.runInThisContext()).toBeUndefined();
      });

      await it('should run script with IIFE', async () => {
        const script = new Script('(function() { return 42; })()');
        expect(script.runInThisContext()).toBe(42);
      });

      await it('should run script with spread operator', async () => {
        const script = new Script('Math.max(...nums)');
        expect(script.runInNewContext({ nums: [1, 5, 3, 9, 2] })).toBe(9);
      });
    });

    // ==================== error cases ====================
    await describe('error cases', async () => {
      await it('should propagate SyntaxError from runInThisContext', async () => {
        let caught = false;
        try {
          runInThisContext('{{{');
        } catch (e: unknown) {
          caught = true;
          expect((e as Error).constructor.name).toBe('SyntaxError');
        }
        expect(caught).toBe(true);
      });

      await it('should propagate SyntaxError from runInNewContext', async () => {
        let caught = false;
        try {
          runInNewContext('{{{', {});
        } catch (e: unknown) {
          caught = true;
          expect((e as Error).constructor.name).toBe('SyntaxError');
        }
        expect(caught).toBe(true);
      });

      await it('should propagate SyntaxError from Script', async () => {
        let caught = false;
        try {
          const s = new Script('{{{');
          s.runInThisContext();
        } catch (e: unknown) {
          caught = true;
          expect((e as Error).constructor.name).toBe('SyntaxError');
        }
        expect(caught).toBe(true);
      });

      await it('should propagate RangeError', async () => {
        expect(() => runInThisContext('new Array(-1)')).toThrow();
      });

      await it('should propagate custom thrown string', async () => {
        let caught = false;
        try {
          runInThisContext('throw "string error"');
        } catch (e: unknown) {
          caught = true;
          expect(e).toBe('string error');
        }
        expect(caught).toBe(true);
      });

      await it('should propagate custom thrown number', async () => {
        let caught = false;
        try {
          runInThisContext('throw 42');
        } catch (e: unknown) {
          caught = true;
          expect(e).toBe(42);
        }
        expect(caught).toBe(true);
      });

      await it('should propagate custom thrown object', async () => {
        let caught = false;
        try {
          runInThisContext('throw {code: "ERR"}');
        } catch (e: unknown) {
          caught = true;
          expect((e as Record<string, unknown>).code).toBe('ERR');
        }
        expect(caught).toBe(true);
      });

      await it('should throw for undefined property access in new context', async () => {
        expect(() => runInNewContext('noSuchVar.property', {})).toThrow();
      });

      await it('should throw TypeError for calling non-function in new context', async () => {
        expect(() => runInNewContext('x()', { x: 42 })).toThrow();
      });

      await it('should propagate error from compileFunction with invalid syntax', async () => {
        let caught = false;
        try {
          compileFunction('return {{{');
        } catch (e: unknown) {
          caught = true;
          expect((e as Error).constructor.name).toBe('SyntaxError');
        }
        expect(caught).toBe(true);
      });
    });

    // ==================== edge cases ====================
    await describe('edge cases', async () => {
      await it('should handle code returning 0', async () => {
        expect(runInThisContext('0')).toBe(0);
      });

      await it('should handle code returning empty string', async () => {
        expect(runInThisContext('""')).toBe('');
      });

      await it('should handle code returning NaN', async () => {
        const result = runInThisContext('NaN');
        expect(typeof result).toBe('number');
        // NaN !== NaN, so we use isNaN
        expect(Number.isNaN(result as number)).toBe(true);
      });

      await it('should handle code returning Infinity', async () => {
        expect(runInThisContext('Infinity')).toBe(Infinity);
        expect(runInThisContext('-Infinity')).toBe(-Infinity);
      });

      await it('should handle code returning empty array', async () => {
        const result = runInThisContext('[]') as unknown[];
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(0);
      });

      await it('should handle code returning empty object', async () => {
        const result = runInThisContext('({})') as Record<string, unknown>;
        expect(typeof result).toBe('object');
        expect(Object.keys(result).length).toBe(0);
      });

      await it('should handle multiline code', async () => {
        const code = `
          var a = 1;
          var b = 2;
          a + b;
        `;
        expect(runInThisContext(code)).toBe(3);
      });

      await it('should handle code with semicolons', async () => {
        expect(runInThisContext('1; 2; 3')).toBe(3);
      });

      await it('should handle code with comma operator', async () => {
        expect(runInThisContext('(1, 2, 3)')).toBe(3);
      });

      await it('should handle very long expressions', async () => {
        const code = Array.from({ length: 100 }, (_, i) => String(i)).join(' + ');
        const expected = (100 * 99) / 2; // Sum 0..99
        expect(runInThisContext(code)).toBe(expected);
      });

      await it('should handle sandbox with numeric keys', async () => {
        // Object.keys will make them strings, but they should still work
        const result = runInNewContext('x', { x: 'works' });
        expect(result).toBe('works');
      });

      await it('should handle sandbox with special property names', async () => {
        const result = runInNewContext('$val + _val', { $val: 10, _val: 20 });
        expect(result).toBe(30);
      });

      await it('should handle script with large sandbox', async () => {
        const sandbox: Record<string, number> = {};
        for (let i = 0; i < 50; i++) {
          sandbox[`v${i}`] = i;
        }
        const result = runInNewContext('v0 + v49', sandbox);
        expect(result).toBe(49);
      });

      await it('should handle createContext with no arguments', async () => {
        const ctx = createContext();
        expect(isContext(ctx)).toBe(true);
        expect(typeof ctx).toBe('object');
      });

      await it('should handle script with Date', async () => {
        const result = runInThisContext('typeof new Date()');
        expect(result).toBe('object');
      });

      await it('should handle script with Map', async () => {
        const result = runInThisContext('(() => { const m = new Map(); m.set("a", 1); return m.get("a"); })()');
        expect(result).toBe(1);
      });

      await it('should handle script with Set', async () => {
        const result = runInThisContext('(() => { const s = new Set([1,2,3,2,1]); return s.size; })()');
        expect(result).toBe(3);
      });

      await it('should handle script with Promise.resolve', async () => {
        const result = runInThisContext('Promise.resolve(42)');
        expect(result instanceof Promise).toBe(true);
      });

      await it('should handle script with Symbol', async () => {
        const result = runInThisContext('typeof Symbol("test")');
        expect(result).toBe('symbol');
      });
    });
  });
};
