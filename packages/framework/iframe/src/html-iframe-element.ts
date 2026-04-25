// HTMLIFrameElement for GJS — original implementation using WebKit.WebView
// Reference: refs/happy-dom/packages/happy-dom/src/nodes/html-iframe-element/HTMLIFrameElement.ts
// Reference: https://developer.mozilla.org/en-US/docs/Web/API/HTMLIFrameElement

import { HTMLElement, PropertySymbol } from '@gjsify/dom-elements';
import { Event } from '@gjsify/dom-events';
import * as PS from './property-symbol.js';

import type { IFrameWindowProxy } from './iframe-window-proxy.js';

const { tagName, localName, namespaceURI } = PropertySymbol;

/**
 * HTML IFrame Element.
 *
 * Backed by WebKit.WebView when connected to an IFrameBridge.
 * Without a backing widget, behaves as a pure DOM element with attribute storage.
 *
 * Reference: https://developer.mozilla.org/en-US/docs/Web/API/HTMLIFrameElement
 */
export class HTMLIFrameElement extends HTMLElement {
	/** @internal The backing IFrameBridge (set by IFrameBridge when it creates this element) */
	[PS.iframeWidget]: import('./iframe-bridge.js').IFrameBridge | null = null;

	/** @internal The contentWindow proxy */
	[PS.windowProxy]: IFrameWindowProxy | null = null;

	/** @internal Whether content has been loaded */
	[PS.loaded]: boolean = false;

	constructor() {
		super();
		this[tagName] = 'IFRAME';
		this[localName] = 'iframe';
		this[namespaceURI] = 'http://www.w3.org/1999/xhtml';
	}

	// -- Attribute-backed string properties --

	get src(): string {
		return this.getAttribute('src') ?? '';
	}

	set src(value: string) {
		const old = this.getAttribute('src');
		this.setAttribute('src', value);
		if (value !== old && value && this[PS.iframeWidget]) {
			this[PS.iframeWidget].loadUri(value);
		}
	}

	get srcdoc(): string {
		return this.getAttribute('srcdoc') ?? '';
	}

	set srcdoc(value: string) {
		const old = this.getAttribute('srcdoc');
		this.setAttribute('srcdoc', value);
		if (value !== old && value && this[PS.iframeWidget]) {
			this[PS.iframeWidget].loadHtml(value);
		}
	}

	get name(): string {
		return this.getAttribute('name') ?? '';
	}

	set name(value: string) {
		this.setAttribute('name', value);
	}

	get sandbox(): string {
		return this.getAttribute('sandbox') ?? '';
	}

	set sandbox(value: string) {
		this.setAttribute('sandbox', value);
	}

	get allow(): string {
		return this.getAttribute('allow') ?? '';
	}

	set allow(value: string) {
		this.setAttribute('allow', value);
	}

	get referrerPolicy(): string {
		return this.getAttribute('referrerpolicy') ?? '';
	}

	set referrerPolicy(value: string) {
		this.setAttribute('referrerpolicy', value);
	}

	get loading(): string {
		const value = this.getAttribute('loading');
		if (value === 'lazy' || value === 'eager') return value;
		return 'eager';
	}

	set loading(value: string) {
		this.setAttribute('loading', value);
	}

	// -- Attribute-backed string properties (width/height are strings per spec) --

	get width(): string {
		return this.getAttribute('width') ?? '';
	}

	set width(value: string) {
		this.setAttribute('width', value);
	}

	get height(): string {
		return this.getAttribute('height') ?? '';
	}

	set height(value: string) {
		this.setAttribute('height', value);
	}

	// -- Content access --

	/**
	 * Returns the window proxy for the iframe's content.
	 * Available after the IFrameBridge has loaded content.
	 */
	get contentWindow(): IFrameWindowProxy | null {
		return this[PS.windowProxy];
	}

	/**
	 * Always returns null — cross-context boundary.
	 * The WebView content runs in a separate process; direct document access
	 * is not feasible. Use postMessage() for communication.
	 */
	get contentDocument(): null {
		return null;
	}

	// -- Methods --

	/**
	 * Returns a promise that resolves to the iframe's src URL.
	 */
	getSVGDocument(): null {
		return null;
	}

	cloneNode(deep = false): HTMLIFrameElement {
		const clone = super.cloneNode(deep) as HTMLIFrameElement;
		// Cloned iframes are not connected to any widget
		clone[PS.iframeWidget] = null;
		clone[PS.windowProxy] = null;
		clone[PS.loaded] = false;
		return clone;
	}

	get [Symbol.toStringTag](): string {
		return 'HTMLIFrameElement';
	}

	// -- Internal: called by IFrameBridge --

	/** @internal Fire load event */
	_onLoad(): void {
		this[PS.loaded] = true;
		this.dispatchEvent(new Event('load'));
	}

	/** @internal Fire error event */
	_onError(): void {
		this.dispatchEvent(new Event('error'));
	}
}
