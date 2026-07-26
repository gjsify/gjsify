// IFrameBridge — GTK container for HTMLIFrameElement backed by WebKit.WebView.
// Provides a WebKit.WebView subclass that bundles all iframe bootstrapping.

import GLib from 'gi://GLib?version=2.0';
import GObject from 'gi://GObject';
import WebKit from 'gi://WebKit?version=6.0';

import { Document, notifyElementResize } from '@gjsify/dom-elements';

import {
    buildClickElementExpression,
    buildGetLinksExpression,
    buildQueryDomExpression,
    type ElementInfo,
    type LinkInfo,
} from './dom-queries.js';
import { buildEvalScript, parseEvalResult } from './eval.js';
import { HTMLIFrameElement } from './html-iframe-element.js';
import { IFrameWindowProxy } from './iframe-window-proxy.js';
import { MessageBridge } from './message-bridge.js';
import * as PS from './property-symbol.js';
// Install the Promise-returning overloads of evaluate_javascript / get_snapshot.
import './promisify.js';

import type {
    ConsoleCallback,
    ConsoleLogEntry,
    IFrameBridgeOptions,
    IFrameReadyCallback,
    LoadErrorCallback,
    LoadErrorInfo,
} from './types/index.js';

/** A pending {@link IFrameBridge.waitForNavigation} promise. `sourceId` is the
 *  GLib timeout source backing its deadline (null when no timeout). */
interface NavigationWaiter {
    resolve: () => void;
    reject: (error: Error) => void;
    sourceId: number | null;
}

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
        /** Pending waitForNavigation() promises, settled on the next load. */
        _navigationWaiters: NavigationWaiter[] = [];
        /** Detail of the most recent failed load, or null after a fresh start. */
        _lastLoadError: LoadErrorInfo | null = null;
        _loadErrorCallbacks: LoadErrorCallback[] = [];

        constructor(options?: IFrameBridgeOptions & Partial<WebKit.WebView.ConstructorProps>) {
            const { enableDeveloperExtras, enableJavascript, captureConsole, ...webViewProps } = options ?? {};

            const userContentManager = new WebKit.UserContentManager();
            const settings = new WebKit.Settings();
            settings.enable_javascript = enableJavascript ?? true;
            settings.enable_developer_extras = enableDeveloperExtras ?? true;

            super({
                ...webViewProps,
                user_content_manager: userContentManager,
                settings,
            });

            this._options = { enableDeveloperExtras, enableJavascript, captureConsole };

            // Create the DOM element and link it to this widget
            this._iframe = new HTMLIFrameElement();
            this._iframe[PS.iframeWidget] = this as unknown as IFrameBridge;

            // Set up the message bridge
            this._messageBridge = new MessageBridge(this, { captureConsole });

            // Create the window proxy and connect it
            const windowProxy = new IFrameWindowProxy(this._messageBridge);
            this._iframe[PS.windowProxy] = windowProxy;
            this._messageBridge.setWindowProxy(windowProxy);

            // Track load state
            this.connect('load-changed', (_webView: WebKit.WebView, event: WebKit.LoadEvent) => {
                switch (event) {
                    case WebKit.LoadEvent.STARTED:
                        // A fresh navigation began — clear the stale error so
                        // lastLoadError only ever reflects the current page.
                        this._lastLoadError = null;
                        break;
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
                        // Resolve any waitForNavigation() promises waiting for
                        // this load to finish.
                        this._settleNavigationWaiters(null);
                        break;
                }
            });

            this.connect(
                'load-failed',
                (_webView: WebKit.WebView, _event: WebKit.LoadEvent, failingUri: string, error: GLib.Error) => {
                    const info: LoadErrorInfo = { uri: failingUri, message: error?.message ?? 'load failed' };
                    this._lastLoadError = info;
                    for (const cb of this._loadErrorCallbacks) cb(info);
                    this._iframe._onError();
                    // A main-resource failure may produce no subsequent FINISHED,
                    // so reject pending waiters rather than let them hang.
                    this._settleNavigationWaiters(new Error(`load failed for ${failingUri}: ${info.message}`));
                    return false;
                },
            );

            // Allocation changes are surfaced to ResizeObserver via the
            // vfunc_size_allocate override below — Gtk.Widget/WebKit.WebView has
            // no `resize` signal in GTK4 (only Gtk.DrawingArea/GLArea do).

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

        /**
         * GTK4 allocation hook — surfaces WebKit.WebView size changes to any
         * ResizeObserver watching the paired HTMLIFrameElement (or an ancestor;
         * see notifyElementResize). GTK4 has no `resize` signal on Gtk.Widget
         * (only Gtk.DrawingArea/GLArea), so the allocation vfunc is the portable
         * way to observe the widget's size.
         */
        vfunc_size_allocate(width: number, height: number, baseline: number): void {
            super.vfunc_size_allocate(width, height, baseline);
            notifyElementResize(this._iframe, width, height);
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
         * Navigate the embedded WebView back one entry in its internal
         * history list. No-op when `canGoBack` is false.
         *
         * Note: reflects WebKit's own navigation history (independent of
         * any application-level history the embedder maintains). The
         * browser `<iframe>` element has no equivalent — cross-origin
         * iframes cannot be navigated programmatically by the parent. For
         * cross-variant (browser + GJS) parity, embedders typically track
         * URLs themselves and call `loadUri(url)`; the methods here exist
         * for apps that DO want to expose the WebKit-internal back/forward
         * list directly (e.g. a "WebView with browser-like UX").
         */
        goBack(): void {
            this.go_back();
        }

        /** Navigate forward in the WebView's internal history. No-op when
         *  `canGoForward` is false. See `goBack()` for caveats. */
        goForward(): void {
            this.go_forward();
        }

        // `reload()` is inherited from WebKit.WebView verbatim — no
        // camelCase rewrap needed (the GIR-generated method name already
        // matches the convention). Apps call `iframeWidget.reload()`
        // directly.

        /** True when the WebView has prior entries in its internal history.
         *  Reflects WebKit's `can-go-back` state, NOT any application-level
         *  history stack. */
        get canGoBack(): boolean {
            return this.can_go_back();
        }

        /** True when the WebView has forward entries in its internal history.
         *  Reflects WebKit's `can-go-forward` state. */
        get canGoForward(): boolean {
            return this.can_go_forward();
        }

        /** WebKit's ground-truth current URI (`about:blank` before any load).
         *  Distinct from any application-side history the embedder maintains. */
        get currentUri(): string {
            return this.get_uri() ?? 'about:blank';
        }

        /** The loaded document's title (empty string before it is known).
         *  Reflects WebKit's tracked `<title>`. */
        get pageTitle(): string {
            return this.get_title() ?? '';
        }

        /** Detail of the most recent failed load, or null when the current
         *  page loaded without a main-resource failure. */
        get lastLoadError(): LoadErrorInfo | null {
            return this._lastLoadError;
        }

        /** Subscribe to load failures (network / main-resource errors). */
        onLoadError(cb: LoadErrorCallback): void {
            this._loadErrorCallbacks.push(cb);
        }

        /**
         * Evaluate a JavaScript *expression* in the page and return its value.
         *
         * The value is serialised to JSON in-page and parsed on the GJS host,
         * so objects/arrays/strings/numbers/booleans/null round-trip. A value
         * that is not JSON-serialisable (DOM node, function, circular object)
         * comes back as `undefined`. A thrown page error rejects the promise.
         *
         * Pass an expression, not statements — wrap multi-statement logic in an
         * IIFE that returns a value, e.g.
         * `evaluateJavaScript('(() => { const a = 1; return a + 1; })()')`.
         * This mirrors Playwright/Puppeteer `page.evaluate` ergonomics.
         */
        async evaluateJavaScript(expression: string): Promise<unknown> {
            const value = await this.evaluate_javascript(buildEvalScript(expression), -1, null, null, null);
            return parseEvalResult(value?.to_string() ?? null);
        }

        /**
         * Capture the rendered web content as PNG bytes.
         *
         * `'full'` (default) snapshots the whole scrollable document; `'visible'`
         * snapshots only the current viewport. This goes through WebKit's own
         * `get_snapshot` — NOT a GSK widget snapshot — because WebKit composites
         * its content in a separate process, so a GTK-tree snapshot of the
         * WebView can come back blank or stale.
         */
        async takeScreenshot(region: 'full' | 'visible' = 'full'): Promise<Uint8Array> {
            const snapshotRegion =
                region === 'visible' ? WebKit.SnapshotRegion.VISIBLE : WebKit.SnapshotRegion.FULL_DOCUMENT;
            const texture = await this.get_snapshot(snapshotRegion, WebKit.SnapshotOptions.NONE, null);
            const data = texture.save_to_png_bytes().get_data();
            return data ? new Uint8Array(data) : new Uint8Array(0);
        }

        /**
         * Resolve on the next load that finishes (`LoadEvent.FINISHED`).
         *
         * `onReady()` fires only once and is drained per load, so a
         * page-initiated navigation (link click, JS redirect, form submit,
         * meta-refresh) never re-triggers it. Register a `waitForNavigation()`
         * *before* triggering such a navigation. Rejects on a main-resource
         * load failure, or after `timeoutMs` (0 disables the timeout).
         */
        waitForNavigation(timeoutMs = 30000): Promise<void> {
            return new Promise<void>((resolve, reject) => {
                const waiter: NavigationWaiter = { resolve, reject, sourceId: null };
                if (timeoutMs > 0) {
                    waiter.sourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, timeoutMs, () => {
                        const index = this._navigationWaiters.indexOf(waiter);
                        if (index !== -1) this._navigationWaiters.splice(index, 1);
                        waiter.sourceId = null;
                        reject(new Error(`waitForNavigation: timed out after ${timeoutMs}ms`));
                        return GLib.SOURCE_REMOVE;
                    });
                }
                this._navigationWaiters.push(waiter);
            });
        }

        /** Settle (and clear) every pending waitForNavigation() promise,
         *  removing its timeout source. Resolves them on success; rejects with
         *  `error` on a load failure. */
        _settleNavigationWaiters(error: Error | null): void {
            if (this._navigationWaiters.length === 0) return;
            const waiters = this._navigationWaiters;
            this._navigationWaiters = [];
            for (const waiter of waiters) {
                if (waiter.sourceId !== null) {
                    GLib.source_remove(waiter.sourceId);
                    waiter.sourceId = null;
                }
                if (error) waiter.reject(error);
                else waiter.resolve();
            }
        }

        /** Current size of the WebView content region, in widget pixels. */
        getViewportSize(): { width: number; height: number } {
            return { width: this.get_allocated_width(), height: this.get_allocated_height() };
        }

        /**
         * Request a content-region size (e.g. for responsive testing). This sets
         * the widget's size request; the actual allocation still depends on the
         * parent layout, and `getViewportSize()` reflects the realised size.
         */
        setViewportSize(width: number, height: number): void {
            this.set_size_request(width, height);
        }

        /** Buffered page `console.*` output. Empty unless the bridge was created
         *  with `{ captureConsole: true }`. */
        getConsoleLogs(): ConsoleLogEntry[] {
            return this._messageBridge.getConsoleLogs();
        }

        /** Drop all buffered console entries. */
        clearConsoleLogs(): void {
            this._messageBridge.clearConsoleLogs();
        }

        /** Subscribe to captured console entries as they arrive. Requires
         *  `{ captureConsole: true }` to receive anything. */
        onConsole(cb: ConsoleCallback): void {
            this._messageBridge.onConsole(cb);
        }

        /** Every `<a href>` on the page (resolved href, trimmed text, title). */
        async getLinks(): Promise<LinkInfo[]> {
            const result = await this.evaluateJavaScript(buildGetLinksExpression());
            return Array.isArray(result) ? (result as LinkInfo[]) : [];
        }

        /** Metadata for elements matching a CSS selector (capped at `limit`). */
        async queryDom(selector: string, limit = 200): Promise<ElementInfo[]> {
            const result = await this.evaluateJavaScript(buildQueryDomExpression(selector, limit));
            return Array.isArray(result) ? (result as ElementInfo[]) : [];
        }

        /**
         * Click the first element matching `selectorOrText` — a CSS selector, or
         * (failing that) an `<a>` matched by exact trimmed text. Resolves to true
         * when an element was found + clicked. Does NOT wait for navigation: to
         * await a resulting page change, register `waitForNavigation()` *before*
         * calling this, then await it (a fast navigation may finish first).
         */
        async clickElement(selectorOrText: string): Promise<boolean> {
            const result = await this.evaluateJavaScript(buildClickElementExpression(selectorOrText));
            return result === true;
        }

        /**
         * Install the iframe DOM surface imperatively: sets
         * `globalThis.HTMLIFrameElement` to the gjsify implementation AND registers
         * the `'iframe'` element factory so `document.createElement('iframe')`
         * returns it.
         *
         * This is the same pair `@gjsify/iframe/register` installs — the explicit,
         * unconditional counterpart of the tree-shakeable `/register` subpath (which
         * `--globals auto` injects when it sees a free `HTMLIFrameElement`). Both are
         * needed here: the element factory used to come along for free with the
         * barrel's import side effect, and app code that calls `installGlobals()` and
         * then `document.createElement('iframe')` must keep working (ADR 0012 moved
         * the side effect out of `index.ts`; it did not remove the capability).
         *
         * Unconditional by design — an explicit call means "make MY implementation
         * the one `document` and `globalThis` hand out", so it overrides whatever is
         * already installed.
         */
        installGlobals(): void {
            Document.registerElementFactory('iframe', () => new HTMLIFrameElement());
            Object.defineProperty(globalThis, 'HTMLIFrameElement', {
                value: HTMLIFrameElement,
                writable: true,
                configurable: true,
            });
        }
    },
);

export type IFrameBridge = InstanceType<typeof IFrameBridge>;
