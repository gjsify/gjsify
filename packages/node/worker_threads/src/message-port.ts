// Reference: Node.js lib/internal/worker/io.js
// Reference: HTML Living Standard §9.4.4 message ports + transferable objects
// Reference: refs/node-test/parallel/test-worker-message-port-transfer*.js
// Reimplemented for GJS using EventEmitter
//
// Transferable support:
// - ArrayBuffer transfer uses the structured-clone layer's transfer hook
//   (SM140 ArrayBuffer.prototype.transfer() — zero-copy, sender detaches).
// - MessagePort transfer is handled at this layer: a MessagePort listed in
//   transferList is detached from its current channel (close locally) and
//   re-attached on the receiver side. Wire format: a placeholder
//   `{ __gjsifyTransferredPort: true, queue: [...], hasOtherEnd: bool }`
//   is substituted into the cloned message tree, then materialised back into
//   a MessagePort on the receiver. Because the underlying linked-port pair
//   is in-process JS (no IPC), we move the surviving end of the channel
//   directly — there is no separate serialization step.
//
// Cross-process MessagePort transfer (i.e. via Worker subprocess IPC) is not
// supported — see STATUS.md "Open TODOs".

import { EventEmitter } from 'node:events';

/**
 * Internal placeholder used while serializing a transferred MessagePort.
 * Replaced with a fresh local MessagePort by `_finalizeTransfer` after
 * structuredClone returns.
 */
interface TransferredPortPlaceholder {
  readonly __gjsifyTransferredPort: true;
  /** Index into the materialisation array — unique per transfer. */
  readonly index: number;
}

function isTransferredPortPlaceholder(value: unknown): value is TransferredPortPlaceholder {
  return (
    typeof value === 'object'
    && value !== null
    && (value as { __gjsifyTransferredPort?: unknown }).__gjsifyTransferredPort === true
  );
}

export class MessagePort extends EventEmitter {
  private _started = false;
  private _closed = false;
  private _detached = false;
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

  postMessage(value: unknown, transferList?: unknown[]): void {
    if (this._closed) return;
    const target = this._otherPort;
    if (!target) return;

    // --- Transfer-list pre-flight ---
    // Validate transferable entries up front. Per HTML spec, validation must
    // happen before any side effects (no partial transfer on error).
    const arrayBufferTransfers: ArrayBuffer[] = [];
    const portTransfers: MessagePort[] = [];

    if (transferList && transferList.length > 0) {
      const seenInList = new Set<unknown>();
      for (const item of transferList) {
        if (seenInList.has(item)) {
          throw createDataCloneError('Transfer list contains duplicate entries');
        }
        seenInList.add(item);

        if (item instanceof MessagePort) {
          if (item === this) {
            throw createDataCloneError('Cannot transfer source port');
          }
          if (item._closed || item._detached) {
            throw createDataCloneError('MessagePort in transfer list is already detached');
          }
          portTransfers.push(item);
          continue;
        }

        // ArrayBuffer
        const tag = Object.prototype.toString.call(item).slice(8, -1);
        if (tag === 'ArrayBuffer') {
          const buf = item as ArrayBuffer & { detached?: boolean };
          if (buf.detached === true) {
            throw createDataCloneError('ArrayBuffer in transfer list is detached');
          }
          arrayBufferTransfers.push(buf);
          continue;
        }

        // SharedArrayBuffer must NOT appear in transfer list — it shares.
        if (tag === 'SharedArrayBuffer') {
          throw createDataCloneError('SharedArrayBuffer cannot appear in transfer list (it is shared, not transferred)');
        }

        throw createDataCloneError(`Value at index ${transferList.indexOf(item)} of transfer list is not transferable`);
      }
    }

    // --- Substitute MessagePort placeholders before clone ---
    // The structured-clone layer doesn't know about MessagePort; we walk the
    // value tree and replace each transferred port instance with a placeholder
    // (so the cloned tree reuses the same placeholder objects), then swap the
    // placeholders back to fresh local MessagePorts on the receiver side.
    const portMaterialisationOrder = portTransfers.slice();
    let substituted: unknown = value;
    if (portTransfers.length > 0) {
      substituted = substitutePortsWithPlaceholders(value, portTransfers);
    }

    // --- Clone (with ArrayBuffer transfer) ---
    let cloned: unknown;
    try {
      cloned = structuredClone(substituted, {
        transfer: arrayBufferTransfers.length > 0 ? arrayBufferTransfers : undefined,
      });
    } catch (err) {
      this.emit('messageerror', err instanceof Error ? err : new Error('Could not clone message'));
      return;
    }

    // --- Materialise transferred MessagePorts on the receiver ---
    // For each transferred port: detach the source MessagePort locally, then
    // create a new MessagePort on the receiver side that takes over the
    // surviving end of the channel.
    let receiverMessage = cloned;
    if (portMaterialisationOrder.length > 0) {
      const newPorts = portMaterialisationOrder.map((sourcePort) => {
        // The source port is being moved. Steal its channel partner.
        const partner = sourcePort._otherPort;
        const queued = sourcePort._messageQueue.slice();
        sourcePort._messageQueue.length = 0;
        sourcePort._otherPort = null;
        sourcePort._detached = true;
        // Mark closed locally — the original port is no longer usable.
        sourcePort._closed = true;

        const newPort = new MessagePort();
        newPort._otherPort = partner;
        if (partner) partner._otherPort = newPort;
        // Carry over any pending messages that the sourcePort had not drained yet.
        for (const msg of queued) newPort._messageQueue.push(msg);
        return newPort;
      });
      receiverMessage = replacePlaceholdersWithPorts(cloned, newPorts);
    }

    target._receiveMessage(receiverMessage);
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

  /** @internal Has this port been transferred elsewhere? */
  get _wasTransferred(): boolean {
    return this._detached;
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

// --- Helpers ---

function createDataCloneError(message: string): Error {
  const DOMExceptionCtor = (globalThis as Record<string, unknown>).DOMException as
    (new (message: string, name: string) => Error) | undefined;
  if (typeof DOMExceptionCtor === 'function') {
    const err = new DOMExceptionCtor(message, 'DataCloneError');
    // Ensure the `code` property matches Node/W3C (25 = DATA_CLONE_ERR).
    if ((err as { code?: number }).code === undefined) {
      try {
        Object.defineProperty(err, 'code', { value: 25, configurable: true });
      } catch { /* ignore */ }
    }
    return err;
  }
  const err = new Error(message);
  err.name = 'DataCloneError';
  (err as { code?: number }).code = 25;
  return err;
}

/**
 * Walk `value`, replacing any MessagePort listed in `ports` with a
 * placeholder. Returns the new tree (copy-on-substitute). Mutates nothing in
 * the input.
 *
 * Handles plain objects and arrays. Other tagged types (Map, Set, …) are
 * passed through unchanged — the structured clone step that follows will
 * handle them, and ports inside Maps/Sets are uncommon enough in practice
 * that we don't expand the walk for them. (Node accepts the same constraint.)
 */
function substitutePortsWithPlaceholders(value: unknown, ports: MessagePort[]): unknown {
  const portToIndex = new Map<MessagePort, number>();
  for (let i = 0; i < ports.length; i++) portToIndex.set(ports[i]!, i);

  function walk(v: unknown, seen: Map<object, unknown>): unknown {
    if (v === null || typeof v !== 'object') return v;

    // MessagePort substitution
    if (v instanceof MessagePort) {
      const idx = portToIndex.get(v);
      if (idx === undefined) return v; // not transferred
      const placeholder: TransferredPortPlaceholder = { __gjsifyTransferredPort: true, index: idx };
      return placeholder;
    }

    if (seen.has(v)) return seen.get(v);

    if (Array.isArray(v)) {
      const out: unknown[] = [];
      seen.set(v, out);
      for (let i = 0; i < v.length; i++) {
        if (i in v) out[i] = walk(v[i], seen);
      }
      return out;
    }

    const tag = Object.prototype.toString.call(v).slice(8, -1);
    if (tag === 'Object') {
      const out: Record<string, unknown> = {};
      seen.set(v, out);
      for (const k of Object.keys(v as Record<string, unknown>)) {
        out[k] = walk((v as Record<string, unknown>)[k], seen);
      }
      return out;
    }

    // Other tagged types: leave intact for structuredClone to handle.
    return v;
  }

  return walk(value, new Map());
}

/**
 * Walk `value` post-clone and replace each placeholder with the corresponding
 * receiver-side MessagePort.
 */
function replacePlaceholdersWithPorts(value: unknown, newPorts: MessagePort[]): unknown {
  function walk(v: unknown, seen: Map<object, unknown>): unknown {
    if (v === null || typeof v !== 'object') return v;
    if (isTransferredPortPlaceholder(v)) {
      return newPorts[v.index];
    }
    if (seen.has(v)) return seen.get(v);

    if (Array.isArray(v)) {
      seen.set(v, v);
      for (let i = 0; i < v.length; i++) {
        if (i in v) v[i] = walk(v[i], seen);
      }
      return v;
    }

    const tag = Object.prototype.toString.call(v).slice(8, -1);
    if (tag === 'Object') {
      seen.set(v, v);
      for (const k of Object.keys(v as Record<string, unknown>)) {
        (v as Record<string, unknown>)[k] = walk((v as Record<string, unknown>)[k], seen);
      }
      return v;
    }
    return v;
  }
  return walk(value, new Map());
}
