// Reference: Node.js lib/internal/worker/io.js
// Reimplemented for GJS using EventEmitter

import { EventEmitter } from 'node:events';

export class MessagePort extends EventEmitter {
  private _started = false;
  private _closed = false;
  private _messageQueue: unknown[] = [];
  /** @internal Linked port for in-process communication */
  _otherPort: MessagePort | null = null;
  /** @internal Maps addEventListener listeners to their internal wrappers */
  private _aeWrappers: Map<((event: unknown) => void), ((data: unknown) => void)> = new Map();

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
      cloned = structuredClone(value);
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
    Promise.resolve().then(() => {
      if (!this._closed) {
        this.emit('message', message);
      }
    });
  }

  /**
   * Web-compatible addEventListener. Wraps message data in a MessageEvent-like
   * object `{ data, type }` before calling the listener.
   * Requires explicit `port.start()` call (unlike `on('message')` which auto-starts).
   */
  addEventListener(type: string, listener: ((event: unknown) => void) | null): void {
    if (!listener) return;
    if (type === 'message') {
      const wrapper = (data: unknown) => {
        listener({ data, type: 'message' });
      };
      this._aeWrappers.set(listener, wrapper);
      super.on('message', wrapper);
    } else {
      super.on(type, listener);
    }
  }

  removeEventListener(type: string, listener: ((event: unknown) => void) | null): void {
    if (!listener) return;
    if (type === 'message') {
      const wrapper = this._aeWrappers.get(listener);
      if (wrapper) {
        super.off('message', wrapper);
        this._aeWrappers.delete(listener);
      }
    } else {
      super.off(type, listener);
    }
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
