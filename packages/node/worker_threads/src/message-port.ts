// Reference: Node.js lib/internal/worker/io.js
// Reference: HTML Living Standard §9.4.4 message ports + transferable objects
// Reference: refs/node-test/parallel/test-worker-message-port-transfer*.js
// Reimplemented for GJS — composes @gjsify/message-channel for the W3C
// surface, keeps EventEmitter contract for @types/node compat.
//
// Architecture (Message-Channel Unification Step 3, composition path):
// - This class still `extends EventEmitter` because `@types/node`'s
//   `MessagePort` declares that base, so `port.on('message', cb)` /
//   `port.once(...)` / `port.emit(...)` continue to use EventEmitter
//   semantics.
// - For the W3C surface (`addEventListener('message')`, `onmessage` IDL
//   setter, `start()`/`close()` queue draining, microtask-async dispatch via
//   `dispatchEvent(new MessageEvent('message', { data }))`) we compose a
//   private `_inner` instance of the shared `@gjsify/message-channel`
//   MessagePort. The inner owns the canonical "started + queue + closed"
//   state, and EventEmitter dispatches mirror its lifecycle.
// - In-process dispatch path:
//     sender.postMessage(value, transferList)
//       → cloned = structuredClone(value, { transfer })
//       → target._receiveMessage(cloned)
//       → target._inner._receive(cloned)             // queues OR W3C-dispatches
//       → if target._inner._started: target._dispatchEmit(cloned)  // EventEmitter side
// - `addEventListener('message')` on this wrapper does **not** auto-start the
//   port (matches Node's documented behaviour and W3C HTML §9.4.4); we
//   sidestep the inner shared MP's developer-friendly auto-start by
//   bypassing its `addEventListener` override (calling
//   `EventTarget.prototype.addEventListener` directly via the inner's
//   prototype chain). `port.on('message')` and `port.onmessage = fn` both
//   auto-start, matching Node + W3C.
//
// Transferable support:
// - ArrayBuffer transfer uses the structured-clone layer's transfer hook
//   (SM140 ArrayBuffer.prototype.transfer() — zero-copy, sender detaches).
// - MessagePort transfer is handled at this layer: a MessagePort listed in
//   transferList is detached from its current channel (close locally) and
//   re-attached on the receiver side. Wire format: a placeholder
//   `{ __gjsifyTransferredPort: true, index: N }` is substituted into the
//   cloned message tree, then swapped back to fresh local MessagePorts on
//   the receiver. Because the underlying linked-port pair is in-process JS
//   (no IPC), we move the surviving end of the channel directly — there is
//   no separate serialization step.
//
// Cross-process MessagePort transfer (via Worker subprocess IPC):
// `Worker.postMessage(value, [port])` extracts each transferred port
// from the transferList, severs the in-process partnership on the
// parent's kept end, attaches a `SubprocessPortTransport` to the kept
// end's `_inner._transport` (which routes outbound traffic to the child
// via stdin JSON lines), and emits a
// `{__gjsifyTransferredPort: true, portId}` placeholder on the wire.
// The child bootstrap materialises that placeholder to an inline port
// object whose `postMessage` writes back over stdout. Both sides use
// the same `portId` as a registry key for inbound routing. See
// `subprocess-port-transport.ts` for the adapter + nextParentPortId
// counter. transferList-within-transferList chains (port-in-port) are
// not supported on the cross-process path.

import { EventEmitter } from 'node:events';
import { MessagePort as SharedMessagePort } from '@gjsify/message-channel';
import { isSharedBuffer } from './sab-transfer.js';

/**
 * Internal placeholder used while serializing a transferred MessagePort.
 * Replaced with a fresh local MessagePort by the receiver after
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
  private _closed = false;
  private _detached = false;
  /** @internal Linked port for in-process communication */
  _otherPort: MessagePort | null = null;
  /** @internal W3C-surface delegate from `@gjsify/message-channel`. Owns the
   *  canonical started/queue/closed state — the wrapper mirrors lifecycle
   *  events to the EventEmitter side. */
  _inner: SharedMessagePort = new SharedMessagePort();

  start(): void {
    if (this._closed || this._inner._started) return;
    // Snapshot queue BEFORE inner.start() drains it. The shared MP drains to
    // its W3C listeners via microtask; we mirror to EventEmitter listeners
    // via the same microtask scheduling so timing matches pre-refactor
    // behaviour for `port.on('message')` consumers.
    const queued = this._inner._queue.slice();
    this._inner.start();
    for (const msg of queued) this._dispatchEmit(msg);
  }

  close(): void {
    if (this._closed) return;
    this._closed = true;
    const other = this._otherPort;
    this._otherPort = null;
    if (other) other._otherPort = null;
    this._inner.close();
    this.emit('close');
    this.removeAllListeners();
  }

  postMessage(value: unknown, transferList?: unknown[]): void {
    if (this._closed) return;
    const target = this._otherPort;

    // Cross-process branch: in-process partner gone, but a
    // SubprocessPortTransport is attached to `_inner._transport`. The
    // surviving end routes outbound messages over the worker IPC wire
    // (parent ↔ child stdin/stdout) instead of an in-process partner.
    // transferList is intentionally restricted on the cross-process path
    // in v1 — port-in-port-in-port chains and ArrayBuffer-over-wire are
    // separate workstreams (see STATUS.md Open TODOs).
    if (!target && this._inner._transport !== null) {
      if (transferList && transferList.length > 0) {
        throw createDataCloneError('transferList is not supported on cross-process MessagePort yet');
      }
      this._inner.postMessage(value);
      return;
    }

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

        // @gjsify/sab-native SharedBuffer — same "shared, not transferred"
        // semantics as SAB. In-process MessagePort.postMessage doesn't need
        // fd-passing (both ports share a JS heap), so we treat the entry as
        // a no-op pass-through: the SharedBuffer reaches the receiver intact
        // via structuredClone's SharedBuffer branch. The cross-process worker
        // path in worker.ts is what actually consumes the entry and routes
        // the fd over SCM_RIGHTS.
        if (isSharedBuffer(item)) {
          continue;
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
        sourcePort._otherPort = null;
        sourcePort._detached = true;
        // Mark closed locally — the original port is no longer usable.
        sourcePort._closed = true;

        const newPort = new MessagePort();
        newPort._otherPort = partner;
        if (partner) partner._otherPort = newPort;
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
    // Inner handles W3C-side: queues until started, then microtask-dispatches
    // a MessageEvent to addEventListener('message') / onmessage handlers.
    this._inner._receive(message);
    // EventEmitter side: only fire when started (matches old behaviour where
    // unstarted ports buffer; `receiveMessageOnPort` can pull from the buffer
    // without dispatching).
    if (this._inner._started) this._dispatchEmit(message);
  }

  get _hasQueuedMessages(): boolean {
    return this._inner._queue.length > 0;
  }

  _dequeueMessage(): unknown | undefined {
    return this._inner._queue.shift();
  }

  /** @internal Has this port been transferred elsewhere? */
  get _wasTransferred(): boolean {
    return this._detached;
  }

  private _dispatchEmit(message: unknown): void {
    Promise.resolve().then(() => {
      if (!this._closed) {
        this.emit('message', message);
      }
    });
  }

  /**
   * Web-compatible addEventListener. For `'message'` (and `'messageerror'`),
   * routes through the inner shared MessagePort which dispatches a
   * MessageEvent. For Node-only signals like `'close'`, routes to the
   * EventEmitter side so `port.emit('close')` reaches the listener.
   *
   * Does NOT auto-start the port — matches Node + W3C HTML §9.4.4. Use
   * `port.start()` explicitly, or attach via `port.on('message')` /
   * `port.onmessage = fn` (both auto-start).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addEventListener(type: string, listener: any, options?: any): void {
    if (!listener) return;
    if (type === 'message' || type === 'messageerror') {
      // Bypass shared-MP's addEventListener (which auto-starts the port — a
      // developer-friendly deviation that Node + worker_threads tests don't
      // want). Walk up the prototype chain to EventTarget's addEventListener
      // and call it on the inner directly.
      const eventTargetProto = Object.getPrototypeOf(Object.getPrototypeOf(this._inner)) as {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        addEventListener(type: string, listener: any, options?: any): void;
      };
      eventTargetProto.addEventListener.call(this._inner, type, listener, options);
      return;
    }
    // Non-MessagePort-spec events (`'close'`, custom): use EventEmitter.
    super.on(type, listener);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  removeEventListener(type: string, listener: any, options?: any): void {
    if (!listener) return;
    if (type === 'message' || type === 'messageerror') {
      const eventTargetProto = Object.getPrototypeOf(Object.getPrototypeOf(this._inner)) as {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        removeEventListener(type: string, listener: any, options?: any): void;
      };
      eventTargetProto.removeEventListener.call(this._inner, type, listener, options);
      return;
    }
    super.off(type, listener);
  }

  /** W3C `onmessage` IDL attribute — delegated to the inner. Assigning a
   *  non-null handler auto-starts both surfaces (matches W3C HTML spec). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get onmessage(): any {
    return this._inner.onmessage;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  set onmessage(fn: any) {
    // Shared MP's onmessage setter internally calls addEventListener which
    // auto-starts the inner port + drains its queue to W3C listeners.
    // Mirror that to the EventEmitter side by snapshotting the queue first
    // and replaying it after the inner has started.
    if (fn !== null && !this._inner._started) {
      const queued = this._inner._queue.slice();
      this._inner.onmessage = fn;
      for (const msg of queued) this._dispatchEmit(msg);
    } else {
      this._inner.onmessage = fn;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get onmessageerror(): any {
    return this._inner.onmessageerror;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  set onmessageerror(fn: any) {
    this._inner.onmessageerror = fn;
  }

  on(event: string | symbol, listener: (...args: unknown[]) => void): this {
    super.on(event, listener);
    if (event === 'message') this.start();
    return this;
  }

  addListener(event: string | symbol, listener: (...args: unknown[]) => void): this {
    return this.on(event, listener);
  }

  once(event: string | symbol, listener: (...args: unknown[]) => void): this {
    super.once(event, listener);
    if (event === 'message') this.start();
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
