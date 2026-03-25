// Reference: Node.js lib/async_hooks.js
// Reimplemented for GJS

import { EventEmitter } from 'node:events';

let _id = 1;

export function executionAsyncId(): number {
  return _id;
}

export function triggerAsyncId(): number {
  return 0;
}

interface HookCallbacks {
  init?(asyncId: number, type: string, triggerAsyncId: number, resource: object): void;
  before?(asyncId: number): void;
  after?(asyncId: number): void;
  destroy?(asyncId: number): void;
  promiseResolve?(asyncId: number): void;
}

interface AsyncHook {
  enable(): AsyncHook;
  disable(): AsyncHook;
}

export function createHook(_callbacks: HookCallbacks): AsyncHook {
  return {
    enable() {
      return this;
    },
    disable() {
      return this;
    },
  };
}

export class AsyncResource {
  private _type: string;

  constructor(type: string) {
    this._type = type;
  }

  runInAsyncScope<T>(fn: (...args: unknown[]) => T, thisArg?: unknown, ...args: unknown[]): T {
    return fn.apply(thisArg, args);
  }

  emitDestroy(): this {
    return this;
  }

  asyncId(): number {
    return _id++;
  }

  triggerAsyncId(): number {
    return 0;
  }

  bind<Func extends (...args: unknown[]) => unknown>(fn: Func): Func {
    return ((...args: unknown[]) => {
      return this.runInAsyncScope(fn, undefined, ...args);
    }) as unknown as Func;
  }

  static bind<Func extends (...args: unknown[]) => unknown>(fn: Func, type?: string): Func {
    const resource = new AsyncResource(type || fn.name || 'bound-anonymous-fn');
    return resource.bind(fn);
  }
}

export class AsyncLocalStorage<T = unknown> {
  private _store: T | undefined;

  getStore(): T | undefined {
    return this._store;
  }

  run<R>(store: T, callback: (...args: unknown[]) => R, ...args: unknown[]): R {
    const prev = this._store;
    this._store = store;
    try {
      const result = callback(...args);
      if (result != null && typeof (result as unknown as PromiseLike<unknown>).then === 'function') {
        // Async callback — restore store when the promise settles
        return (result as unknown as PromiseLike<unknown>).then(
          (value: unknown) => { this._store = prev; return value; },
          (err: unknown) => { this._store = prev; throw err; },
        ) as R;
      }
      // Sync callback — restore immediately
      this._store = prev;
      return result;
    } catch (err) {
      this._store = prev;
      throw err;
    }
  }

  exit<R>(callback: () => R): R {
    const prev = this._store;
    this._store = undefined;
    try {
      return callback();
    } finally {
      this._store = prev;
    }
  }

  enterWith(store: T): void {
    this._store = store;
  }

  disable(): void {
    this._store = undefined;
  }
}

export default {
  executionAsyncId,
  triggerAsyncId,
  createHook,
  AsyncResource,
  AsyncLocalStorage,
};
