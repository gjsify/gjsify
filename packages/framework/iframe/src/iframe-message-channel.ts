// IFrameMessageChannel / IFrameMessagePort — minimal MessageChannel
// substitute for the GJS ↔ WebKit.WebView bridge.
//
// W3C `MessagePort` requires the browser host to thread the port
// identity through structured clone + transferList semantics. We can't
// reuse `@gjsify/worker_threads` MessagePort because that's
// EventEmitter-based (Node convention) and is wired for subprocess IPC,
// not WebKit IPC. We can't reuse a globalThis.MessageChannel because GJS
// doesn't ship one.
//
// So we provide a tiny EventTarget-based MessagePort + MessageChannel
// pair scoped to iframe-bridge use. The pair has two endpoints:
//
//   const ch = new IFrameMessageChannel();
//   iframe.contentWindow.postMessage(msg, '*', [ch.port2]);
//   ch.port1.addEventListener('message', (e) => { … });
//   ch.port1.postMessage('reply');
//
// `ch.port2` is what the user passes in transferList. After transfer it
// becomes unusable on the GJS side — its partner (`ch.port1`) stays
// usable and is the application's hand-off to bridge-routed messages.
// On the WebView side, `event.ports[0]` of the incoming MessageEvent is
// a proxy port whose .postMessage routes back over the bridge.
//
// Limitations:
// - Single-hop transfers only. Re-transferring a transferred port is
//   rejected (W3C does allow this but it's rare).
// - In-process channel use (port1 ↔ port2 without ever transferring)
//   works the same way as a regular MessageChannel.
// - close() on the GJS side ends bridge routing for that port-id;
//   the WebView-side proxy stops delivering after the GJS port closes.

import { EventTarget, MessageEvent } from '@gjsify/dom-events';

import type { MessageBridge } from './message-bridge.js';

export class IFrameMessagePort extends EventTarget {
	/** @internal In-process partner; null when this port has been transferred. */
	_partner: IFrameMessagePort | null = null;
	/** @internal Set once this port has been passed in a transferList — can no longer post locally. */
	_transferred = false;
	/** @internal Set when the partner of this port has been transferred — this port now routes via the bridge. */
	_bridge: MessageBridge | null = null;
	/** @internal Bridge-side identifier when this port is wired to a remote endpoint. */
	_portId: number | null = null;
	/** @internal W3C: dispatching is gated until .start() (or first addEventListener('message')). */
	_started = false;
	/** @internal Messages received before .start() */
	_queue: unknown[] = [];
	/** @internal Closed by close() */
	_closed = false;

	postMessage(data: unknown): void {
		if (this._transferred) {
			throw new Error('IFrameMessagePort.postMessage: port has been transferred');
		}
		if (this._closed) return;
		if (this._bridge && this._portId !== null) {
			// Partner has been transferred to the WebView; route through the bridge.
			this._bridge._sendPortMessage(this._portId, data);
			return;
		}
		// In-process: deliver to the partner directly.
		if (this._partner && !this._partner._closed) this._partner._receive(data);
	}

	/**
	 * W3C: enables dispatching of queued messages. Explicit `start()`
	 * is optional — adding a 'message' listener via addEventListener
	 * auto-starts. This method exists for explicit control + .onmessage
	 * setter compatibility (not implemented yet).
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
		if (this._bridge && this._portId !== null) {
			this._bridge._closePort(this._portId);
			this._bridge = null;
			this._portId = null;
		}
		this._partner = null;
		this._queue = [];
	}

	/** @internal Called by the bridge or the in-process partner. */
	_receive(data: unknown): void {
		if (this._closed) return;
		if (!this._started) {
			this._queue.push(data);
			return;
		}
		this._dispatch(data);
	}

	private _dispatch(data: unknown): void {
		// Async dispatch to match W3C MessagePort + MessageEvent semantics.
		Promise.resolve().then(() => {
			if (this._closed) return;
			this.dispatchEvent(new MessageEvent('message', { data }));
		});
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	addEventListener(type: string, listener: any, options?: any): void {
		// EventTarget here is @gjsify/dom-events's, not lib.dom; the signature
		// uses its own Event type which doesn't match standard DOM strictly.
		// Cast through any to avoid the type clash without losing W3C semantics.
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(super.addEventListener as any)(type, listener, options);
		// Per W3C, the implicit-start happens when ANY message listener is added,
		// not when the port is first read. Honor that.
		if (type === 'message') this.start();
	}

	get [Symbol.toStringTag](): string {
		return 'MessagePort';
	}
}

export class IFrameMessageChannel {
	readonly port1: IFrameMessagePort;
	readonly port2: IFrameMessagePort;

	constructor() {
		this.port1 = new IFrameMessagePort();
		this.port2 = new IFrameMessagePort();
		this.port1._partner = this.port2;
		this.port2._partner = this.port1;
	}

	get [Symbol.toStringTag](): string {
		return 'MessageChannel';
	}
}
