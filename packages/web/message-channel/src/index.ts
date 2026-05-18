// W3C MessageChannel + MessagePort for GJS.
// Reference: https://html.spec.whatwg.org/multipage/web-messaging.html
// Reference: refs/deno/ext/web/13_message_port.js (Deno's W3C-compliant impl)
// Reference: refs/happy-dom/packages/happy-dom/src/event-target/EventTarget.ts
//
// EventTarget-based + transport-pluggable so the same class backs:
//   - in-process channels (port1 ↔ port2 directly; the default)
//   - bridge-routed transfer (e.g. @gjsify/iframe over WebKit IPC, or future
//     @gjsify/worker_threads over subprocess IPC)
//
// Browser feature parity:
//   - postMessage(data, transferList?)   — transferList walked elsewhere
//   - start()                            — explicit + implicit on addEventListener('message')
//   - close()
//   - addEventListener('message'|'messageerror') + onmessage / onmessageerror
//   - dispatches MessageEvent (W3C) with .data + .origin
//
// Limitations vs full HTML spec:
//   - No 'messageerror' event firing (we don't throw on cycles; structured-clone
//     handling is the responsibility of consumers).
//   - No SharedWorker / ServiceWorker integration (no transport for those).
//   - Transfer of MessagePort BETWEEN message-channel and other transports
//     (iframe ↔ worker) requires the consuming transport to recognise the
//     port class; the base class doesn't broker cross-transport hops.

import { EventTarget, MessageEvent } from '@gjsify/dom-events';

/**
 * Pluggable transport interface that lets a MessagePort route its
 * outbound messages through something other than its in-process partner.
 *
 * @gjsify/iframe attaches a transport that JSON-serialises + sends over
 * a WebKit script-message-handler. Future transports might attach a
 * stdin-pipe writer (worker_threads) or a BroadcastChannel relay.
 *
 * @internal
 */
export interface MessagePortTransport {
	/** Send a payload along this port's wire. */
	send(portId: number, data: unknown): void;
	/** Close this port's wire endpoint. */
	close(portId: number): void;
}

let _portIdCounter = 1;

export class MessagePort extends EventTarget {
	/** @internal In-process partner; null after transfer attaches a transport. */
	_partner: MessagePort | null = null;
	/** @internal Per-port unique id. Used by transports for routing. */
	_portId: number = _portIdCounter++;
	/** @internal True once the port has been listed in a transferList. Future
	 *  postMessage calls on this instance throw — see HTML spec. */
	_transferred = false;
	/** @internal Outbound-message router. When set, postMessage routes via
	 *  `transport.send(portId, data)` instead of the in-process partner. */
	_transport: MessagePortTransport | null = null;
	/** @internal HTML implicit-start gate: messages received before start()
	 *  (or before the first addEventListener('message')) buffer here. */
	_started = false;
	_queue: unknown[] = [];
	_closed = false;
	/** @internal onmessage / onmessageerror IDL attribute backing field. */
	_onmessage: ((evt: MessageEvent) => unknown) | null = null;
	_onmessageerror: ((evt: MessageEvent) => unknown) | null = null;

	postMessage(data: unknown, _transfer?: unknown[]): void {
		if (this._transferred) {
			throw DOMException_('Cannot post on a transferred MessagePort', 'InvalidStateError');
		}
		if (this._closed) return;
		// Transport-routed: hand the message to the wire.
		if (this._transport !== null) {
			this._transport.send(this._portId, data);
			return;
		}
		// In-process: deliver directly to the partner.
		if (this._partner && !this._partner._closed) {
			this._partner._receive(data);
		}
	}

	/**
	 * Per W3C: enables dispatching of queued messages. Explicit `start()`
	 * is rarely needed — adding a `'message'` listener via
	 * addEventListener (or assigning to `.onmessage`) auto-starts the
	 * port. This method exists for code that defers listener attachment.
	 */
	start(): void {
		if (this._started || this._closed) return;
		this._started = true;
		const queued = this._queue;
		this._queue = [];
		for (const msg of queued) this._dispatch(msg);
	}

	close(): void {
		if (this._closed) return;
		this._closed = true;
		if (this._transport !== null) {
			this._transport.close(this._portId);
			this._transport = null;
		}
		this._partner = null;
		this._queue.length = 0;
	}

	/** @internal Wire-side delivery point: called by the in-process partner
	 *  OR by the transport's recv-loop when a message arrives off the wire. */
	_receive(data: unknown): void {
		if (this._closed) return;
		if (!this._started) {
			this._queue.push(data);
			return;
		}
		this._dispatch(data);
	}

	private _dispatch(data: unknown): void {
		// Async dispatch matches W3C MessagePort + browser MessageEvent
		// scheduling — listeners run in a microtask, never re-entrantly.
		Promise.resolve().then(() => {
			if (this._closed) return;
			this.dispatchEvent(new MessageEvent('message', { data }));
		});
	}

	get onmessage(): ((evt: MessageEvent) => unknown) | null {
		return this._onmessage;
	}

	set onmessage(fn: ((evt: MessageEvent) => unknown) | null) {
		if (this._onmessage) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(this.removeEventListener as any)('message', this._onmessage);
		}
		this._onmessage = fn;
		if (fn) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(this.addEventListener as any)('message', fn);
		}
	}

	get onmessageerror(): ((evt: MessageEvent) => unknown) | null {
		return this._onmessageerror;
	}

	set onmessageerror(fn: ((evt: MessageEvent) => unknown) | null) {
		if (this._onmessageerror) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(this.removeEventListener as any)('messageerror', this._onmessageerror);
		}
		this._onmessageerror = fn;
		if (fn) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(this.addEventListener as any)('messageerror', fn);
		}
	}

	// EventTarget.addEventListener override — implements W3C implicit-start.
	// EventTarget here is @gjsify/dom-events's, whose Event types don't match
	// lib.dom strictly; we cast through any to bridge the surface.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	addEventListener(type: string, listener: any, options?: any): void {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(super.addEventListener as any)(type, listener, options);
		if (type === 'message') this.start();
	}

	get [Symbol.toStringTag](): string {
		return 'MessagePort';
	}
}

export class MessageChannel {
	readonly port1: MessagePort;
	readonly port2: MessagePort;

	constructor() {
		this.port1 = new MessagePort();
		this.port2 = new MessagePort();
		this.port1._partner = this.port2;
		this.port2._partner = this.port1;
	}

	get [Symbol.toStringTag](): string {
		return 'MessageChannel';
	}
}

// Local DOMException fallback. Using `globalThis.DOMException` would
// drag a hard dep on @gjsify/dom-exception's register; this is a
// soft fallback that gives the right .name + .code without that.
function DOMException_(message: string, name: string): Error {
	const Ctor = (globalThis as { DOMException?: new (m: string, n: string) => Error }).DOMException;
	if (typeof Ctor === 'function') return new Ctor(message, name);
	const err = new Error(message);
	err.name = name;
	return err;
}
