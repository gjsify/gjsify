// IFrameBridge — GTK container for HTMLIFrameElement backed by WebKit.WebView.
// Provides a WebKit.WebView subclass that bundles all iframe bootstrapping.

import GObject from 'gi://GObject';
import WebKit from 'gi://WebKit?version=6.0';

import { HTMLIFrameElement } from './html-iframe-element.js';
import { IFrameWindowProxy } from './iframe-window-proxy.js';
import { MessageBridge } from './message-bridge.js';
import * as PS from './property-symbol.js';

import type { IFrameBridgeOptions, IFrameReadyCallback } from './types/index.js';

/**
 * A `WebKit.WebView` subclass that handles iframe bootstrapping:
 * - Sets up WebKit settings (JavaScript, developer extras)
 * - Creates an `HTMLIFrameElement` wrapping this WebView
 * - Sets up postMessage bridge for GJS ↔ WebView communication
 * - Fires `onReady()` callbacks with the iframe element once loaded
 * - `installGlobals()` sets `globalThis.HTMLIFrameElement`
 *
 * Usage:
 * ```ts
 * const iframeWidget = new IFrameBridge();
 * iframeWidget.installGlobals();
 * iframeWidget.onReady((iframe) => {
 *     iframe.contentWindow?.addEventListener('message', (e) => {
 *         console.log('Message from iframe:', e.data);
 *     });
 * });
 * iframeWidget.iframeElement.src = 'https://example.com';
 * window.set_child(iframeWidget);
 * ```
 */
export const IFrameBridge = GObject.registerClass(
	{ GTypeName: 'GjsifyIFrameBridge' },
	class IFrameBridge extends WebKit.WebView {
		_iframe: HTMLIFrameElement;
		_messageBridge: MessageBridge;
		_readyCallbacks: IFrameReadyCallback[] = [];
		_options: IFrameBridgeOptions;

		constructor(options?: IFrameBridgeOptions & Partial<WebKit.WebView.ConstructorProps>) {
			const { enableDeveloperExtras, enableJavascript, ...webViewProps } = options ?? {};

			const userContentManager = new WebKit.UserContentManager();
			const settings = new WebKit.Settings();
			settings.enable_javascript = enableJavascript ?? true;
			settings.enable_developer_extras = enableDeveloperExtras ?? true;

			super({
				...webViewProps,
				user_content_manager: userContentManager,
				settings,
			});

			this._options = { enableDeveloperExtras, enableJavascript };

			// Create the DOM element and link it to this widget
			this._iframe = new HTMLIFrameElement();
			this._iframe[PS.iframeWidget] = this as unknown as import('./iframe-bridge.js').IFrameBridge;

			// Set up the message bridge
			this._messageBridge = new MessageBridge(this);

			// Create the window proxy and connect it
			const windowProxy = new IFrameWindowProxy(this._messageBridge);
			this._iframe[PS.windowProxy] = windowProxy;
			this._messageBridge.setWindowProxy(windowProxy);

			// Track load state
			this.connect('load-changed', (_webView: WebKit.WebView, event: WebKit.LoadEvent) => {
				switch (event) {
					case WebKit.LoadEvent.COMMITTED: {
						const uri = this.get_uri();
						if (uri) this._messageBridge.updateUri(uri);
						break;
					}
					case WebKit.LoadEvent.FINISHED:
						this._iframe._onLoad();
						for (const cb of this._readyCallbacks) {
							cb(this._iframe as unknown as globalThis.HTMLIFrameElement);
						}
						this._readyCallbacks = [];
						break;
				}
			});

			this.connect('load-failed', () => {
				this._iframe._onError();
				return false;
			});

			this.connect('unrealize', () => {
				this._messageBridge.destroy();
				const proxy = this._iframe[PS.windowProxy];
				if (proxy) {
					proxy._close();
				}
				this._iframe[PS.iframeWidget] = null;
				this._iframe[PS.windowProxy] = null;
			});
		}

		/** The HTMLIFrameElement wrapping this WebView. */
		get iframeElement(): HTMLIFrameElement {
			return this._iframe;
		}

		/**
		 * Register a callback to be invoked when content has loaded.
		 * If content is already loaded, the callback fires on next load.
		 */
		onReady(cb: IFrameReadyCallback): void {
			this._readyCallbacks.push(cb);
		}

		/**
		 * Load a URI into the WebView.
		 * Also updates the iframe element's src attribute.
		 */
		loadUri(uri: string): void {
			this._iframe.setAttribute('src', uri);
			this.load_uri(uri);
		}

		/**
		 * Load inline HTML into the WebView.
		 * Also updates the iframe element's srcdoc attribute.
		 */
		loadHtml(html: string, baseUri?: string): void {
			this._iframe.setAttribute('srcdoc', html);
			this.load_html(html, baseUri ?? 'about:srcdoc');
		}

		/**
		 * Send a message to the WebView content via the standard postMessage API.
		 * Equivalent to `this.iframeElement.contentWindow.postMessage(message, targetOrigin)`.
		 */
		postMessage(message: unknown, targetOrigin = '*'): void {
			this._messageBridge.sendToWebView(message, targetOrigin);
		}

		/**
		 * Set `globalThis.HTMLIFrameElement` to the gjsify implementation.
		 */
		installGlobals(): void {
			Object.defineProperty(globalThis, 'HTMLIFrameElement', {
				value: HTMLIFrameElement,
				writable: true,
				configurable: true,
			});
		}
	},
);

export type IFrameBridge = InstanceType<typeof IFrameBridge>;
