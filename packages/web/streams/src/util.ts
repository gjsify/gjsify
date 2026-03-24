// WHATWG Streams — shared utilities
// Adapted from refs/node/lib/internal/webstreams/util.js
// Copyright (c) Node.js contributors. MIT license.
// Modifications: Removed primordials, internalBinding, Node.js error codes

export const kState = Symbol('kState');
export const kType = Symbol('kType');

// ---- Brand checking ----

export function isBrandCheck(brand: string) {
  return (value: any): boolean => {
    return value != null &&
           value[kState] !== undefined &&
           value[kType] === brand;
  };
}

// ---- Queue management ----

export function dequeueValue(controller: any): any {
  const { value, size } = controller[kState].queue.shift();
  controller[kState].queueTotalSize =
    Math.max(0, controller[kState].queueTotalSize - size);
  return value;
}

export function resetQueue(controller: any): void {
  controller[kState].queue = [];
  controller[kState].queueTotalSize = 0;
}

export function peekQueueValue(controller: any): any {
  return controller[kState].queue[0].value;
}

export function enqueueValueWithSize(controller: any, value: any, size: number): void {
  size = +size;
  if (typeof size !== 'number' || size < 0 || Number.isNaN(size) || size === Infinity) {
    throw new RangeError(`Invalid size: ${size}`);
  }
  controller[kState].queue.push({ value, size });
  controller[kState].queueTotalSize += size;
}

// ---- Strategy extraction ----

export function extractHighWaterMark(value: number | undefined, defaultHWM: number): number {
  if (value === undefined) return defaultHWM;
  value = +value;
  if (typeof value !== 'number' || Number.isNaN(value) || value < 0) {
    throw new RangeError(`Invalid highWaterMark: ${value}`);
  }
  return value;
}

export function extractSizeAlgorithm(size: ((chunk: any) => number) | undefined): (chunk: any) => number {
  if (size === undefined) return () => 1;
  if (typeof size !== 'function') {
    throw new TypeError('strategy.size must be a function');
  }
  return size;
}

// ---- Buffer utilities ----

export function cloneAsUint8Array(view: ArrayBufferView): Uint8Array {
  const buffer = view.buffer;
  const byteOffset = view.byteOffset;
  const byteLength = view.byteLength;
  return new Uint8Array(buffer.slice(byteOffset, byteOffset + byteLength));
}

export function ArrayBufferViewGetBuffer(view: ArrayBufferView): ArrayBuffer {
  return view.buffer;
}

export function ArrayBufferViewGetByteLength(view: ArrayBufferView): number {
  return view.byteLength;
}

export function ArrayBufferViewGetByteOffset(view: ArrayBufferView): number {
  return view.byteOffset;
}

// ---- Promise utilities ----

export function setPromiseHandled(promise: Promise<any>): void {
  promise.then(() => {}, () => {});
}

export function createPromiseCallback(name: string, fn: Function, thisArg: any) {
  if (typeof fn !== 'function') {
    throw new TypeError(`${name} must be a function`);
  }
  // Always return a Promise, even if fn is synchronous
  return async (...args: any[]) => fn.call(thisArg, ...args);
}

// ---- No-op callbacks ----

export async function nonOpFlush(): Promise<void> {}
export function nonOpStart(): void {}
export async function nonOpPull(): Promise<void> {}
export async function nonOpCancel(): Promise<void> {}
export async function nonOpWrite(): Promise<void> {}

// ---- Iterator utilities ----

const AsyncIteratorPrototype = Object.getPrototypeOf(
  Object.getPrototypeOf(async function* () {}).prototype
);

export const AsyncIterator = {
  __proto__: AsyncIteratorPrototype,
  next: undefined as any,
  return: undefined as any,
};

export function createAsyncFromSyncIterator(syncIteratorRecord: any) {
  const syncIterable = {
    [Symbol.iterator]: () => syncIteratorRecord.iterator,
  };
  const asyncIterator = (async function* () {
    return yield* syncIterable;
  }());
  const nextMethod = asyncIterator.next;
  return { iterator: asyncIterator, nextMethod, done: false };
}

export function getIterator(obj: any, kind: 'sync' | 'async' = 'sync', method?: Function) {
  if (method === undefined) {
    if (kind === 'async') {
      method = obj[Symbol.asyncIterator];
      if (method == null) {
        const syncMethod = obj[Symbol.iterator];
        if (syncMethod === undefined) {
          throw new TypeError('Object is not iterable');
        }
        const syncIteratorRecord = getIterator(obj, 'sync', syncMethod);
        return createAsyncFromSyncIterator(syncIteratorRecord);
      }
    } else {
      method = obj[Symbol.iterator];
    }
  }
  if (method === undefined) {
    throw new TypeError('Object is not iterable');
  }
  const iterator = method.call(obj);
  if (typeof iterator !== 'object' || iterator === null) {
    throw new TypeError('The iterator method must return an object');
  }
  const nextMethod = iterator.next;
  return { iterator, nextMethod, done: false };
}

export function iteratorNext(iteratorRecord: any, value?: any) {
  let result;
  if (value === undefined) {
    result = iteratorRecord.nextMethod.call(iteratorRecord.iterator);
  } else {
    result = iteratorRecord.nextMethod.call(iteratorRecord.iterator, value);
  }
  if (typeof result !== 'object' || result === null) {
    throw new TypeError('The iterator.next() method must return an object');
  }
  return result;
}
