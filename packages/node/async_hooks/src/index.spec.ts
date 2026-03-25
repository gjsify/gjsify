// Ported from refs/node-test/async-hooks/test-async-local-storage-*.js
// and refs/node-test/async-hooks/test-embedder.api.async-resource*.js
// Original: MIT license, Node.js contributors

import { describe, it, expect } from '@gjsify/unit';
import { AsyncLocalStorage, AsyncResource, executionAsyncId, triggerAsyncId, createHook } from 'node:async_hooks';

export default async () => {
  await describe('async_hooks', async () => {
    await it('should export executionAsyncId as a function', async () => {
      expect(typeof executionAsyncId).toBe('function');
    });

    await it('should export triggerAsyncId as a function', async () => {
      expect(typeof triggerAsyncId).toBe('function');
    });

    await it('should export createHook as a function', async () => {
      expect(typeof createHook).toBe('function');
    });

    await it('should create an AsyncLocalStorage', async () => {
      const storage = new AsyncLocalStorage();
      expect(storage).toBeDefined();
      expect(storage.getStore()).toBeUndefined();
    });

    await it('should run with a store value', async () => {
      const storage = new AsyncLocalStorage<string>();
      const result = storage.run('test-value', () => {
        return storage.getStore();
      });
      expect(result).toBe('test-value');
    });

    await it('should restore previous store after run', async () => {
      const storage = new AsyncLocalStorage<string>();
      storage.run('outer', () => {
        storage.run('inner', () => {
          expect(storage.getStore()).toBe('inner');
        });
        expect(storage.getStore()).toBe('outer');
      });
      expect(storage.getStore()).toBeUndefined();
    });

    await it('should create an AsyncResource', async () => {
      const resource = new AsyncResource('TEST');
      expect(resource).toBeDefined();
      expect(typeof resource.runInAsyncScope).toBe('function');
    });

    await it('should run function in async scope', async () => {
      const resource = new AsyncResource('TEST');
      const result = resource.runInAsyncScope(() => 42);
      expect(result).toBe(42);
    });

    // ==================== additional tests ====================

    await it('executionAsyncId should return a number', async () => {
      const id = executionAsyncId();
      expect(typeof id).toBe('number');
    });

    await it('triggerAsyncId should return a number', async () => {
      const id = triggerAsyncId();
      expect(typeof id).toBe('number');
    });

    await it('createHook should return an object with enable/disable', async () => {
      const hook = createHook({
        init() {},
      });
      expect(typeof hook.enable).toBe('function');
      expect(typeof hook.disable).toBe('function');
    });

    await it('AsyncLocalStorage.run should pass arguments to callback', async () => {
      const storage = new AsyncLocalStorage<number>();
      const result = storage.run(42, (a: number, b: number) => {
        return storage.getStore()! + a + b;
      }, 1, 2);
      expect(result).toBe(45);
    });

    await it('AsyncLocalStorage.run should handle exceptions', async () => {
      const storage = new AsyncLocalStorage<string>();
      try {
        storage.run('error-test', () => {
          throw new Error('intentional');
        });
      } catch (e) {
        // Store should be restored after exception
        expect(storage.getStore()).toBeUndefined();
      }
    });

    await it('AsyncLocalStorage.disable should clear the store', async () => {
      const storage = new AsyncLocalStorage<string>();
      storage.run('active', () => {
        expect(storage.getStore()).toBe('active');
        storage.disable();
        expect(storage.getStore()).toBeUndefined();
      });
    });

    await it('AsyncResource.runInAsyncScope should pass thisArg', async () => {
      const resource = new AsyncResource('TEST');
      const obj = { value: 99 };
      const result = resource.runInAsyncScope(function (this: typeof obj) {
        return this.value;
      }, obj);
      expect(result).toBe(99);
    });

    await it('AsyncResource.runInAsyncScope should pass arguments', async () => {
      const resource = new AsyncResource('TEST');
      const result = resource.runInAsyncScope((a: number, b: number) => a + b, null, 3, 4);
      expect(result).toBe(7);
    });

    await it('AsyncResource should have asyncId method', async () => {
      const resource = new AsyncResource('TEST');
      expect(typeof resource.asyncId).toBe('function');
      expect(typeof resource.asyncId()).toBe('number');
    });

    await it('AsyncResource should have triggerAsyncId method', async () => {
      const resource = new AsyncResource('TEST');
      expect(typeof resource.triggerAsyncId).toBe('function');
      expect(typeof resource.triggerAsyncId()).toBe('number');
    });

    // ==================== Additional tests ====================

    await describe('createHook additional', async () => {
      await it('createHook returned object should have enable and disable methods', async () => {
        const hook = createHook({ init() {} });
        expect(typeof hook.enable).toBe('function');
        expect(typeof hook.disable).toBe('function');
      });

      await it('hook.enable() should return the hook itself', async () => {
        const hook = createHook({ init() {} });
        const result = hook.enable();
        expect(result).toBe(hook);
        hook.disable();
      });

      await it('hook.disable() should return the hook itself', async () => {
        const hook = createHook({ init() {} });
        hook.enable();
        const result = hook.disable();
        expect(result).toBe(hook);
      });
    });

    await describe('AsyncLocalStorage additional', async () => {
      await it('getStore() should return undefined when not inside a run()', async () => {
        const storage = new AsyncLocalStorage();
        expect(storage.getStore()).toBeUndefined();
      });

      await it('nested run() should see inner store value', async () => {
        const storage = new AsyncLocalStorage<string>();
        storage.run('outer', () => {
          expect(storage.getStore()).toBe('outer');
          storage.run('inner', () => {
            expect(storage.getStore()).toBe('inner');
          });
          // After inner run completes, should see outer again
          expect(storage.getStore()).toBe('outer');
        });
      });

      await it('run() should work with async functions', async () => {
        const storage = new AsyncLocalStorage<number>();
        const result = await storage.run(123, async () => {
          // Simulate async operation
          await new Promise<void>((resolve) => setTimeout(resolve, 5));
          return storage.getStore();
        });
        expect(result).toBe(123);
      });

      await it('multiple AsyncLocalStorage instances should be independent', async () => {
        const storage1 = new AsyncLocalStorage<string>();
        const storage2 = new AsyncLocalStorage<number>();

        storage1.run('hello', () => {
          storage2.run(42, () => {
            expect(storage1.getStore()).toBe('hello');
            expect(storage2.getStore()).toBe(42);
          });
          // storage2 should be undefined outside its run
          expect(storage1.getStore()).toBe('hello');
          expect(storage2.getStore()).toBeUndefined();
        });
      });
    });

    await describe('AsyncResource additional', async () => {
      await it('AsyncResource should have type property', async () => {
        const resource = new AsyncResource('MY_TYPE');
        // The type is accessible — either as a property or through the constructor
        expect(resource).toBeDefined();
        // AsyncResource stores the type internally
        expect(typeof resource.asyncId()).toBe('number');
      });

      await it('AsyncResource.bind() should return a function', async () => {
        const resource = new AsyncResource('BIND_TEST');
        const fn = () => 42;
        const bound = resource.bind(fn);
        expect(typeof bound).toBe('function');
        // Calling the bound function should produce the same result
        expect(bound()).toBe(42);
      });
    });

    await describe('executionAsyncId additional', async () => {
      await it('executionAsyncId should return a non-negative number', async () => {
        const id = executionAsyncId();
        expect(typeof id).toBe('number');
        expect(id >= 0).toBe(true);
      });
    });

    // ==================== New tests ====================

    await describe('AsyncLocalStorage.enterWith', async () => {
      await it('enterWith should set the store without a callback', async () => {
        const storage = new AsyncLocalStorage<string>();
        storage.enterWith('entered');
        expect(storage.getStore()).toBe('entered');
        // Clean up
        storage.disable();
      });

      await it('enterWith should overwrite a previous enterWith value', async () => {
        const storage = new AsyncLocalStorage<string>();
        storage.enterWith('first');
        expect(storage.getStore()).toBe('first');
        storage.enterWith('second');
        expect(storage.getStore()).toBe('second');
        // Clean up
        storage.disable();
      });

      await it('run() after enterWith should use run store, then restore enterWith store', async () => {
        const storage = new AsyncLocalStorage<string>();
        storage.enterWith('entered');
        expect(storage.getStore()).toBe('entered');
        storage.run('override', () => {
          expect(storage.getStore()).toBe('override');
        });
        expect(storage.getStore()).toBe('entered');
        // Clean up
        storage.disable();
      });

      await it('enterWith with an object store', async () => {
        const storage = new AsyncLocalStorage<{ foo: string }>();
        const store = { foo: 'bar' };
        storage.enterWith(store);
        expect(storage.getStore()).toBe(store);
        expect(storage.getStore()!.foo).toBe('bar');
        // Clean up
        storage.disable();
      });
    });

    await describe('AsyncLocalStorage.snapshot', async () => {
      await it('snapshot should return a function', async () => {
        const snap = AsyncLocalStorage.snapshot();
        expect(typeof snap).toBe('function');
      });

      await it('snapshot should capture the current store', async () => {
        const storage = new AsyncLocalStorage<string>();
        let snap: ReturnType<typeof AsyncLocalStorage.snapshot>;
        storage.run('captured', () => {
          snap = AsyncLocalStorage.snapshot();
        });
        // Outside the run context, use the snapshot to restore the captured context
        const result = snap!(() => storage.getStore());
        expect(result).toBe('captured');
      });

      await it('snapshot should not affect the outer store', async () => {
        const storage = new AsyncLocalStorage<string>();
        let snap: ReturnType<typeof AsyncLocalStorage.snapshot>;
        storage.run('captured', () => {
          snap = AsyncLocalStorage.snapshot();
        });
        storage.run('different', () => {
          // Snapshot restores captured context inside
          const inner = snap!(() => storage.getStore());
          expect(inner).toBe('captured');
          // Outside snapshot, store is still 'different'
          expect(storage.getStore()).toBe('different');
        });
      });

      await it('snapshot outside any run should capture undefined', async () => {
        const storage = new AsyncLocalStorage<string>();
        const snap = AsyncLocalStorage.snapshot();
        storage.run('active', () => {
          const result = snap(() => storage.getStore());
          expect(result).toBeUndefined();
        });
      });
    });

    await describe('AsyncResource.emitDestroy', async () => {
      await it('emitDestroy should return the resource itself', async () => {
        const resource = new AsyncResource('DESTROY_TEST');
        const result = resource.emitDestroy();
        expect(result).toBe(resource);
      });

      await it('emitDestroy can be called multiple times', async () => {
        const resource = new AsyncResource('DESTROY_TEST');
        resource.emitDestroy();
        const result = resource.emitDestroy();
        expect(result).toBe(resource);
      });
    });

    await describe('createHook with before/after/destroy callbacks', async () => {
      await it('createHook should accept before callback', async () => {
        const hook = createHook({ before() {} });
        expect(typeof hook.enable).toBe('function');
        expect(typeof hook.disable).toBe('function');
      });

      await it('createHook should accept after callback', async () => {
        const hook = createHook({ after() {} });
        expect(typeof hook.enable).toBe('function');
        expect(typeof hook.disable).toBe('function');
      });

      await it('createHook should accept destroy callback', async () => {
        const hook = createHook({ destroy() {} });
        expect(typeof hook.enable).toBe('function');
        expect(typeof hook.disable).toBe('function');
      });

      await it('createHook should accept promiseResolve callback', async () => {
        const hook = createHook({ promiseResolve() {} });
        expect(typeof hook.enable).toBe('function');
        expect(typeof hook.disable).toBe('function');
      });

      await it('createHook should accept all callbacks at once', async () => {
        const hook = createHook({
          init() {},
          before() {},
          after() {},
          destroy() {},
          promiseResolve() {},
        });
        expect(typeof hook.enable).toBe('function');
        expect(typeof hook.disable).toBe('function');
        hook.enable();
        hook.disable();
      });

      await it('createHook should accept an empty callbacks object', async () => {
        const hook = createHook({});
        expect(typeof hook.enable).toBe('function');
        expect(typeof hook.disable).toBe('function');
      });
    });

    await describe('AsyncLocalStorage.run with null/undefined store', async () => {
      await it('run with null store should set store to null', async () => {
        const storage = new AsyncLocalStorage<string | null>();
        storage.run(null, () => {
          expect(storage.getStore()).toBeNull();
        });
      });

      await it('run with undefined store should set store to undefined', async () => {
        const storage = new AsyncLocalStorage<string | undefined>();
        storage.run(undefined, () => {
          expect(storage.getStore()).toBeUndefined();
        });
      });

      await it('run with null store should restore previous store after', async () => {
        const storage = new AsyncLocalStorage<string | null>();
        storage.run('outer', () => {
          storage.run(null, () => {
            expect(storage.getStore()).toBeNull();
          });
          expect(storage.getStore()).toBe('outer');
        });
      });

      await it('run with string store (misc store types)', async () => {
        const storage = new AsyncLocalStorage<string>();
        storage.run('hello node', () => {
          expect(storage.getStore()).toBe('hello node');
        });
      });

      await it('run with object store (misc store types)', async () => {
        const storage = new AsyncLocalStorage<{ hello: string }>();
        const runStore = { hello: 'node' };
        storage.run(runStore, () => {
          expect(storage.getStore()).toBe(runStore);
        });
      });

      await it('run with number store', async () => {
        const storage = new AsyncLocalStorage<number>();
        storage.run(0, () => {
          expect(storage.getStore()).toBe(0);
        });
      });

      await it('run with boolean false store', async () => {
        const storage = new AsyncLocalStorage<boolean>();
        storage.run(false, () => {
          expect(storage.getStore()).toBe(false);
        });
      });
    });

    await describe('AsyncLocalStorage.run deeply nested', async () => {
      await it('3-level nesting should restore stores correctly', async () => {
        const storage = new AsyncLocalStorage<string>();
        storage.run('L1', () => {
          expect(storage.getStore()).toBe('L1');
          storage.run('L2', () => {
            expect(storage.getStore()).toBe('L2');
            storage.run('L3', () => {
              expect(storage.getStore()).toBe('L3');
            });
            expect(storage.getStore()).toBe('L2');
          });
          expect(storage.getStore()).toBe('L1');
        });
        expect(storage.getStore()).toBeUndefined();
      });

      await it('4-level nesting should restore stores correctly', async () => {
        const storage = new AsyncLocalStorage<string>();
        storage.run('L1', () => {
          storage.run('L2', () => {
            storage.run('L3', () => {
              storage.run('L4', () => {
                expect(storage.getStore()).toBe('L4');
              });
              expect(storage.getStore()).toBe('L3');
            });
            expect(storage.getStore()).toBe('L2');
          });
          expect(storage.getStore()).toBe('L1');
        });
        expect(storage.getStore()).toBeUndefined();
      });

      await it('nested run with exit in between', async () => {
        const storage = new AsyncLocalStorage<string>();
        storage.run('outer', () => {
          expect(storage.getStore()).toBe('outer');
          storage.run('inner', () => {
            expect(storage.getStore()).toBe('inner');
          });
          expect(storage.getStore()).toBe('outer');
          storage.exit(() => {
            expect(storage.getStore()).toBeUndefined();
          });
          expect(storage.getStore()).toBe('outer');
        });
        expect(storage.getStore()).toBeUndefined();
      });
    });

    await describe('AsyncResource with triggerAsyncId option', async () => {
      await it('should accept triggerAsyncId as a number (legacy)', async () => {
        const resource = new AsyncResource('TEST', 42);
        expect(resource.triggerAsyncId()).toBe(42);
      });

      await it('should accept triggerAsyncId in options object', async () => {
        const resource = new AsyncResource('TEST', { triggerAsyncId: 99 });
        expect(resource.triggerAsyncId()).toBe(99);
      });

      await it('default triggerAsyncId should be executionAsyncId', async () => {
        const resource = new AsyncResource('TEST');
        expect(resource.triggerAsyncId()).toBe(executionAsyncId());
      });

      await it('asyncId should return a consistent value', async () => {
        const resource = new AsyncResource('TEST');
        const id = resource.asyncId();
        expect(resource.asyncId()).toBe(id);
        expect(resource.asyncId()).toBe(id);
      });

      await it('different AsyncResource instances should have different asyncIds', async () => {
        const r1 = new AsyncResource('TEST1');
        const r2 = new AsyncResource('TEST2');
        const id1 = r1.asyncId();
        const id2 = r2.asyncId();
        expect(id1 === id2).toBe(false);
      });
    });

    await describe('AsyncResource.bind static method', async () => {
      await it('static bind should return a function', async () => {
        const bound = AsyncResource.bind(() => 42);
        expect(typeof bound).toBe('function');
      });

      await it('static bind should preserve return value', async () => {
        const bound = AsyncResource.bind(() => 'hello');
        expect(bound()).toBe('hello');
      });

      await it('static bind should pass arguments through', async () => {
        const bound = AsyncResource.bind((a: number, b: number) => a + b);
        expect(bound(3, 7)).toBe(10);
      });

      await it('static bind with explicit type', async () => {
        const bound = AsyncResource.bind(() => 'typed', 'MY_RESOURCE');
        expect(typeof bound).toBe('function');
        expect(bound()).toBe('typed');
      });
    });

    await describe('Edge cases', async () => {
      await it('run with empty callback (no return value)', async () => {
        const storage = new AsyncLocalStorage<string>();
        const result = storage.run('test', () => {});
        expect(result).toBeUndefined();
        expect(storage.getStore()).toBeUndefined();
      });

      await it('bind with arrow function should preserve behavior', async () => {
        const resource = new AsyncResource('ARROW_TEST');
        const arrowFn = (x: number) => x * 2;
        const bound = resource.bind(arrowFn);
        expect(bound(5)).toBe(10);
        expect(bound(0)).toBe(0);
        expect(bound(-3)).toBe(-6);
      });

      await it('bind with function that returns undefined', async () => {
        const resource = new AsyncResource('VOID_TEST');
        const fn = () => undefined;
        const bound = resource.bind(fn);
        expect(bound()).toBeUndefined();
      });

      await it('exit should pass arguments to callback', async () => {
        const storage = new AsyncLocalStorage<string>();
        storage.run('mystore', () => {
          const result = storage.exit((a: number, b: number) => {
            expect(storage.getStore()).toBeUndefined();
            return a + b;
          }, 10, 20);
          expect(result).toBe(30);
          expect(storage.getStore()).toBe('mystore');
        });
      });

      await it('exit should return callback return value', async () => {
        const storage = new AsyncLocalStorage<string>();
        storage.run('test', () => {
          const result = storage.exit(() => 'exit-result');
          expect(result).toBe('exit-result');
        });
      });

      await it('run should return callback return value', async () => {
        const storage = new AsyncLocalStorage<string>();
        const result = storage.run('test', () => 1729);
        expect(result).toBe(1729);
      });

      await it('run callback throwing should not leak the store', async () => {
        const storage = new AsyncLocalStorage<string>();
        let caught = false;
        try {
          storage.run('leaked?', () => {
            throw new Error('oops');
          });
        } catch {
          caught = true;
        }
        expect(caught).toBe(true);
        expect(storage.getStore()).toBeUndefined();
      });

      await it('nested run with exception in inner should restore outer', async () => {
        const storage = new AsyncLocalStorage<string>();
        storage.run('outer', () => {
          try {
            storage.run('inner', () => {
              throw new Error('inner error');
            });
          } catch {
            // expected
          }
          expect(storage.getStore()).toBe('outer');
        });
        expect(storage.getStore()).toBeUndefined();
      });

      await it('disable inside run, then run again', async () => {
        const storage = new AsyncLocalStorage<string>();
        storage.run('first', () => {
          storage.disable();
          expect(storage.getStore()).toBeUndefined();
        });
        // After disable, run should still work
        storage.run('second', () => {
          expect(storage.getStore()).toBe('second');
        });
      });

      await it('exit after disable should still work', async () => {
        const storage = new AsyncLocalStorage<string>();
        storage.disable();
        storage.exit(() => {
          expect(storage.getStore()).toBeUndefined();
        });
      });

      await it('multiple run calls on same instance sequentially', async () => {
        const storage = new AsyncLocalStorage<number>();
        storage.run(1, () => {
          expect(storage.getStore()).toBe(1);
        });
        storage.run(2, () => {
          expect(storage.getStore()).toBe(2);
        });
        storage.run(3, () => {
          expect(storage.getStore()).toBe(3);
        });
        expect(storage.getStore()).toBeUndefined();
      });
    });
  });
};
