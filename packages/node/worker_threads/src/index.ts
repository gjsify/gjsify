// Reference: Node.js lib/worker_threads.js
// Reimplemented for GJS — MessageChannel/BroadcastChannel are pure JS,
// Worker uses Gio.Subprocess (subprocess-based workers)

/** Clone a value, preferring structuredClone when available, falling back to JSON round-trip. */
function cloneValue(value: unknown): unknown {
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(value);
  }
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

export { MessagePort } from './message-port.ts';
export { Worker } from './worker.ts';
export type { WorkerOptions } from './worker.ts';

import { MessagePort } from './message-port.ts';
import { Worker } from './worker.ts';

// When running inside a Worker subprocess, the bootstrap script sets
// globalThis.__gjsify_worker_context before importing the user's code.
const _ctx = (globalThis as Record<string, unknown>).__gjsify_worker_context as
  { isMainThread: boolean; parentPort: unknown; workerData: unknown; threadId: number } | undefined;

export const isMainThread: boolean = !_ctx;
export const parentPort: MessagePort | null = (_ctx?.parentPort as MessagePort) ?? null;
export const workerData: unknown = _ctx?.workerData ?? null;
export const threadId: number = _ctx?.threadId ?? 0;
export const resourceLimits: Record<string, unknown> = {};
export const SHARE_ENV: unique symbol = Symbol('worker_threads.SHARE_ENV');

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

const _broadcastRegistry = new Map<string, Set<BroadcastChannel>>();

export class BroadcastChannel {
  readonly name: string;
  private _closed = false;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onmessageerror: ((event: { data: unknown }) => void) | null = null;

  constructor(name: string) {
    this.name = String(name);
    if (!_broadcastRegistry.has(this.name)) {
      _broadcastRegistry.set(this.name, new Set());
    }
    _broadcastRegistry.get(this.name)!.add(this);
  }

  postMessage(message: unknown): void {
    if (this._closed) {
      throw new Error('BroadcastChannel is closed');
    }

    const channels = _broadcastRegistry.get(this.name);
    if (!channels) return;

    for (const channel of channels) {
      if (channel !== this && !channel._closed) {
        // Clone per receiver per W3C spec — each recipient gets an independent copy
        const cloned = cloneValue(message);
        setTimeout(() => {
          if (!channel._closed && channel.onmessage) {
            channel.onmessage({ data: cloned });
          }
        }, 0);
      }
    }
  }

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

const _environmentData = new Map<string, unknown>();

export function setEnvironmentData(key: string, value: unknown): void {
  if (value === undefined) {
    _environmentData.delete(key);
  } else {
    _environmentData.set(key, value);
  }
}

export function getEnvironmentData(key: string): unknown {
  return _environmentData.get(key);
}

export function receiveMessageOnPort(port: MessagePort): { message: unknown } | undefined {
  if (!port._hasQueuedMessages) return undefined;
  return { message: port._dequeueMessage() };
}

// No-ops in GJS — all messages are cloned, not transferred
export function markAsUntransferable(_object: unknown): void {}
export function markAsUncloneable(_object: unknown): void {}
export function moveMessagePortToContext(port: MessagePort, _context: unknown): MessagePort {
  return port;
}

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
