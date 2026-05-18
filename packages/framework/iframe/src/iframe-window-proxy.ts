// IFrameWindowProxy for GJS — lightweight Window proxy for iframe contentWindow
// Reference: https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage
// Reference: refs/happy-dom/packages/happy-dom/src/window/CrossOriginBrowserWindow.ts

import { EventTarget } from '@gjsify/dom-events';

import type { MessageBridge } from './message-bridge.js';
import type { MessagePort } from '@gjsify/message-channel';

/**
 * Lightweight Window-like proxy returned by `HTMLIFrameElement.contentWindow`.
 *
 * Supports the subset of the Window API needed for cross-origin iframe communication:
 * - `postMessage()` for sending messages to the iframe content
 * - `addEventListener('message', ...)` for receiving messages from the iframe content
 * - `location` (read-only) reflecting the current URI
 * - `parent` reference to the host window
 * - `closed` status
 *
 * This is intentionally NOT a full BrowserWindow — just enough for standard
 * postMessage-based communication patterns.
 */
export class IFrameWindowProxy extends EventTarget {
	private _bridge: MessageBridge;
	private _closed = false;

	constructor(bridge: MessageBridge) {
		super();
		this._bridge = bridge;
	}

	/**
	 * Send a message to the iframe content.
	 *
	 * @param message - Data to send (must be JSON-serializable + base64-encodable
	 *   binaries — see @gjsify/iframe/serialize for supported binary types).
	 * @param targetOrigin - Target origin for the message. Default: '*'.
	 * @param transfer - Optional list of `MessagePort` instances to
	 *   transfer. Each transferred port is detached locally; its surviving
	 *   partner becomes the GJS-side endpoint of a bidirectional channel
	 *   routed through the bridge. The WebView receives proxy ports under
	 *   `MessageEvent.data` wherever the original ports appeared in `message`.
	 */
	postMessage(message: unknown, targetOrigin = '*', transfer?: MessagePort[]): void {
		if (this._closed) return;
		this._bridge.sendToWebView(message, targetOrigin, transfer);
	}

	/**
	 * Read-only location reflecting the current WebView URI.
	 */
	get location(): { href: string; origin: string } {
		return this._bridge.getLocation();
	}

	/**
	 * Reference to the host (parent) window — in GJS this is globalThis.
	 */
	get parent(): typeof globalThis {
		return globalThis;
	}

	/**
	 * Reference to the top-level window — in GJS this is globalThis.
	 */
	get top(): typeof globalThis {
		return globalThis;
	}

	/**
	 * The window itself (self-reference per spec).
	 */
	get self(): IFrameWindowProxy {
		return this;
	}

	get window(): IFrameWindowProxy {
		return this;
	}

	get closed(): boolean {
		return this._closed;
	}

	/** @internal Mark as closed when the WebView is destroyed */
	_close(): void {
		this._closed = true;
	}

	get [Symbol.toStringTag](): string {
		return 'IFrameWindowProxy';
	}
}
