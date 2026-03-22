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
  });
};
