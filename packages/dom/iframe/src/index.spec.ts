// Tests for @gjsify/iframe — HTMLIFrameElement, IFrameWindowProxy, IFrameWidget
// Reference: refs/happy-dom/packages/happy-dom/test/nodes/html-iframe-element/

import { describe, it, expect } from '@gjsify/unit';

// Import index.ts to trigger side-effect registration (Document.registerElementFactory)
import { HTMLIFrameElement, IFrameWindowProxy } from './index.js';
import { Document } from '@gjsify/dom-elements';
import { HTMLElement, Element, Node } from '@gjsify/dom-elements';
import { MessageEvent } from '@gjsify/dom-events';

export default async () => {
	// -- HTMLIFrameElement DOM properties --

	await describe('HTMLIFrameElement', async () => {
		await it('should be an instance of HTMLElement, Element, and Node', async () => {
			const iframe = new HTMLIFrameElement();
			expect(iframe instanceof HTMLElement).toBe(true);
			expect(iframe instanceof Element).toBe(true);
			expect(iframe instanceof Node).toBe(true);
		});

		await it('should have correct tagName and localName', async () => {
			const iframe = new HTMLIFrameElement();
			expect(iframe.tagName).toBe('IFRAME');
			expect(iframe.localName).toBe('iframe');
		});

		await it('should have correct [Symbol.toStringTag]', async () => {
			const iframe = new HTMLIFrameElement();
			expect(Object.prototype.toString.call(iframe)).toBe('[object HTMLIFrameElement]');
		});

		// -- src --

		await it('should get/set src', async () => {
			const iframe = new HTMLIFrameElement();
			expect(iframe.src).toBe('');
			iframe.setAttribute('src', 'https://example.com');
			expect(iframe.src).toBe('https://example.com');
		});

		await it('should reflect src to attribute', async () => {
			const iframe = new HTMLIFrameElement();
			iframe.src = 'https://example.com';
			expect(iframe.getAttribute('src')).toBe('https://example.com');
		});

		// -- srcdoc --

		await it('should get/set srcdoc', async () => {
			const iframe = new HTMLIFrameElement();
			expect(iframe.srcdoc).toBe('');
			iframe.setAttribute('srcdoc', '<h1>Hello</h1>');
			expect(iframe.srcdoc).toBe('<h1>Hello</h1>');
		});

		await it('should reflect srcdoc to attribute', async () => {
			const iframe = new HTMLIFrameElement();
			iframe.srcdoc = '<p>test</p>';
			expect(iframe.getAttribute('srcdoc')).toBe('<p>test</p>');
		});

		// -- name --

		await it('should get/set name', async () => {
			const iframe = new HTMLIFrameElement();
			expect(iframe.name).toBe('');
			iframe.name = 'my-frame';
			expect(iframe.name).toBe('my-frame');
			expect(iframe.getAttribute('name')).toBe('my-frame');
		});

		// -- sandbox --

		await it('should get/set sandbox', async () => {
			const iframe = new HTMLIFrameElement();
			expect(iframe.sandbox).toBe('');
			iframe.sandbox = 'allow-scripts allow-same-origin';
			expect(iframe.sandbox).toBe('allow-scripts allow-same-origin');
			expect(iframe.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin');
		});

		// -- allow --

		await it('should get/set allow', async () => {
			const iframe = new HTMLIFrameElement();
			expect(iframe.allow).toBe('');
			iframe.allow = 'fullscreen; autoplay';
			expect(iframe.allow).toBe('fullscreen; autoplay');
			expect(iframe.getAttribute('allow')).toBe('fullscreen; autoplay');
		});

		// -- referrerPolicy --

		await it('should get/set referrerPolicy', async () => {
			const iframe = new HTMLIFrameElement();
			expect(iframe.referrerPolicy).toBe('');
			iframe.referrerPolicy = 'no-referrer';
			expect(iframe.referrerPolicy).toBe('no-referrer');
			expect(iframe.getAttribute('referrerpolicy')).toBe('no-referrer');
		});

		// -- loading --

		await it('should get/set loading with valid values', async () => {
			const iframe = new HTMLIFrameElement();
			expect(iframe.loading).toBe('eager');
			iframe.loading = 'lazy';
			expect(iframe.loading).toBe('lazy');
			iframe.loading = 'eager';
			expect(iframe.loading).toBe('eager');
		});

		await it('should default loading to "eager" for invalid values', async () => {
			const iframe = new HTMLIFrameElement();
			iframe.loading = 'invalid';
			expect(iframe.loading).toBe('eager');
		});

		// -- width / height --

		await it('should get/set width as string', async () => {
			const iframe = new HTMLIFrameElement();
			expect(iframe.width).toBe('');
			iframe.width = '300';
			expect(iframe.width).toBe('300');
			expect(iframe.getAttribute('width')).toBe('300');
		});

		await it('should get/set height as string', async () => {
			const iframe = new HTMLIFrameElement();
			expect(iframe.height).toBe('');
			iframe.height = '200';
			expect(iframe.height).toBe('200');
			expect(iframe.getAttribute('height')).toBe('200');
		});

		// -- contentWindow / contentDocument --

		await it('should return null for contentWindow without backing widget', async () => {
			const iframe = new HTMLIFrameElement();
			expect(iframe.contentWindow).toBeNull();
		});

		await it('should always return null for contentDocument', async () => {
			const iframe = new HTMLIFrameElement();
			expect(iframe.contentDocument).toBeNull();
		});

		// -- Events --

		await it('should dispatch load event via _onLoad()', async () => {
			const iframe = new HTMLIFrameElement();
			let loaded = false;
			iframe.addEventListener('load', () => { loaded = true; });
			iframe._onLoad();
			expect(loaded).toBe(true);
		});

		await it('should dispatch error event via _onError()', async () => {
			const iframe = new HTMLIFrameElement();
			let errored = false;
			iframe.addEventListener('error', () => { errored = true; });
			iframe._onError();
			expect(errored).toBe(true);
		});

		await it('should support onload property handler', async () => {
			const iframe = new HTMLIFrameElement();
			let called = false;
			iframe.onload = () => { called = true; };
			iframe._onLoad();
			expect(called).toBe(true);
		});

		await it('should support onerror property handler', async () => {
			const iframe = new HTMLIFrameElement();
			let called = false;
			iframe.onerror = () => { called = true; };
			iframe._onError();
			expect(called).toBe(true);
		});

		// -- Clone --

		await it('should clone without widget reference', async () => {
			const iframe = new HTMLIFrameElement();
			iframe.src = 'https://example.com';
			iframe.name = 'test-frame';
			const clone = iframe.cloneNode(false);
			expect(clone instanceof HTMLIFrameElement).toBe(true);
			expect(clone.getAttribute('src')).toBe('https://example.com');
			expect(clone.getAttribute('name')).toBe('test-frame');
			expect(clone.contentWindow).toBeNull();
		});

		// -- getSVGDocument --

		await it('should return null for getSVGDocument()', async () => {
			const iframe = new HTMLIFrameElement();
			expect(iframe.getSVGDocument()).toBeNull();
		});
	});

	// -- Document.createElement('iframe') --

	await describe('Document.registerElementFactory', async () => {
		await it('should create HTMLIFrameElement via document.createElement', async () => {
			// The factory is registered as a side-effect in index.ts
			// which is imported by the test runner
			const doc = new Document();
			const iframe = doc.createElement('iframe');
			expect(iframe instanceof HTMLIFrameElement).toBe(true);
			expect(iframe.tagName).toBe('IFRAME');
		});
	});

	// -- IFrameWindowProxy (unit tests without WebView) --

	await describe('IFrameWindowProxy', async () => {
		await it('should have correct [Symbol.toStringTag]', async () => {
			// Create a minimal mock bridge for unit testing
			const mockBridge = {
				sendToWebView(_data: unknown, _targetOrigin: string) {},
				getLocation() { return { href: 'about:blank', origin: 'null' }; },
			};
			const proxy = new IFrameWindowProxy(mockBridge as any);
			expect(Object.prototype.toString.call(proxy)).toBe('[object IFrameWindowProxy]');
		});

		await it('should return globalThis as parent', async () => {
			const mockBridge = {
				sendToWebView(_data: unknown, _targetOrigin: string) {},
				getLocation() { return { href: 'about:blank', origin: 'null' }; },
			};
			const proxy = new IFrameWindowProxy(mockBridge as any);
			expect(proxy.parent).toBe(globalThis);
		});

		await it('should return globalThis as top', async () => {
			const mockBridge = {
				sendToWebView(_data: unknown, _targetOrigin: string) {},
				getLocation() { return { href: 'about:blank', origin: 'null' }; },
			};
			const proxy = new IFrameWindowProxy(mockBridge as any);
			expect(proxy.top).toBe(globalThis);
		});

		await it('should return self references', async () => {
			const mockBridge = {
				sendToWebView(_data: unknown, _targetOrigin: string) {},
				getLocation() { return { href: 'about:blank', origin: 'null' }; },
			};
			const proxy = new IFrameWindowProxy(mockBridge as any);
			expect(proxy.self).toBe(proxy);
			expect(proxy.window).toBe(proxy);
		});

		await it('should report closed status', async () => {
			const mockBridge = {
				sendToWebView(_data: unknown, _targetOrigin: string) {},
				getLocation() { return { href: 'about:blank', origin: 'null' }; },
			};
			const proxy = new IFrameWindowProxy(mockBridge as any);
			expect(proxy.closed).toBe(false);
			proxy._close();
			expect(proxy.closed).toBe(true);
		});

		await it('should delegate postMessage to bridge', async () => {
			let sentData: unknown;
			let sentOrigin: string | undefined;
			const mockBridge = {
				sendToWebView(data: unknown, targetOrigin: string) {
					sentData = data;
					sentOrigin = targetOrigin;
				},
				getLocation() { return { href: 'about:blank', origin: 'null' }; },
			};
			const proxy = new IFrameWindowProxy(mockBridge as any);
			proxy.postMessage({ hello: 'world' }, 'https://example.com');
			expect((sentData as any).hello).toBe('world');
			expect(sentOrigin).toBe('https://example.com');
		});

		await it('should not send message when closed', async () => {
			let called = false;
			const mockBridge = {
				sendToWebView() { called = true; },
				getLocation() { return { href: 'about:blank', origin: 'null' }; },
			};
			const proxy = new IFrameWindowProxy(mockBridge as any);
			proxy._close();
			proxy.postMessage('test');
			expect(called).toBe(false);
		});

		await it('should return location from bridge', async () => {
			const mockBridge = {
				sendToWebView() {},
				getLocation() { return { href: 'https://example.com/page', origin: 'https://example.com' }; },
			};
			const proxy = new IFrameWindowProxy(mockBridge as any);
			expect(proxy.location.href).toBe('https://example.com/page');
			expect(proxy.location.origin).toBe('https://example.com');
		});

		await it('should support addEventListener for message events', async () => {
			const mockBridge = {
				sendToWebView() {},
				getLocation() { return { href: 'about:blank', origin: 'null' }; },
			};
			const proxy = new IFrameWindowProxy(mockBridge as any);
			let received: unknown;
			proxy.addEventListener('message', ((event: Event) => {
				received = (event as unknown as MessageEvent).data;
			}) as any);
			proxy.dispatchEvent(new MessageEvent('message', { data: 'hello' }));
			expect(received).toBe('hello');
		});
	});
};
