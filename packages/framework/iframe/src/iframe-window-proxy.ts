// The Window proxy behind `HTMLIFrameElement.contentWindow`.
// Reference: https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage
// Reference: refs/happy-dom/packages/happy-dom/src/window/CrossOriginBrowserWindow.ts

import { EventTarget } from '@gjsify/dom-events';

import type { MessageBridge } from './message-bridge.js';
import type { MessagePort } from '@gjsify/message-channel/core';

/**
 * Deliberately NOT a full BrowserWindow: only the subset of the Window API that
 * postMessage-based iframe communication needs.
 */
export class IFrameWindowProxy extends EventTarget {
    private _bridge: MessageBridge;
    private _closed = false;

    constructor(bridge: MessageBridge) {
        super();
        this._bridge = bridge;
    }

    /**
     * Send a message to the iframe content. `message` must be JSON-serialisable, plus the
     * binary types `@gjsify/iframe/serialize` can base64-encode.
     *
     * Each port in `transfer` is detached locally and its surviving partner becomes the
     * GJS-side endpoint of a bidirectional channel routed through the bridge; the WebView
     * receives proxy ports wherever the originals appeared in `message`.
     */
    postMessage(message: unknown, targetOrigin = '*', transfer?: MessagePort[]): void {
        if (this._closed) return;
        this._bridge.sendToWebView(message, targetOrigin, transfer);
    }

    /** Read-only location reflecting the current WebView URI. */
    get location(): { href: string; origin: string } {
        return this._bridge.getLocation();
    }

    /** The host window — `globalThis` on GJS. */
    get parent(): typeof globalThis {
        return globalThis;
    }

    /** The top-level window — `globalThis` on GJS. */
    get top(): typeof globalThis {
        return globalThis;
    }

    /** Self-reference, per spec. */
    get self(): IFrameWindowProxy {
        return this;
    }

    get window(): IFrameWindowProxy {
        return this;
    }

    get closed(): boolean {
        return this._closed;
    }

    /** @internal Called when the WebView is destroyed. */
    _close(): void {
        this._closed = true;
    }

    get [Symbol.toStringTag](): string {
        return 'IFrameWindowProxy';
    }
}
