// WHATWG Streams — shared utilities
// Adapted from refs/node/lib/internal/webstreams/util.js
// Copyright (c) Node.js contributors. MIT license.
// Modifications: Removed primordials, internalBinding, Node.js error codes

export const kState = Symbol('kState');
export const kType = Symbol('kType');

// ---- Brand checking ----

export function isBrandCheck(brand: string) {
  return (value: unknown): boolean => {
    return value != null &&
           typeof value === 'object' &&
           (value as Record<symbol, unknown>)[kState] !== undefined &&
           (value as Record<symbol, unknown>)[kType] === brand;
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

// Transfer an ArrayBuffer to a fixed-length copy that detaches the source.
// SM140 / Node 24+ supports `ArrayBuffer.prototype.transfer`. If unavailable,
// fall back to a `slice` (which copies but does NOT detach). The spec
// (https://streams.spec.whatwg.org/#transfer-array-buffer) requires detach,
// so we treat the fallback as best-effort.
export function transferArrayBuffer(buffer: ArrayBufferLike): ArrayBuffer {
  // SharedArrayBuffer doesn't have transfer; slice it.
  const proto = ArrayBuffer.prototype as unknown as { transfer?: (newByteLength?: number) => ArrayBuffer };
  if (typeof proto.transfer === 'function') {
    return (buffer as ArrayBuffer).transfer();
  }
  return (buffer as ArrayBuffer).slice(0);
}

export function isDetachedBuffer(buffer: ArrayBufferLike): boolean {
  // SharedArrayBuffer is never detached.
  if (typeof SharedArrayBuffer !== 'undefined' && buffer instanceof SharedArrayBuffer) {
    return false;
  }
  // A detached ArrayBuffer has byteLength === 0 AND cannot be sliced.
  // Reading byteLength on a detached buffer returns 0; touching .slice throws.
  if ((buffer as ArrayBuffer).byteLength !== 0) return false;
  try {
    (buffer as ArrayBuffer).slice(0, 0);
    return false;
  } catch {
    return true;
  }
}

// Map a TypedArray's [[Symbol.toStringTag]] back to its constructor.
// Returns undefined for plain DataView (caller should use DataView).
export function typedArrayConstructorByTag(tag: string | undefined): (new (buffer: ArrayBufferLike, byteOffset?: number, length?: number) => ArrayBufferView) | undefined {
  switch (tag) {
    case 'Int8Array': return Int8Array as unknown as any;
    case 'Uint8Array': return Uint8Array as unknown as any;
    case 'Uint8ClampedArray': return Uint8ClampedArray as unknown as any;
    case 'Int16Array': return Int16Array as unknown as any;
    case 'Uint16Array': return Uint16Array as unknown as any;
    case 'Int32Array': return Int32Array as unknown as any;
    case 'Uint32Array': return Uint32Array as unknown as any;
    case 'Float32Array': return Float32Array as unknown as any;
    case 'Float64Array': return Float64Array as unknown as any;
    case 'BigInt64Array': return typeof BigInt64Array !== 'undefined' ? (BigInt64Array as unknown as any) : undefined;
    case 'BigUint64Array': return typeof BigUint64Array !== 'undefined' ? (BigUint64Array as unknown as any) : undefined;
    default: return undefined;
  }
}

// Per-element byte size lookup (matches TypedArray.BYTES_PER_ELEMENT).
export function elementSizeByTag(tag: string | undefined): number {
  switch (tag) {
    case 'Int8Array':
    case 'Uint8Array':
    case 'Uint8ClampedArray':
      return 1;
    case 'Int16Array':
    case 'Uint16Array':
      return 2;
    case 'Int32Array':
    case 'Uint32Array':
    case 'Float32Array':
      return 4;
    case 'Float64Array':
    case 'BigInt64Array':
    case 'BigUint64Array':
      return 8;
    default:
      return 1;
  }
}

export function ArrayBufferViewGetBuffer(view: ArrayBufferView): ArrayBuffer {
  return view.buffer as ArrayBuffer;
}

export function ArrayBufferViewGetByteLength(view: ArrayBufferView): number {
  return view.byteLength;
}

export function ArrayBufferViewGetByteOffset(view: ArrayBufferView): number {
  return view.byteOffset;
}

// ---- Promise utilities ----

export function setPromiseHandled(promise: Promise<unknown>): void {
  promise.then(() => {}, () => {});
}

export function createPromiseCallback(name: string, fn: Function, thisArg: unknown) {
  if (typeof fn !== 'function') {
    throw new TypeError(`${name} must be a function`);
  }
  // Always return a Promise, even if fn is synchronous
  return async (...args: unknown[]) => fn.call(thisArg, ...args);
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
  next: undefined as (() => Promise<IteratorResult<unknown>>) | undefined,
  return: undefined as ((value?: unknown) => Promise<IteratorResult<unknown>>) | undefined,
};

export function createAsyncFromSyncIterator(syncIteratorRecord: { iterator: Iterator<unknown>; nextMethod: Function; done: boolean }) {
  const syncIterable = {
    [Symbol.iterator]: () => syncIteratorRecord.iterator,
  };
  const asyncIterator = (async function* () {
    return yield* syncIterable;
  }());
  const nextMethod = asyncIterator.next;
  return { iterator: asyncIterator, nextMethod, done: false };
}

export function getIterator(obj: Record<string | symbol, unknown>, kind: 'sync' | 'async' = 'sync', method?: Function) {
  if (method === undefined) {
    if (kind === 'async') {
      method = obj[Symbol.asyncIterator] as Function | undefined;
      if (method == null) {
        const syncMethod = obj[Symbol.iterator] as Function | undefined;
        if (syncMethod === undefined) {
          throw new TypeError('Object is not iterable');
        }
        const syncIteratorRecord = getIterator(obj, 'sync', syncMethod);
        return createAsyncFromSyncIterator(syncIteratorRecord);
      }
    } else {
      method = obj[Symbol.iterator] as Function | undefined;
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

export function iteratorNext(iteratorRecord: { iterator: unknown; nextMethod: Function; done: boolean }, value?: unknown) {
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
