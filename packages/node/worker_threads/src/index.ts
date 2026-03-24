// Reference: Node.js lib/worker_threads.js
// Reimplemented for GJS — MessageChannel/BroadcastChannel are pure JS,
// Worker uses Gio.Subprocess (subprocess-based workers)

import { MessagePort } from './message-port.ts';
import { Worker } from './worker.ts';
import type { WorkerOptions } from './worker.ts';

export { MessagePort } from './message-port.ts';
export { Worker } from './worker.ts';
export type { WorkerOptions } from './worker.ts';

// --- Worker context detection ---
// When running inside a Worker subprocess, the bootstrap script sets
// globalThis.__gjsify_worker_context before importing the user's code.
// This lets bundled scripts that import from 'worker_threads' get the
// correct parentPort, workerData, and threadId for the worker process.

const _ctx = typeof globalThis !== 'undefined'
  ? (globalThis as Record<string, unknown>).__gjsify_worker_context as
    { isMainThread: boolean; parentPort: unknown; workerData: unknown; threadId: number } | undefined
  : undefined;

/** True in the main thread, false inside a Worker subprocess. */
export const isMainThread: boolean = _ctx ? false : true;

/** The MessagePort for communicating with the parent (null in main thread). */
export const parentPort: MessagePort | null = (_ctx?.parentPort as MessagePort) ?? null;

/** Data passed from the parent via WorkerOptions.workerData (null in main thread). */
export const workerData: unknown = _ctx?.workerData ?? null;

/** 0 in the main thread; workers get incrementing IDs. */
export const threadId: number = _ctx?.threadId ?? 0;

/** Resource limits (empty in main thread). */
export const resourceLimits: Record<string, unknown> = {};

/** Symbol for sharing the parent's environment in Worker options. */
export const SHARE_ENV: unique symbol = Symbol('worker_threads.SHARE_ENV');

// --- MessageChannel ---

/**
 * Creates a pair of linked MessagePorts for bidirectional communication.
 */
export class MessageChannel {
  readonly port1: MessagePort;
  readonly port2: MessagePort;

  constructor() {
    this.port1 = new MessagePort();
    this.port2 = new MessagePort();
    this.port1._otherPort = this.port2;
    this.port2._otherPort = this.port1;
  }
}

// --- BroadcastChannel ---

/** @internal Global registry for BroadcastChannels by name. */
const _broadcastRegistry = new Map<string, Set<BroadcastChannel>>();

/**
 * BroadcastChannel for one-to-many communication within the same process.
 * Follows the W3C BroadcastChannel API (uses onmessage property, not EventEmitter).
 */
export class BroadcastChannel {
  readonly name: string;
  private _closed = false;

  /** W3C-style message handler. Receives { data } events. */
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onmessageerror: ((event: { data: unknown }) => void) | null = null;

  constructor(name: string) {
    this.name = String(name);
    if (!_broadcastRegistry.has(this.name)) {
      _broadcastRegistry.set(this.name, new Set());
    }
    _broadcastRegistry.get(this.name)!.add(this);
  }

  /**
   * Broadcast a message to all other BroadcastChannels with the same name.
   * Throws if the channel is closed.
   */
  postMessage(message: unknown): void {
    if (this._closed) {
      throw new Error('BroadcastChannel is closed');
    }

    const channels = _broadcastRegistry.get(this.name);
    if (!channels) return;

    let cloned: unknown;
    try {
      cloned = typeof structuredClone === 'function'
        ? structuredClone(message)
        : JSON.parse(JSON.stringify(message));
    } catch {
      return;
    }

    for (const channel of channels) {
      if (channel !== this && !channel._closed) {
        Promise.resolve().then(() => {
          if (!channel._closed && channel.onmessage) {
            channel.onmessage({ data: cloned });
          }
        });
      }
    }
  }

  /** Close the channel and remove it from the global registry. */
  close(): void {
    if (this._closed) return;
    this._closed = true;
    const channels = _broadcastRegistry.get(this.name);
    if (channels) {
      channels.delete(this);
      if (channels.size === 0) {
        _broadcastRegistry.delete(this.name);
      }
    }
    this.onmessage = null;
    this.onmessageerror = null;
  }

  /** Simplified EventTarget-compatible addEventListener. */
  addEventListener(type: string, listener: ((event: unknown) => void) | null): void {
    if (type === 'message') {
      this.onmessage = listener as ((event: { data: unknown }) => void) | null;
    } else if (type === 'messageerror') {
      this.onmessageerror = listener as ((event: { data: unknown }) => void) | null;
    }
  }

  removeEventListener(type: string, _listener: ((event: unknown) => void) | null): void {
    if (type === 'message') this.onmessage = null;
    else if (type === 'messageerror') this.onmessageerror = null;
  }

  dispatchEvent(_event: Event): boolean {
    return true;
  }
}

// --- Utility functions ---

/** @internal Environment data store (process-local). */
const _environmentData = new Map<string, unknown>();

/** Set environment data accessible by all workers in this process. */
export function setEnvironmentData(key: string, value: unknown): void {
  if (value === undefined) {
    _environmentData.delete(String(key));
  } else {
    _environmentData.set(String(key), value);
  }
}

/** Get environment data previously set by setEnvironmentData. */
export function getEnvironmentData(key: string): unknown {
  return _environmentData.get(String(key));
}

/**
 * Synchronously receive a single message from a MessagePort.
 * Returns { message } if available, undefined otherwise.
 */
export function receiveMessageOnPort(port: MessagePort): { message: unknown } | undefined {
  if (!port._hasQueuedMessages) return undefined;
  return { message: port._dequeueMessage() };
}

/**
 * Mark an object as not transferable via postMessage.
 * No-op in GJS — all messages are cloned, not transferred.
 */
export function markAsUntransferable(_object: unknown): void {}

/**
 * Mark an object as not cloneable via structured clone.
 * No-op in current implementation.
 */
export function markAsUncloneable(_object: unknown): void {}

/**
 * Move a MessagePort to a different VM context.
 * No-op in GJS — returns port unchanged.
 */
export function moveMessagePortToContext(port: MessagePort, _context: unknown): MessagePort {
  return port;
}

// --- Default export ---

export default {
  isMainThread,
  parentPort,
  workerData,
  threadId,
  resourceLimits,
  SHARE_ENV,
  Worker,
  MessageChannel,
  MessagePort,
  BroadcastChannel,
  setEnvironmentData,
  getEnvironmentData,
  receiveMessageOnPort,
  markAsUntransferable,
  markAsUncloneable,
  moveMessagePortToContext,
};
