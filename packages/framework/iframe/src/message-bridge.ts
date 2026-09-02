// MessageBridge for GJS — postMessage bridge between GJS and WebKit.WebView
// Adapted from refs/map-editor/packages/message-channel-gjs/src/rpc-endpoint.ts
// Copyright (c) PixelRPG contributors. MIT license.
// Modifications: Simplified to standard postMessage semantics (no JSON-RPC layer)

import WebKit from 'gi://WebKit?version=6.0';
import type JavaScriptCore from 'gi://JavaScriptCore?version=6.0';
import { MessageEvent } from '@gjsify/dom-events';

// Installs the Promise-returning overloads of evaluate_javascript / get_snapshot.
import './promisify.js';

import type { IFrameWindowProxy } from './iframe-window-proxy.js';
import type { ConsoleCallback, ConsoleLogEntry, IFrameMessageData } from './types/index.js';
import type { MessagePort } from '@gjsify/message-channel/core';
import { BridgePortTransport } from './iframe-message-channel.js';
import { encodeBinariesForJson, decodeBinariesFromJson, BINARY_SERIALIZER_INJECTED_SRC } from './serialize.js';
import { buildConsoleCaptureScript, ConsoleBuffer, parseConsoleEnvelope } from './console-capture.js';

const CHANNEL_NAME = 'gjsify-iframe';

/** Options for {@link MessageBridge}. */
export interface MessageBridgeOptions {
    /** Forward the page's `console.*` to the host via a UserScript. Default: false. */
    captureConsole?: boolean;
}

/**
 * Synthetic origin on messages travelling FROM the GJS host INTO the WebView, so page
 * code can filter on it and accept only what its hosting process sent.
 *
 * `https://` because WHATWG URL parsing yields `null` as the origin of a non-special
 * scheme like `gjsify://`, which would break the equality comparison the bridge does on
 * every message. `.local` is RFC 6762's non-routable suffix, so it cannot collide with a
 * real site.
 */
export const GJS_HOST_ORIGIN = 'https://gjsify.local';

/**
 * `targetOrigin` per the HTML spec for window.postMessage: `'*'` is unrestricted, a URL
 * must match the destination origin, `'/'` means "the source's own origin" (returned as
 * `null`), and anything else is a `SyntaxError`.
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
 * @internal Exposed only so a unit test can check that the bootstrap script's
 * idempotency guard survives a refactor. Not public API.
 */
export const BOOTSTRAP_SCRIPT_FOR_TEST = (): string => BOOTSTRAP_SCRIPT;

// Injected into every page at document start: overrides `window.parent` with a proxy
// whose postMessage goes through the WebKit message handler registered under
// CHANNEL_NAME, which is the WebView → GJS direction.
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

    // Per-WebView registry of proxy ports created during GJS → WebView
    // postMessage. Keyed by the GJS-allocated portId. Each entry has a
    // .deliver(payload) hook the GJS host can invoke via evaluate_javascript
    // to dispatch a 'message' event on the proxy port.
    var __gjsifyPorts = {};

    function __makeProxyPort(portId) {
        var listeners = [];
        var started = false;
        var queued = [];
        function dispatch(d) {
            var ev = { data: d, type: 'message' };
            for (var i = 0; i < listeners.length; i++) {
                try { listeners[i].call(undefined, ev); } catch (_) {}
            }
        }
        function drain() {
            while (queued.length > 0) dispatch(queued.shift());
        }
        var port = {
            postMessage: function(d) {
                handler.postMessage(JSON.stringify({
                    __gjsifyPortMessage: portId,
                    payload: __encodeBin(d)
                }));
            },
            addEventListener: function(type, fn) {
                if (type !== 'message' || typeof fn !== 'function') return;
                listeners.push(fn);
                if (!started) { started = true; drain(); }
            },
            removeEventListener: function(type, fn) {
                if (type !== 'message') return;
                var i = listeners.indexOf(fn);
                if (i !== -1) listeners.splice(i, 1);
            },
            start: function() { if (!started) { started = true; drain(); } },
            close: function() {
                handler.postMessage(JSON.stringify({ __gjsifyPortClose: portId }));
                listeners = [];
                queued = [];
                delete __gjsifyPorts[portId];
            },
        };
        Object.defineProperty(port, 'onmessage', {
            get: function() { return port.__onmessage || null; },
            set: function(fn) {
                if (port.__onmessage) port.removeEventListener('message', port.__onmessage);
                port.__onmessage = fn;
                if (typeof fn === 'function') port.addEventListener('message', fn);
            },
        });
        __gjsifyPorts[portId] = {
            deliver: function(d) {
                if (started) dispatch(d); else queued.push(d);
            },
        };
        return port;
    }

    // Walk an incoming GJS → WebView payload for {__gjsifyPort: id}
    // placeholders and replace each with a proxy port instance.
    function __substitutePorts(v) {
        if (v === null || typeof v !== 'object') return v;
        if (typeof v.__gjsifyPort === 'number') return __makeProxyPort(v.__gjsifyPort);
        if (Array.isArray(v)) { for (var i=0;i<v.length;i++) v[i]=__substitutePorts(v[i]); return v; }
        if (__classOf(v) === 'Object') {
            for (var k in v) if (Object.prototype.hasOwnProperty.call(v,k)) v[k]=__substitutePorts(v[k]);
            return v;
        }
        return v;
    }
    window.__gjsifyPortRegistry = __gjsifyPorts;
    window.__gjsifySubstitutePorts = __substitutePorts;

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
 * Bidirectional postMessage between GJS and a WebKit.WebView.
 *
 * GJS → WebView goes through `evaluate_javascript()`, which dispatches a MessageEvent on
 * the WebView's window. WebView → GJS goes through the bootstrap script's
 * `window.parent.postMessage` override, which calls
 * `webkit.messageHandlers[CHANNEL_NAME].postMessage()` and raises the
 * UserContentManager 'script-message-received' signal.
 */
export class MessageBridge {
    private _webView: WebKit.WebView;
    private _userContentManager: WebKit.UserContentManager;
    private _windowProxy: IFrameWindowProxy | null = null;
    private _currentUri = 'about:blank';
    private _signalId: number | null = null;
    /** GJS-side endpoints of transferred ports, keyed by per-bridge id: a
     *  `{__gjsifyPortMessage: id, payload}` envelope routes to `_receive(decoded)`. */
    private _ports = new Map<number, MessagePort>();
    private _nextPortId = 1;
    private _transport: BridgePortTransport | null = null;
    private _getTransport(): BridgePortTransport {
        if (this._transport === null) this._transport = new BridgePortTransport(this);
        return this._transport;
    }
    private _captureConsole: boolean;
    private _consoleBuffer = new ConsoleBuffer();
    private _consoleCallbacks: ConsoleCallback[] = [];

    constructor(webView: WebKit.WebView, options?: MessageBridgeOptions) {
        this._webView = webView;
        this._captureConsole = options?.captureConsole ?? false;
        this._userContentManager = webView.get_user_content_manager();
        this._setupReceiver();
        this._injectBootstrapScript();
        if (this._captureConsole) this._injectConsoleCaptureScript();
    }

    /** Console entries from the page, oldest first; empty without `captureConsole`. */
    getConsoleLogs(): ConsoleLogEntry[] {
        return this._consoleBuffer.list();
    }

    /** Drop all buffered console entries. */
    clearConsoleLogs(): void {
        this._consoleBuffer.clear();
    }

    /** Subscribe to console entries as they arrive. */
    onConsole(cb: ConsoleCallback): void {
        this._consoleCallbacks.push(cb);
    }

    /** @internal Record a parsed console entry + fan out to subscribers. */
    private _recordConsole(entry: ConsoleLogEntry): void {
        this._consoleBuffer.push(entry);
        for (const cb of this._consoleCallbacks) cb(entry);
    }

    /** Connect the IFrameWindowProxy that receives messages from the WebView. */
    setWindowProxy(proxy: IFrameWindowProxy): void {
        this._windowProxy = proxy;
    }

    /** Called by IFrameBridge on load-changed. */
    updateUri(uri: string): void {
        this._currentUri = uri;
    }

    /** Location info for the IFrameWindowProxy. */
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

    /** Dispatches a standard MessageEvent on the WebView's window object. */
    /**
     * Register a port pair for cross-bridge transfer. Called by
     * IFrameWindowProxy.postMessage when it sees a `MessagePort` in the
     * transferList. Returns the port-id placeholder that should be
     * substituted into the outgoing payload.
     *
     * The transferred port is detached locally and its surviving partner gets a
     * `BridgePortTransport`, so the partner's postMessage routes over the WebKit bridge
     * instead of the now-null in-process partner.
     */
    _registerTransferredPort(port: MessagePort): number {
        if (port._transferred) {
            throw new Error('MessagePort: already transferred');
        }
        const partner = port._partner;
        if (!partner) {
            throw new Error('MessagePort: partner missing — port already transferred or closed');
        }
        const id = this._nextPortId++;
        port._transferred = true;
        port._partner = null;
        partner._partner = null;
        partner._transport = this._getTransport();
        partner._portId = id;
        this._ports.set(id, partner);
        return id;
    }

    /** @internal Called by MessagePort.postMessage when its partner
     *  was transferred to the WebView. Dispatches the data onto the
     *  WebView-side proxy port via evaluate_javascript. */
    _sendPortMessage(portId: number, data: unknown): void {
        const encoded = encodeBinariesForJson(data);
        const serialized = JSON.stringify(encoded);
        const script = `(function(){${BINARY_SERIALIZER_INJECTED_SRC}var p = window.__gjsifyPortRegistry && window.__gjsifyPortRegistry[${portId}]; if (p) p.deliver(__decodeBin(JSON.parse(${JSON.stringify(serialized)})));})();`;
        this._webView.evaluate_javascript(script, -1, null, null, null).catch(() => {});
    }

    /** @internal Called by MessagePort.close to tear down the
     *  bridge-side registration. The WebView side keeps its proxy port
     *  alive in user-script land but subsequent .deliver calls go nowhere. */
    _closePort(portId: number): void {
        this._ports.delete(portId);
        const script = `(function(){ if (window.__gjsifyPortRegistry) delete window.__gjsifyPortRegistry[${portId}]; })();`;
        this._webView.evaluate_javascript(script, -1, null, null, null).catch(() => {});
    }

    sendToWebView(data: unknown, targetOrigin: string, transfer?: MessagePort[]): void {
        // Matched against the WebView's current origin per the HTML spec. For a GJS-side
        // sender '/' resolves to GJS_HOST_ORIGIN, which never matches a real WebView
        // origin, so '/' always drops.
        const targetCanonical = normaliseTargetOrigin(targetOrigin);
        if (targetCanonical !== '*') {
            const webViewOrigin = this.getLocation().origin;
            const compareTo = targetCanonical ?? GJS_HOST_ORIGIN;
            if (compareTo !== webViewOrigin) return;
        }

        // MessagePorts become `{__gjsifyPort: id}` placeholders, which the bootstrap
        // walker turns back into proxy ports on the WebView side.
        let prepared = data;
        if (transfer && transfer.length > 0) {
            const portToId = new Map<MessagePort, number>();
            for (const p of transfer) {
                const id = this._registerTransferredPort(p);
                portToId.set(p, id);
            }
            prepared = substitutePorts(data, portToId);
        }

        // Binaries become base64 placeholders for the JSON hop; the injected snippet
        // decodes them before dispatching, so page code sees a real typed array.
        const encoded = encodeBinariesForJson(prepared);
        const serialized = JSON.stringify(encoded);
        const origin = JSON.stringify(GJS_HOST_ORIGIN);
        // No `source`: WebKit's MessageEvent constructor throws TypeError unless it is a
        // Window/MessagePort/ServiceWorker.
        const script = `(function(){${BINARY_SERIALIZER_INJECTED_SRC}var d = __decodeBin(JSON.parse(${JSON.stringify(serialized)})); if (window.__gjsifySubstitutePorts) d = window.__gjsifySubstitutePorts(d); window.dispatchEvent(new MessageEvent('message', { data: d, origin: ${origin} }));})();`;

        // evaluate_javascript is async in WebKit 6.0 — fire and forget
        this._webView
            .evaluate_javascript(
                script,
                -1, // length (-1 = null-terminated)
                null, // world name (null = default)
                null, // source URI
                null, // cancellable
            )
            .catch(() => {
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
                try {
                    // The bootstrap script sends JSON.stringify({data, targetOrigin, origin})
                    // — or a port-routed shape `{__gjsifyPortMessage: id, payload}` /
                    // `{__gjsifyPortClose: id}`, or a console shape
                    // `{__gjsifyConsole: level, args}` — so jsValue is a JSC string. Use
                    // to_string() to get the raw JSON.
                    const json = jsValue.to_string();
                    const envelope = JSON.parse(json) as
                        | IFrameMessageData
                        | { __gjsifyPortMessage: number; payload: unknown }
                        | { __gjsifyPortClose: number }
                        | { __gjsifyConsole: string; args: unknown };

                    // Console message → buffer + fan out (no windowProxy needed).
                    const consoleEntry = parseConsoleEnvelope(envelope);
                    if (consoleEntry) {
                        this._recordConsole(consoleEntry);
                        return;
                    }

                    // Port message → route to the corresponding GJS-side endpoint.
                    if (typeof (envelope as { __gjsifyPortMessage?: number }).__gjsifyPortMessage === 'number') {
                        const e = envelope as { __gjsifyPortMessage: number; payload: unknown };
                        const port = this._ports.get(e.__gjsifyPortMessage);
                        if (port) port._receive(decodeBinariesFromJson(e.payload));
                        return;
                    }
                    if (typeof (envelope as { __gjsifyPortClose?: number }).__gjsifyPortClose === 'number') {
                        const e = envelope as { __gjsifyPortClose: number };
                        const port = this._ports.get(e.__gjsifyPortClose);
                        if (port) port.close();
                        this._ports.delete(e.__gjsifyPortClose);
                        return;
                    }

                    // Remaining shapes target the window proxy.
                    if (!this._windowProxy) return;
                    const windowMsg = envelope as IFrameMessageData;
                    // Bootstrap already enforces targetOrigin against GJS_HOST_ORIGIN.
                    // Re-validate here as defense-in-depth: a tampered WebView could
                    // emit a JSON envelope directly via the message handler bypassing
                    // the bootstrap's normaliseOrigin call. '*' always allowed,
                    // otherwise must equal GJS_HOST_ORIGIN.
                    const target = windowMsg.targetOrigin;
                    if (target !== '*' && target !== GJS_HOST_ORIGIN) return;

                    // Decode any binary placeholders in `data` back into typed arrays.
                    const decodedData = decodeBinariesFromJson(windowMsg.data);

                    // Dispatch MessageEvent on the IFrameWindowProxy
                    const event = new MessageEvent('message', {
                        data: decodedData,
                        origin: windowMsg.origin,
                    });
                    this._windowProxy.dispatchEvent(event);
                } catch (error) {
                    console.error('[IFrame MessageBridge] Error processing message:', error);
                }
            },
        );
    }

    /**
     * Walk the user payload and replace each MessagePort instance
     * (transferred via the transferList) with a {__gjsifyPort: id}
     * placeholder. Non-transferred ports are passed through untouched —
     * matches W3C semantics where only ports in transferList are detached.
     */

    /**
     * Inject the bootstrap script into the WebView so that
     * window.parent.postMessage() bridges back to GJS.
     */
    private _injectBootstrapScript(): void {
        const script = new WebKit.UserScript(
            BOOTSTRAP_SCRIPT,
            WebKit.UserContentInjectedFrames.ALL_FRAMES,
            WebKit.UserScriptInjectionTime.START,
            null, // allow list (null = all)
            null, // block list (null = none)
        );
        this._userContentManager.add_script(script);
    }

    /**
     * Inject the opt-in console-capture UserScript so the page's `console.*`
     * output is mirrored to the host. Self-contained (own handler reference +
     * idempotency guard), so it is independent of the bootstrap script.
     */
    private _injectConsoleCaptureScript(): void {
        const script = new WebKit.UserScript(
            buildConsoleCaptureScript(CHANNEL_NAME),
            WebKit.UserContentInjectedFrames.ALL_FRAMES,
            WebKit.UserScriptInjectionTime.START,
            null, // allow list (null = all)
            null, // block list (null = none)
        );
        this._userContentManager.add_script(script);
    }
}

/**
 * Walk a value tree, replacing each `MessagePort` found in
 * `portToId` with a `{__gjsifyPort: id}` placeholder. Non-transferred
 * ports pass through unchanged — caller is expected to populate the map
 * exactly with the ports listed in transferList. Plain objects + arrays
 * are walked; other tagged types (Map, Set, Date, …) and primitives are
 * left as-is.
 */
function substitutePorts(value: unknown, portToId: Map<MessagePort, number>): unknown {
    const seen = new WeakMap<object, unknown>();

    function walk(v: unknown): unknown {
        if (v === null || typeof v !== 'object') return v;
        // Use Symbol.toStringTag to detect our port without dragging
        // a runtime import dependency into this helper.
        if (
            (v as { [Symbol.toStringTag]?: string })[Symbol.toStringTag] === 'MessagePort' &&
            portToId.has(v as MessagePort)
        ) {
            return { __gjsifyPort: portToId.get(v as MessagePort) };
        }
        if (seen.has(v as object)) return seen.get(v as object);
        if (Array.isArray(v)) {
            const out: unknown[] = [];
            seen.set(v, out);
            for (let i = 0; i < v.length; i++) out[i] = walk(v[i]);
            return out;
        }
        if (Object.prototype.toString.call(v).slice(8, -1) === 'Object') {
            const out: Record<string, unknown> = {};
            seen.set(v as object, out);
            for (const k of Object.keys(v as Record<string, unknown>)) {
                out[k] = walk((v as Record<string, unknown>)[k]);
            }
            return out;
        }
        return v;
    }
    return walk(value);
}
