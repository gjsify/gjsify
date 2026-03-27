// HTMLIFrameElement for GJS — backed by WebKit.WebView
// Reference: refs/happy-dom/packages/happy-dom/src/nodes/html-iframe-element/HTMLIFrameElement.ts
// Reference: refs/map-editor/packages/message-channel-gjs/ (GJS ↔ WebView communication)

export { HTMLIFrameElement } from './html-iframe-element.js';
export { IFrameWidget } from './iframe-widget.js';
export { IFrameWindowProxy } from './iframe-window-proxy.js';
export { MessageBridge } from './message-bridge.js';
export type { IFrameWidgetOptions, IFrameReadyCallback, IFrameMessageData } from './types/index.js';

// Side-effect: register DOM globals on import.
// Same pattern as @gjsify/dom-elements and @gjsify/canvas2d.
import { Document } from '@gjsify/dom-elements';
import { HTMLIFrameElement } from './html-iframe-element.js';

// Register so that document.createElement('iframe') works
Document.registerElementFactory('iframe', () => new HTMLIFrameElement());

// Register global constructor
Object.defineProperty(globalThis, 'HTMLIFrameElement', {
	value: HTMLIFrameElement,
	writable: true,
	configurable: true,
});
