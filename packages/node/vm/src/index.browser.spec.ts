// Browser-target conformance spec for @gjsify/vm.
//
// Imports the browser entry directly (`./browser.js`) — under `gjsify build
// --app browser` the bundler picks the same file via the `"browser"` export
// condition, so these assertions lock in the behaviour exercised in the
// Playwright/Firefox/SpiderMonkey suite.
//
// The browser polyfill evaluates code through the Function/eval sandbox
// (`runInThisContext` → indirect `eval`, `runInNewContext` → `new Function`
// with the sandbox keys injected as locals). It is NOT a security boundary —
// matching Node's own vm contract — so the assertions below check evaluation
// semantics and context-object exposure rather than isolation guarantees.

import { describe, it, expect } from '@gjsify/unit';
import vm, {
    runInThisContext,
    runInNewContext,
    runInContext,
    createContext,
    isContext,
    compileFunction,
    Script,
    Module,
    SourceTextModule,
    SyntheticModule,
    measureMemory,
} from './browser.js';

export default async () => {
    await describe('vm (browser)', async () => {
        await describe('exports', async () => {
            await it('should export the public surface as functions', async () => {
                expect(typeof runInThisContext).toBe('function');
                expect(typeof runInNewContext).toBe('function');
                expect(typeof runInContext).toBe('function');
                expect(typeof createContext).toBe('function');
                expect(typeof isContext).toBe('function');
                expect(typeof compileFunction).toBe('function');
                expect(typeof Script).toBe('function');
            });

            await it('should mirror the public surface on the default export', async () => {
                expect(typeof vm.runInThisContext).toBe('function');
                expect(typeof vm.runInNewContext).toBe('function');
                expect(typeof vm.runInContext).toBe('function');
                expect(typeof vm.createContext).toBe('function');
                expect(typeof vm.isContext).toBe('function');
                expect(typeof vm.compileFunction).toBe('function');
                expect(typeof vm.Script).toBe('function');
            });
        });

        await describe('runInThisContext', async () => {
            await it('should evaluate expressions via the eval sandbox', async () => {
                expect(runInThisContext('1 + 1')).toBe(2);
                expect(runInThisContext('"a" + "b"')).toBe('ab');
                expect(runInThisContext('[1,2,3].map(x => x * 2).join(",")')).toBe('2,4,6');
            });

            await it('should return undefined for statements', async () => {
                expect(runInThisContext('var __vm_browser_x = 42')).toBeUndefined();
                expect(runInThisContext('')).toBeUndefined();
            });

            await it('should propagate errors from evaluated code', async () => {
                expect(() => runInThisContext('function(')).toThrow();
                expect(() => runInThisContext('__no_such_var_browser_abc')).toThrow();
            });
        });

        await describe('runInNewContext', async () => {
            await it('should expose context object properties as locals', async () => {
                expect(runInNewContext('a + b', { a: 10, b: 20 })).toBe(30);
                expect(runInNewContext('items.join("-")', { items: ['a', 'b', 'c'] })).toBe('a-b-c');
                expect(runInNewContext('obj.nested.value', { obj: { nested: { value: 99 } } })).toBe(99);
            });

            await it('should invoke functions passed via the context object', async () => {
                expect(runInNewContext('fn(5)', { fn: (x: number) => x * 2 })).toBe(10);
            });

            await it('should evaluate with no context argument', async () => {
                expect(runInNewContext('typeof Object')).toBe('function');
                expect(runInNewContext('1 + 2')).toBe(3);
            });

            await it('should not leak declarations between calls', async () => {
                runInNewContext('var __vm_browser_isolated = 1', {});
                expect(() => runInNewContext('__vm_browser_isolated', {})).toThrow();
            });
        });

        await describe('runInContext + createContext', async () => {
            await it('should run code against a created context object', async () => {
                const ctx = createContext({ x: 10 });
                expect(runInContext('x + 5', ctx)).toBe(15);
            });

            await it('should mark created contexts and preserve their properties', async () => {
                const ctx = createContext({ foo: 'bar' });
                expect(isContext(ctx)).toBe(true);
                expect(ctx.foo).toBe('bar');
                // The context marker is non-enumerable, so only user keys remain.
                expect(Object.keys(ctx).length).toBe(1);
            });

            await it('should return the same object when contextifying in place', async () => {
                const sandbox: Record<string, unknown> = {};
                expect(createContext(sandbox) === sandbox).toBe(true);
            });

            await it('isContext should reject non-contexts and non-objects', async () => {
                expect(isContext({})).toBe(false);
                expect(() => isContext(null as unknown as object)).toThrow();
                expect(() => isContext(42 as unknown as object)).toThrow();
            });
        });

        await describe('compileFunction', async () => {
            await it('should compile a callable function with params', async () => {
                const fn = compileFunction('return a + b', ['a', 'b']);
                expect(typeof fn).toBe('function');
                expect(fn(3, 4)).toBe(7);
            });

            await it('should throw for invalid bodies', async () => {
                expect(() => compileFunction('function(')).toThrow();
            });
        });

        await describe('Script', async () => {
            await it('should evaluate cached code in this/new context', async () => {
                const script = new Script('x * y');
                expect(script.runInNewContext({ x: 6, y: 7 })).toBe(42);
                const expr = new Script('1 + 2');
                expect(expr.runInThisContext()).toBe(3);
            });

            await it('should be reusable across contexts', async () => {
                const script = new Script('n + 1');
                expect(script.runInNewContext({ n: 1 })).toBe(2);
                expect(script.runInNewContext({ n: 100 })).toBe(101);
            });

            await it('should expose a createCachedData stub returning a Uint8Array', async () => {
                expect(new Script('1').createCachedData() instanceof Uint8Array).toBe(true);
            });
        });

        await describe('ENOTSUP stubs', async () => {
            await it('should throw structured ENOTSUP from vm.Module', async () => {
                let caught: (Error & { code?: string }) | undefined;
                try {
                    new Module('export const x = 1');
                } catch (e: unknown) {
                    caught = e as Error & { code?: string };
                }
                expect(caught !== undefined).toBe(true);
                expect(caught?.code).toBe('ENOTSUP');
            });

            await it('should throw structured ENOTSUP from SourceTextModule', async () => {
                let code: string | undefined;
                try {
                    new SourceTextModule('export const y = 2');
                } catch (e: unknown) {
                    code = (e as Error & { code?: string }).code;
                }
                expect(code).toBe('ENOTSUP');
            });

            await it('should throw structured ENOTSUP from SyntheticModule', async () => {
                let code: string | undefined;
                try {
                    new SyntheticModule([], () => {});
                } catch (e: unknown) {
                    code = (e as Error & { code?: string }).code;
                }
                expect(code).toBe('ENOTSUP');
            });

            await it('should reject from measureMemory with ENOTSUP', async () => {
                let code: string | undefined;
                try {
                    await measureMemory();
                } catch (e: unknown) {
                    code = (e as Error & { code?: string }).code;
                }
                expect(code).toBe('ENOTSUP');
            });
        });
    });
};
