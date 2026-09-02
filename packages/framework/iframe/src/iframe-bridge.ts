// A WebKit.WebView subclass carrying the bootstrapping for HTMLIFrameElement.

import GLib from 'gi://GLib?version=2.0';
import GObject from 'gi://GObject?version=2.0';
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
// Installs the Promise-returning overloads of evaluate_javascript / get_snapshot.
import './promisify.js';

import type {
    ConsoleCallback,
    ConsoleLogEntry,
    IFrameBridgeOptions,
    IFrameReadyCallback,
    LoadErrorCallback,
    LoadErrorInfo,
} from './types/index.js';

/** A pending {@link IFrameBridge.waitForNavigation}; `sourceId` backs its deadline. */
interface NavigationWaiter {
    resolve: () => void;
    reject: (error: Error) => void;
    sourceId: number | null;
}

/**
 * A `WebKit.WebView` subclass that wraps itself in an `HTMLIFrameElement` and bridges
 * postMessage between GJS and the page.
 *
 * ```ts
 * const iframeWidget = new IFrameBridge();
 * iframeWidget.installGlobals();
 * iframeWidget.onReady((iframe) => { … });
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

            this._iframe = new HTMLIFrameElement();
            this._iframe[PS.iframeWidget] = this as unknown as IFrameBridge;

            this._messageBridge = new MessageBridge(this, { captureConsole });

            const windowProxy = new IFrameWindowProxy(this._messageBridge);
            this._iframe[PS.windowProxy] = windowProxy;
            this._messageBridge.setWindowProxy(windowProxy);

            this.connect('load-changed', (_webView: WebKit.WebView, event: WebKit.LoadEvent) => {
                switch (event) {
                    case WebKit.LoadEvent.STARTED:
                        // Cleared so `lastLoadError` only ever reflects the current page.
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
                    // A main-resource failure may never produce a FINISHED, so waiters are
                    // rejected here rather than left hanging.
                    this._settleNavigationWaiters(new Error(`load failed for ${failingUri}: ${info.message}`));
                    return false;
                },
            );

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
         * Surfaces size changes to any ResizeObserver watching the paired
         * HTMLIFrameElement or an ancestor. GTK4 has no `resize` signal on Gtk.Widget
         * (only Gtk.DrawingArea/GLArea), so this vfunc is the portable way to see them.
         */
        vfunc_size_allocate(width: number, height: number, baseline: number): void {
            super.vfunc_size_allocate(width, height, baseline);
            notifyElementResize(this._iframe, width, height);
        }

        /** The HTMLIFrameElement wrapping this WebView. */
        get iframeElement(): HTMLIFrameElement {
            return this._iframe;
        }

        /** Runs `cb` when content has loaded — on the NEXT load if it already has. */
        onReady(cb: IFrameReadyCallback): void {
            this._readyCallbacks.push(cb);
        }

        /** Load a URI, keeping the iframe element's `src` attribute in step. */
        loadUri(uri: string): void {
            this._iframe.setAttribute('src', uri);
            this.load_uri(uri);
        }

        /** Load inline HTML, keeping the iframe element's `srcdoc` attribute in step. */
        loadHtml(html: string, baseUri?: string): void {
            this._iframe.setAttribute('srcdoc', html);
            this.load_html(html, baseUri ?? 'about:srcdoc');
        }

        /** Equivalent to `iframeElement.contentWindow.postMessage(message, targetOrigin)`. */
        postMessage(message: unknown, targetOrigin = '*'): void {
            this._messageBridge.sendToWebView(message, targetOrigin);
        }

        /**
         * Back one entry in WEBKIT's own history list, independent of any
         * application-level history. No-op when `canGoBack` is false.
         *
         * The browser `<iframe>` has no equivalent (a parent cannot navigate a
         * cross-origin iframe), so cross-variant parity means tracking URLs yourself and
         * calling `loadUri(url)`.
         */
        goBack(): void {
            this.go_back();
        }

        /** Forward one entry. No-op when `canGoForward` is false; caveats as `goBack()`. */
        goForward(): void {
            this.go_forward();
        }

        // No `reload()` wrapper: WebKit.WebView's own method name is already camelCase.

        /** WebKit's `can-go-back`, NOT any application-level history stack. */
        get canGoBack(): boolean {
            return this.can_go_back();
        }

        /** WebKit's `can-go-forward`. */
        get canGoForward(): boolean {
            return this.can_go_forward();
        }

        /** WebKit's ground-truth current URI; `about:blank` before any load. */
        get currentUri(): string {
            return this.get_uri() ?? 'about:blank';
        }

        /** WebKit's tracked `<title>`; empty before it is known. */
        get pageTitle(): string {
            return this.get_title() ?? '';
        }

        /** The most recent failed load, or null when the current page had no failure. */
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
         * The value round-trips through JSON, so anything not JSON-serialisable (DOM
         * node, function, circular object) comes back as `undefined`; a thrown page error
         * rejects the promise.
         *
         * An EXPRESSION, not statements: wrap multi-statement logic in an IIFE that
         * returns a value, as `page.evaluate` requires.
         */
        async evaluateJavaScript(expression: string): Promise<unknown> {
            const value = await this.evaluate_javascript(buildEvalScript(expression), -1, null, null, null);
            return parseEvalResult(value?.to_string() ?? null);
        }

        /**
         * Capture the rendered web content as PNG bytes.
         *
         * `'full'` (default) takes the whole scrollable document, `'visible'` the current
         * viewport. Through WebKit's own `get_snapshot` and NOT a GSK widget snapshot,
         * because WebKit composites in a separate process, so a GTK-tree snapshot of the
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
         * `onReady()` is drained per load, so a page-initiated navigation (link click, JS
         * redirect, form submit, meta-refresh) never re-triggers it — register this
         * BEFORE triggering one. Rejects on a main-resource failure, or after `timeoutMs`
         * (0 disables the timeout).
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

        /** Settle and clear every pending waitForNavigation(), removing its timeout. */
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
         * Request a content-region size, e.g. for responsive testing. Only a size REQUEST:
         * the allocation still depends on the parent layout, and `getViewportSize()`
         * reports what was realised.
         */
        setViewportSize(width: number, height: number): void {
            this.set_size_request(width, height);
        }

        /** Buffered page `console.*` output; empty without `{ captureConsole: true }`. */
        getConsoleLogs(): ConsoleLogEntry[] {
            return this._messageBridge.getConsoleLogs();
        }

        /** Drop all buffered console entries. */
        clearConsoleLogs(): void {
            this._messageBridge.clearConsoleLogs();
        }

        /** Console entries as they arrive; needs `{ captureConsole: true }`. */
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
