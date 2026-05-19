// SubprocessPortTransport — MessagePortTransport adapter that routes a
// cross-process MessagePort's outbound traffic over the existing
// worker-IPC JSON-line protocol (parent ↔ child, via stdin/stdout pipes
// established by `Worker` in worker.ts).
//
// Pattern mirrors `BridgePortTransport` from `@gjsify/iframe`
// (`packages/framework/iframe/src/iframe-message-channel.ts`) — both
// adapt a wire-routed channel into the same `MessagePortTransport`
// interface that `@gjsify/message-channel`'s `MessagePort` already
// honours. When `_inner._transport` is non-null, the inner port's
// `postMessage(data)` calls `transport.send(portId, data)` instead of
// dispatching to its in-process partner.
//
// Wire format: each cross-process port message is a top-level JSON line
//   { "__msgport": <portId>, "op": "send", "data": <payload> }
// or for closes:
//   { "__msgport": <portId>, "op": "close" }
// This sits next to the existing top-level `{ type: 'message'|...}` lines
// the worker protocol already uses. The `__msgport` key is distinct from
// `type`, so the dispatch is unambiguous.

import type { MessagePortTransport } from '@gjsify/message-channel';

/** Function that writes one already-encoded line to the wire (e.g. parent's
 *  `child.stdin.write(line)` or child bootstrap's `process.stdout.write(line)`). */
export type WireWriter = (line: string) => void;

/**
 * Per-Worker registry of locally-resident cross-process MessagePort
 * instances, keyed by portId. The wire-side dispatcher (stdout reader on
 * parent, stdin reader on child) looks up the local port by portId and
 * routes incoming `{ __msgport, op: 'send', data }` to
 * `port._inner._receive(data)`. `op: 'close'` calls `port._inner.close()`.
 *
 * Parent-side: keyed by the same portId attached to the SubprocessPortTransport
 * that the OTHER side's port writes from. Child-side bootstrap maintains its
 * own registry with the same shape.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface CrossProcessPortRegistry extends Map<number, any> {}

export class SubprocessPortTransport implements MessagePortTransport {
  /**
   * @param sendLine writes a JSON-line to the wire (parent: child.stdin;
   *                 child: process.stdout).
   * @param registry the local registry the port is registered in; on
   *                 `close()` we drop the entry to keep the registry from
   *                 growing unbounded across spawn/transfer/terminate
   *                 cycles.
   */
  constructor(
    private readonly _sendLine: WireWriter,
    private readonly _registry: CrossProcessPortRegistry,
  ) {}

  send(portId: number, data: unknown): void {
    const line = JSON.stringify({ __msgport: portId, op: 'send', data }) + '\n';
    this._sendLine(line);
  }

  close(portId: number): void {
    const line = JSON.stringify({ __msgport: portId, op: 'close' }) + '\n';
    try {
      this._sendLine(line);
    } catch {
      // Wire may already be closed (worker terminated); the close-line is a
      // best-effort notification. Registry cleanup below still runs.
    }
    this._registry.delete(portId);
  }
}

/** Monotonic id generator for cross-process port ids. Parent allocates odd
 *  ids (1, 3, 5, …); child allocates even ids (2, 4, 6, …). Keeps the two
 *  namespaces disjoint without coordination so a port allocated by parent
 *  and a port allocated by child cannot collide on the same Worker. */
let _nextParentPortId = 1;
let _nextChildPortId = 2;

export function nextParentPortId(): number {
  const id = _nextParentPortId;
  _nextParentPortId += 2;
  return id;
}

export function nextChildPortId(): number {
  const id = _nextChildPortId;
  _nextChildPortId += 2;
  return id;
}

/** Cross-process MessagePort placeholder. Distinct from the in-process
 *  `{ index }` form so the receiver-side materialiser can dispatch on shape. */
export interface CrossProcessPortPlaceholder {
  readonly __gjsifyTransferredPort: true;
  /** Stable id used by both sides' registries to route subsequent
   *  `{ __msgport, op }` lines back to the right local port. */
  readonly portId: number;
}

export function isCrossProcessPortPlaceholder(value: unknown): value is CrossProcessPortPlaceholder {
  return (
    typeof value === 'object'
    && value !== null
    && (value as { __gjsifyTransferredPort?: unknown }).__gjsifyTransferredPort === true
    && typeof (value as { portId?: unknown }).portId === 'number'
  );
}
