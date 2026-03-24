// Reference: Node.js lib/internal/worker/io.js
// Reimplemented for GJS using EventEmitter

import { EventEmitter } from 'events';

/** Clone a value, preferring structuredClone when available, falling back to JSON round-trip. */
function cloneValue(value: unknown): unknown {
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(value);
  }
  // JSON round-trip: handles primitives, plain objects, arrays. Loses Date/RegExp/etc.
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
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
