// Reference: Node.js lib/internal/worker/io.js
// Reimplemented for GJS using EventEmitter

import { EventEmitter } from 'events';

/**
 * MessagePort for bidirectional communication between paired ports.
 * Auto-starts when a 'message' listener is added (Node.js behavior).
 */
export class MessagePort extends EventEmitter {
  private _started = false;
  private _closed = false;
  private _messageQueue: unknown[] = [];
  /** @internal Linked port for in-process communication */
  _otherPort: MessagePort | null = null;

  /**
   * Start receiving queued messages. Called automatically when
   * a 'message' event listener is added.
   */
  start(): void {
    if (this._started || this._closed) return;
    this._started = true;
    this._drainQueue();
  }

  /**
   * Disconnect the port and stop receiving messages.
   */
  close(): void {
    if (this._closed) return;
    this._closed = true;
    const other = this._otherPort;
    this._otherPort = null;
    if (other) other._otherPort = null;
    this.emit('close');
    this.removeAllListeners();
  }

  /**
   * Send a message to the paired port.
   * The value is cloned using structuredClone (or JSON fallback).
   */
  postMessage(value: unknown, _transferList?: unknown[]): void {
    if (this._closed) return;
    const target = this._otherPort;
    if (!target) return;

    let cloned: unknown;
    try {
      cloned = typeof structuredClone === 'function'
        ? structuredClone(value)
        : JSON.parse(JSON.stringify(value));
    } catch (err) {
      this.emit('messageerror', err instanceof Error ? err : new Error('Could not clone message'));
      return;
    }
    target._receiveMessage(cloned);
  }

  ref(): this { return this; }
  unref(): this { return this; }

  /** @internal Called by the paired port's postMessage. */
  _receiveMessage(message: unknown): void {
    if (this._closed) return;
    if (!this._started) {
      this._messageQueue.push(message);
      return;
    }
    this._dispatchMessage(message);
  }

  /** @internal Check if there are queued messages. */
  get _hasQueuedMessages(): boolean {
    return this._messageQueue.length > 0;
  }

  /** @internal Dequeue the oldest message (for receiveMessageOnPort). */
  _dequeueMessage(): unknown | undefined {
    return this._messageQueue.shift();
  }

  private _drainQueue(): void {
    while (this._messageQueue.length > 0) {
      this._dispatchMessage(this._messageQueue.shift());
    }
  }

  private _dispatchMessage(message: unknown): void {
    // Deliver asynchronously via microtask (matches Node.js behavior)
    Promise.resolve().then(() => {
      if (!this._closed) {
        this.emit('message', message);
      }
    });
  }

  // Auto-start when 'message' listener is added
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
