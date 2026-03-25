// Reference: Node.js lib/internal/worker/io.js
// Reimplemented for GJS using EventEmitter

import { EventEmitter } from 'events';

/**
 * Clone a value, preferring structuredClone when available,
 * falling back to a deep clone that handles common types.
 * Handles: primitives, plain objects, arrays, Date, RegExp, Map, Set, Error,
 * ArrayBuffer, TypedArrays. Does NOT handle circular references or Symbols.
 */
function cloneValue(value: unknown): unknown {
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(value);
  }
  return deepClone(value);
}

function deepClone(value: unknown, seen = new Map<object, unknown>()): unknown {
  // Primitives and null/undefined
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object' && typeof value !== 'function') return value;

  const obj = value as object;

  // Check for circular references
  if (seen.has(obj)) return seen.get(obj);

  // Date
  if (obj instanceof Date) return new Date(obj.getTime());

  // RegExp
  if (obj instanceof RegExp) return new RegExp(obj.source, obj.flags);

  // Error
  if (obj instanceof Error) {
    const cloned = new Error(obj.message);
    cloned.name = obj.name;
    if (obj.stack) cloned.stack = obj.stack;
    return cloned;
  }

  // ArrayBuffer
  if (obj instanceof ArrayBuffer) return obj.slice(0);

  // TypedArrays
  if (ArrayBuffer.isView(obj)) {
    const TypedArrayCtor = (obj as any).constructor as new (buffer: ArrayBuffer) => ArrayBufferView;
    const buf = (obj as any).buffer.slice((obj as any).byteOffset, (obj as any).byteOffset + (obj as any).byteLength);
    return new TypedArrayCtor(buf);
  }

  // Map
  if (obj instanceof Map) {
    const cloned = new Map();
    seen.set(obj, cloned);
    for (const [k, v] of obj) {
      cloned.set(deepClone(k, seen), deepClone(v, seen));
    }
    return cloned;
  }

  // Set
  if (obj instanceof Set) {
    const cloned = new Set();
    seen.set(obj, cloned);
    for (const v of obj) {
      cloned.add(deepClone(v, seen));
    }
    return cloned;
  }

  // Array
  if (Array.isArray(obj)) {
    const cloned: unknown[] = [];
    seen.set(obj, cloned);
    for (let i = 0; i < obj.length; i++) {
      cloned[i] = deepClone(obj[i], seen);
    }
    return cloned;
  }

  // Plain object
  const cloned: Record<string, unknown> = {};
  seen.set(obj, cloned);
  for (const key of Object.keys(obj)) {
    cloned[key] = deepClone((obj as Record<string, unknown>)[key], seen);
  }
  return cloned;
}

export class MessagePort extends EventEmitter {
  private _started = false;
  private _closed = false;
  private _messageQueue: unknown[] = [];
  /** @internal Linked port for in-process communication */
  _otherPort: MessagePort | null = null;

  start(): void {
    if (this._started || this._closed) return;
    this._started = true;
    this._drainQueue();
  }

  close(): void {
    if (this._closed) return;
    this._closed = true;
    const other = this._otherPort;
    this._otherPort = null;
    if (other) other._otherPort = null;
    this.emit('close');
    this.removeAllListeners();
  }

  postMessage(value: unknown, _transferList?: unknown[]): void {
    if (this._closed) return;
    const target = this._otherPort;
    if (!target) return;

    let cloned: unknown;
    try {
      cloned = cloneValue(value);
    } catch (err) {
      this.emit('messageerror', err instanceof Error ? err : new Error('Could not clone message'));
      return;
    }
    target._receiveMessage(cloned);
  }

  ref(): this { return this; }
  unref(): this { return this; }

  _receiveMessage(message: unknown): void {
    if (this._closed) return;
    if (!this._started) {
      this._messageQueue.push(message);
      return;
    }
    this._dispatchMessage(message);
  }

  get _hasQueuedMessages(): boolean {
    return this._messageQueue.length > 0;
  }

  _dequeueMessage(): unknown | undefined {
    return this._messageQueue.shift();
  }

  private _drainQueue(): void {
    while (this._messageQueue.length > 0) {
      this._dispatchMessage(this._messageQueue.shift());
    }
  }

  private _dispatchMessage(message: unknown): void {
    setTimeout(() => {
      if (!this._closed) {
        this.emit('message', message);
      }
    }, 0);
  }

  on(event: string | symbol, listener: (...args: unknown[]) => void): this {
    super.on(event, listener);
    if (event === 'message' && !this._started) {
      this.start();
    }
    return this;
  }

  addListener(event: string | symbol, listener: (...args: unknown[]) => void): this {
    return this.on(event, listener);
  }

  once(event: string | symbol, listener: (...args: unknown[]) => void): this {
    super.once(event, listener);
    if (event === 'message' && !this._started) {
      this.start();
    }
    return this;
  }
}
