// MessageBridge for GJS — postMessage bridge between GJS and WebKit.WebView
// Adapted from refs/map-editor/packages/message-channel-gjs/src/rpc-endpoint.ts
// Copyright (c) PixelRPG contributors. MIT license.
// Modifications: Simplified to standard postMessage semantics (no JSON-RPC layer)

import Gio from 'gi://Gio?version=2.0';
import WebKit from 'gi://WebKit?version=6.0';
import JavaScriptCore from 'gi://JavaScriptCore?version=6.0';
import { MessageEvent } from '@gjsify/dom-events';

// Promisify evaluate_javascript so it returns a Promise in GJS
Gio._promisify(WebKit.WebView.prototype, 'evaluate_javascript', 'evaluate_javascript_finish');

import type { IFrameWindowProxy } from './iframe-window-proxy.js';
import type { IFrameMessageData } from './types/index.js';

const CHANNEL_NAME = 'gjsify-iframe';

/**
 * Bootstrap script injected into every WebView page at document start.
 * Provides the `window.parent.postMessage()` bridge from WebView content back to GJS.
 *
 * The script:
 * 1. Gets the WebKit message handler registered under CHANNEL_NAME
 * 2. Creates a parent proxy with a postMessage() that sends via the WebKit handler
 * 3. Overrides window.parent to point to the proxy
 */
const BOOTSTRAP_SCRIPT = `(function() {
    var handler = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers['${CHANNEL_NAME}'];
    if (!handler) return;
    function bridgePostMessage(data, targetOrigin) {
        handler.postMessage(JSON.stringify({
            data: data,
            targetOrigin: targetOrigin || '*',
            origin: location.origin
        }));
    }
    // In a WebKit.WebView loaded via srcdoc, window.parent === window (no real iframe nesting).
    // window.parent is [LegacyUnforgeable] — cannot be redefined with defineProperty.
    // Instead, override window.postMessage directly. Since window.parent === window,
    // calls to window.parent.postMessage() will use our override.
    var origPostMessage = window.postMessage;
    window.postMessage = function(data, targetOrigin) {
        bridgePostMessage(data, targetOrigin);
    };
    // Also expose on a safe namespace for explicit use
    window.__gjsifyBridge = { postMessage: bridgePostMessage, origPostMessage: origPostMessage };
})();`;

/**
 * Manages bidirectional postMessage communication between GJS and a WebKit.WebView.
 *
 * Direction 1 — GJS → WebView:
 *   Uses webView.evaluate_javascript() to dispatch a MessageEvent on the WebView's window.
 *
 * Direction 2 — WebView → GJS:
 *   Bootstrap script overrides window.parent.postMessage to call
 *   webkit.messageHandlers[CHANNEL_NAME].postMessage(), which triggers
 *   the UserContentManager 'script-message-received' signal in GJS.
 */
export class MessageBridge {
	private _webView: WebKit.WebView;
	private _userContentManager: WebKit.UserContentManager;
	private _windowProxy: IFrameWindowProxy | null = null;
	private _currentUri = 'about:blank';
	private _signalId: number | null = null;

	constructor(webView: WebKit.WebView) {
		this._webView = webView;
		this._userContentManager = webView.get_user_content_manager();
		this._setupReceiver();
		this._injectBootstrapScript();
	}

	/** Connect the IFrameWindowProxy that will receive messages from the WebView */
	setWindowProxy(proxy: IFrameWindowProxy): void {
		this._windowProxy = proxy;
	}

	/** Update current URI (called by IFrameBridge on load-changed) */
	updateUri(uri: string): void {
		this._currentUri = uri;
	}

	/** Get current location info for the IFrameWindowProxy */
	getLocation(): { href: string; origin: string } {
		let origin: string;
		try {
			const url = new URL(this._currentUri);
			origin = url.origin;
		} catch {
			origin = 'null';
		}
		return { href: this._currentUri, origin };
	}

	/**
	 * Send a message from GJS to the WebView content.
	 * Dispatches a standard MessageEvent on the WebView's window object.
	 */
	sendToWebView(data: unknown, _targetOrigin: string): void {
		const serialized = JSON.stringify(data);
		const origin = JSON.stringify('gjsify');
		// Note: do not pass `source` — WebKit's MessageEvent constructor throws TypeError
		// if source is not a valid MessageEventSource (Window/MessagePort/ServiceWorker)
		const script = `window.dispatchEvent(new MessageEvent('message', { data: JSON.parse(${JSON.stringify(serialized)}), origin: ${origin} }));`;

		// evaluate_javascript is async in WebKit 6.0 — fire and forget
		this._webView.evaluate_javascript(
			script,
			-1,    // length (-1 = null-terminated)
			null,  // world name (null = default)
			null,  // source URI
			null,  // cancellable
		).catch(() => {
			// Ignore errors for fire-and-forget message dispatch
		});
	}

	/** Clean up signal handlers */
	destroy(): void {
		if (this._signalId !== null) {
			this._userContentManager.disconnect(this._signalId);
			this._signalId = null;
		}
		this._userContentManager.unregister_script_message_handler(CHANNEL_NAME, null);
		this._windowProxy = null;
	}

	/**
	 * Set up the receiver for messages coming from the WebView.
	 * Registers a script message handler and connects to the signal.
	 */
	private _setupReceiver(): void {
		this._userContentManager.register_script_message_handler(CHANNEL_NAME, null);

		this._signalId = this._userContentManager.connect(
			`script-message-received::${CHANNEL_NAME}`,
			(_ucm: WebKit.UserContentManager, jsValue: JavaScriptCore.Value) => {
				if (!this._windowProxy) return;

				try {
					// The bootstrap script sends JSON.stringify({data, targetOrigin, origin})
					// so jsValue is a JSC string. Use to_string() to get the raw JSON.
					const json = jsValue.to_string();
					const envelope: IFrameMessageData = JSON.parse(json);

					// Dispatch MessageEvent on the IFrameWindowProxy
					const event = new MessageEvent('message', {
						data: envelope.data,
						origin: envelope.origin,
					});
					this._windowProxy.dispatchEvent(event);
				} catch (error) {
					console.error('[IFrame MessageBridge] Error processing message:', error);
				}
			},
		);
	}

	/**
	 * Inject the bootstrap script into the WebView so that
	 * window.parent.postMessage() bridges back to GJS.
	 */
	private _injectBootstrapScript(): void {
		const script = new WebKit.UserScript(
			BOOTSTRAP_SCRIPT,
			WebKit.UserContentInjectedFrames.ALL_FRAMES,
			WebKit.UserScriptInjectionTime.START,
			null,  // allow list (null = all)
			null,  // block list (null = none)
		);
		this._userContentManager.add_script(script);
	}
}
