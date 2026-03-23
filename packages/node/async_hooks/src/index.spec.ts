import { describe, it, expect } from '@gjsify/unit';
import { AsyncLocalStorage, AsyncResource, executionAsyncId, triggerAsyncId, createHook } from 'async_hooks';

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
  });
};
