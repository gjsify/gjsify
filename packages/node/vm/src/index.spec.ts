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
} from 'vm';

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

      await it('isContext should return false for plain objects', async () => {
        expect(isContext({})).toBe(false);
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
    });
  });
};
