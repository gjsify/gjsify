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
import {
  encodeBinariesForJson,
  decodeBinariesFromJson,
  BINARY_SERIALIZER_INJECTED_SRC,
} from './serialize.js';

const CHANNEL_NAME = 'gjsify-iframe';

/**
 * Synthetic origin attached to messages travelling FROM the GJS host
 * INTO the WebView. The WebView can use this in a targetOrigin filter to
 * accept messages only when they originate from its hosting GJS process
 * (vs. any other code that might inject script via developer tools).
 *
 * Uses the `https://` scheme so WHATWG URL parsing gives a real origin
 * string (non-special schemes like `gjsify://` return `null` as origin
 * per the URL spec, which would break the equality comparison the
 * bridge does on every message). `.local` is the standard RFC 6762
 * suffix for non-routable mDNS names, so it can't collide with a real
 * site.
 */
export const GJS_HOST_ORIGIN = 'https://gjsify.local';

/**
 * Per HTML spec for window.postMessage:
 *   - '*'         → no origin restriction
 *   - URL string  → only deliver if destination origin matches URL.origin
 *   - '/'         → only deliver if destination origin matches source origin
 *   - other       → throw SyntaxError
 *
 * Returns the canonical origin string (e.g. 'https://example.com'),
 * `'*'`, or `null` if the input is `'/'`. Throws `SyntaxError` for
 * malformed input.
 */
export function normaliseTargetOrigin(targetOrigin: string): string | null {
	if (targetOrigin === '*') return '*';
	if (targetOrigin === '/') return null;
	try {
		return new URL(targetOrigin).origin;
	} catch {
		const err = new Error(`Invalid target origin '${targetOrigin}'`);
		err.name = 'SyntaxError';
		throw err;
	}
}

/**
 * Bootstrap script injected into every WebView page at document start.
 * Provides the `window.parent.postMessage()` bridge from WebView content back to GJS.
 *
 * The script:
 * 1. Gets the WebKit message handler registered under CHANNEL_NAME
 * 2. Creates a parent proxy with a postMessage() that sends via the WebKit handler
 * 3. Overrides window.parent to point to the proxy
 */
/**
 * @internal Exposed only for unit testing — verifies the bootstrap
 * idempotency guard survives refactors. Not part of the public API.
 */
export const BOOTSTRAP_SCRIPT_FOR_TEST = (): string => BOOTSTRAP_SCRIPT;

const BOOTSTRAP_SCRIPT = `(function() {
    var handler = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers['${CHANNEL_NAME}'];
    if (!handler) return;

    // Idempotency guard: WebKit auto-injects this script at INJECTION_TIME.START
    // for every page load. On rapid reload, srcdoc remount, or
    // history.replaceState shenanigans, the script may run twice in the
    // same window without an intervening real navigation. If we
    // overwrite our previous override blindly we'd capture OUR override
    // as origPostMessage, losing the real one — and any consumer using
    // __gjsifyBridge.origPostMessage would loop forever.
    if (window.__gjsifyBridge && window.__gjsifyBridge.__bridgeVersion === 1) return;

    var GJS_HOST_ORIGIN = '${GJS_HOST_ORIGIN}';

    ${BINARY_SERIALIZER_INJECTED_SRC}

    function normaliseOrigin(t) {
        if (t === '*') return '*';
        if (t === '/') return location.origin;       // source own-origin shortcut
        try { return new URL(t).origin; }
        catch (_) {
            var err = new SyntaxError("Invalid target origin '" + t + "'");
            throw err;
        }
    }

    function bridgePostMessage(data, targetOrigin) {
        var t = targetOrigin || '*';
        var resolved = normaliseOrigin(t);
        // Drop silently if the targetOrigin doesn't match GJS host origin.
        // '*' matches anything; otherwise must equal GJS_HOST_ORIGIN.
        if (resolved !== '*' && resolved !== GJS_HOST_ORIGIN) return;
        handler.postMessage(JSON.stringify({
            data: __encodeBin(data),
            targetOrigin: resolved,
            origin: location.origin
        }));
    }

    // GJS → WebView messages come in via window.dispatchEvent(new MessageEvent(...))
    // injected by evaluate_javascript. We can't intercept that path, so the
    // injection itself decodes placeholders before constructing MessageEvent —
    // see MessageBridge.sendToWebView in message-bridge.ts.

    // In a WebKit.WebView loaded via srcdoc, window.parent === window (no real iframe nesting).
    // window.parent is [LegacyUnforgeable] — cannot be redefined with defineProperty.
    // Instead, override window.postMessage directly. Since window.parent === window,
    // calls to window.parent.postMessage() will use our override.
    var origPostMessage = window.postMessage;
    window.postMessage = function(data, targetOrigin) {
        bridgePostMessage(data, targetOrigin);
    };
    // Also expose on a safe namespace for explicit use. Version-tag
    // the bridge so the idempotency guard above can detect a re-run.
    window.__gjsifyBridge = {
        __bridgeVersion: 1,
        postMessage: bridgePostMessage,
        origPostMessage: origPostMessage,
    };
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
	sendToWebView(data: unknown, targetOrigin: string): void {
		// Validate + match against the WebView's current origin per HTML spec.
		// '*' always delivers; a parseable URL must match the WebView's
		// location.origin; '/' means "must match source's own origin" — for
		// GJS-side senders that's GJS_HOST_ORIGIN, which can never match a
		// real WebView origin, so '/' always drops.
		const targetCanonical = normaliseTargetOrigin(targetOrigin);
		if (targetCanonical !== '*') {
			const webViewOrigin = this.getLocation().origin;
			// `null` from '/' OR a real origin string. '/' resolves to source's
			// own origin = GJS_HOST_ORIGIN here, which never matches a real
			// WebView origin.
			const compareTo = targetCanonical ?? GJS_HOST_ORIGIN;
			if (compareTo !== webViewOrigin) return;
		}

		// Encode binaries to base64 placeholders before JSON-stringifying the
		// payload. The injected snippet decodes them on the WebView side before
		// dispatching MessageEvent, so user code sees a real typed array.
		const encoded = encodeBinariesForJson(data);
		const serialized = JSON.stringify(encoded);
		const origin = JSON.stringify(GJS_HOST_ORIGIN);
		// Note: do not pass `source` — WebKit's MessageEvent constructor throws TypeError
		// if source is not a valid MessageEventSource (Window/MessagePort/ServiceWorker)
		const script = `(function(){${BINARY_SERIALIZER_INJECTED_SRC}window.dispatchEvent(new MessageEvent('message', { data: __decodeBin(JSON.parse(${JSON.stringify(serialized)})), origin: ${origin} }));})();`;

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

					// Bootstrap already enforces targetOrigin against GJS_HOST_ORIGIN.
					// Re-validate here as defense-in-depth: a tampered WebView could
					// emit a JSON envelope directly via the message handler bypassing
					// the bootstrap's normaliseOrigin call. '*' always allowed,
					// otherwise must equal GJS_HOST_ORIGIN.
					const target = envelope.targetOrigin;
					if (target !== '*' && target !== GJS_HOST_ORIGIN) return;

					// Decode any binary placeholders in `data` back into typed arrays.
					const decodedData = decodeBinariesFromJson(envelope.data);

					// Dispatch MessageEvent on the IFrameWindowProxy
					const event = new MessageEvent('message', {
						data: decodedData,
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
