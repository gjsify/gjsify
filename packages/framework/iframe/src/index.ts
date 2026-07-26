// HTMLIFrameElement for GJS — backed by WebKit.WebView
// Reference: refs/happy-dom/packages/happy-dom/src/nodes/html-iframe-element/HTMLIFrameElement.ts
// Reference: refs/map-editor/packages/message-channel-gjs/ (GJS ↔ WebView communication)
//
// Barrel — named exports only, ZERO top-level side effects. The `globalThis`
// write and the `document.createElement('iframe')` factory hookup live in
// `./register.ts` (`@gjsify/iframe/register`), injected automatically by
// `--globals auto`.

export { HTMLIFrameElement } from './html-iframe-element.js';
export { IFrameBridge } from './iframe-bridge.js';
export { IFrameWindowProxy } from './iframe-window-proxy.js';
export { MessageBridge, GJS_HOST_ORIGIN } from './message-bridge.js';
// Browser-standard MessageChannel + MessagePort (re-exported from
// @gjsify/message-channel for convenience; same instances are exposed
// under the legacy IFrame-prefixed aliases for back-compat).
export { MessageChannel, MessagePort, IFrameMessageChannel, IFrameMessagePort } from './iframe-message-channel.js';
export type { IFrameBridgeOptions, IFrameReadyCallback, IFrameMessageData } from './types/index.js';
