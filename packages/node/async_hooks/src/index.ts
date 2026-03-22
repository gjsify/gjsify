import { EventEmitter } from 'events';

let _id = 1;

export function executionAsyncId(): number {
  return _id;
}

export function triggerAsyncId(): number {
  return 0;
}

export function createHook(_callbacks: any): { enable(): any; disable(): any } {
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

  runInAsyncScope<T>(fn: (...args: any[]) => T, thisArg?: any, ...args: any[]): T {
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
}

export class AsyncLocalStorage<T = any> {
  private _store: T | undefined;

  getStore(): T | undefined {
    return this._store;
  }

  run<R>(store: T, callback: () => R): R {
    const prev = this._store;
    this._store = store;
    try {
      return callback();
    } finally {
      this._store = prev;
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
