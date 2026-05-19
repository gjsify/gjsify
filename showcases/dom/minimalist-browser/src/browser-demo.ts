// Minimalist Browser — platform-agnostic shared core.
//
// The same `BrowserCore` runs in both the browser variant (driving a
// real `<iframe>` element) and the GJS variant (driving an `IFrameBridge`
// over WebKit.WebView). The variant-specific bootstrap is just a thin
// adapter that constructs an `IFrameHandle`-shaped wrapper.
//
// Cross-variant parity: both variants maintain an **application-side
// history stack** (browser-side `<iframe>` cannot be navigated
// cross-origin via `contentWindow.history.go(-1)` by spec; GJS could use
// WebKit's internal go_back but we mirror the same model for
// symmetry). Back / Forward / Reload pop the stack and re-set the
// iframe src.
//
// PostMessage demonstration: every bundled "page:<name>" srcdoc page has
// an inline `<script>` that calls `window.parent.postMessage({type:
// 'page-loaded', title, url}, '*')` on `DOMContentLoaded`. The
// `BrowserCore` listens on `iframeEl.contentWindow` and surfaces the
// announcement to the UI via the `onPageLoaded` callback.

/** Abstract shape of the iframe content area. Both real `<iframe>` and
 *  IFrameBridge's `iframeElement` satisfy this duck-type. */
export interface IFrameHandle {
  /** Either `src` (URL) or `srcdoc` (HTML) is set to navigate. */
  set src(value: string);
  get src(): string;
  set srcdoc(value: string);
  get srcdoc(): string;
  /** Provides the `contentWindow` once the frame has loaded. May be null
   *  before first load. */
  readonly contentWindow: {
    addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  } | null;
}

/** Public callback surface exposed to platform-specific UI code. */
export interface BrowserHandle {
  navigate(url: string): void;
  back(): void;
  forward(): void;
  reload(): void;
  /** Returns the URL currently displayed in the iframe. */
  readonly currentUrl: string;
  /** True when there's an entry to go back to in the application history. */
  readonly canGoBack: boolean;
  /** True when forward navigation is available. */
  readonly canGoForward: boolean;
  /** Subscribe to nav-state changes (called on every navigate / back / forward / reload). */
  onStateChange(cb: (state: NavState) => void): void;
  /** Subscribe to page-loaded postMessage announcements from the iframe. */
  onPageLoaded(cb: (info: PageLoadedInfo) => void): void;
}

export interface NavState {
  url: string;
  canGoBack: boolean;
  canGoForward: boolean;
}

export interface PageLoadedInfo {
  title: string;
  url: string;
}

/* ── Built-in page library ──────────────────────────────────────────── */

interface BuiltinPage {
  title: string;
  html: string;
}

function pageTemplate(title: string, url: string, body: string): string {
  // Each built-in page announces itself to the parent via postMessage so
  // the showcase can demonstrate the round-trip. JSON.stringify of the
  // title/url avoids quoting concerns inside the template literal.
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>
  body { font-family: system-ui, sans-serif; padding: 24px; line-height: 1.6;
         background: #fdfcfb; color: #1d1c1a; max-width: 760px; margin: 0 auto; }
  h1 { color: #4a5fb8; margin-top: 0; }
  a { color: #4a5fb8; }
  pre { background: #efeee8; padding: 12px; border-radius: 4px; overflow-x: auto; }
  code { background: #efeee8; padding: 1px 6px; border-radius: 3px; }
</style></head>
<body>
${body}
<script>
  // Announce arrival to the parent so the URL bar status line can
  // confirm the postMessage roundtrip works in both variants.
  window.addEventListener('DOMContentLoaded', function () {
    try {
      window.parent.postMessage({
        type: 'page-loaded',
        title: ${JSON.stringify(title)},
        url: ${JSON.stringify(url)},
      }, '*');
    } catch (e) { /* postMessage may be unavailable in some contexts — best-effort */ }
  });
</script>
</body></html>`;
}

const PAGES: Record<string, BuiltinPage> = {
  welcome: {
    title: 'Welcome',
    html: pageTemplate('Welcome', 'page:welcome', `
      <h1>Welcome to the Minimalist Browser</h1>
      <p>This showcase demonstrates the <code>@gjsify/iframe</code> bridge — the same
         code runs in a real browser (using a native <code>&lt;iframe&gt;</code>) and
         under GJS (using <code>IFrameBridge</code> over WebKit.WebView).</p>
      <p>Try the URL bar:</p>
      <ul>
        <li><code>page:about</code> — about this showcase</li>
        <li><code>page:postmessage</code> — postMessage round-trip demo</li>
        <li><code>page:adwaita</code> — Adwaita design language note</li>
        <li><code>https://example.com</code> — real network URL (GJS variant: loads via WebKit)</li>
      </ul>
      <p>The Back / Forward / Reload buttons use an application-side history stack
         maintained by the parent — the same code path works in both variants.</p>
    `),
  },
  about: {
    title: 'About',
    html: pageTemplate('About', 'page:about', `
      <h1>About this showcase</h1>
      <p>The Minimalist Browser is a cross-variant validation of <code>@gjsify/iframe</code>'s
         feature-completeness. The browser variant uses a real <code>&lt;iframe&gt;</code>;
         the GJS variant uses <code>IFrameBridge</code> over WebKit.WebView. Both run the
         <em>same</em> shared core code from <code>src/browser-demo.ts</code> — the only
         platform-specific code wires the platform's UI controls to the core's API
         and constructs the iframe handle.</p>
      <p>postMessage between parent (URL bar) and iframe (content area) demonstrates
         the bidirectional bridge:</p>
      <ul>
        <li><strong>Parent → iframe:</strong> the parent sends <code>{type: 'set-theme', theme}</code> when the user toggles theme (not used in this minimal demo, but reachable).</li>
        <li><strong>Iframe → parent:</strong> every page announces <code>{type: 'page-loaded', title, url}</code> on DOMContentLoaded; the parent surfaces the title in the status line.</li>
      </ul>
    `),
  },
  postmessage: {
    title: 'postMessage round-trip',
    html: pageTemplate('postMessage round-trip', 'page:postmessage', `
      <h1>postMessage round-trip</h1>
      <p>On <code>DOMContentLoaded</code>, this page calls:</p>
      <pre>window.parent.postMessage({
  type: 'page-loaded',
  title: 'postMessage round-trip',
  url: 'page:postmessage',
}, '*');</pre>
      <p>The parent's URL bar status line updates accordingly. The same code path
         runs unchanged in the browser variant (where <code>window.parent</code> is
         the real iframe parent) and the GJS variant (where it's the WebKit
         <code>script-message-handler</code> bridge into the GJS host).</p>
    `),
  },
  adwaita: {
    title: 'Adwaita design',
    html: pageTemplate('Adwaita design', 'page:adwaita', `
      <h1>Adwaita design language</h1>
      <p>The shell of this browser uses the GNOME Adwaita design language for both
         variants: native Adw widgets in the GJS variant, and <code>@gjsify/adwaita-web</code>
         custom-elements in the browser variant. The iframe content area is
         deliberately unstyled — pages bring their own styling.</p>
    `),
  },
};

/* ── BrowserCore — drives the iframe + history-stack ────────────────── */

export class BrowserCore implements BrowserHandle {
  /** Application-side history stack. The current URL is at
   *  `_history[_historyIndex]`; `back()` decrements, `forward()` increments. */
  private _history: string[] = [];
  private _historyIndex = -1;
  private _stateCbs: ((state: NavState) => void)[] = [];
  private _loadedCbs: ((info: PageLoadedInfo) => void)[] = [];

  constructor(private readonly _iframe: IFrameHandle) {
    // Wire the iframe's contentWindow listener once. The handle is
    // duck-typed: real `<iframe>` provides `.contentWindow.addEventListener`,
    // and so does the GJS `IFrameWindowProxy` returned by
    // `iframeElement.contentWindow`. Both speak W3C MessageEvent.
    //
    // `contentWindow` may be null before first load — the GJS variant
    // lazy-creates the proxy on first message. We register inside an
    // `onReady`-like hook in the platform adapter (which is responsible
    // for invoking `_attachListener` once contentWindow exists). Some
    // platforms (real browser) have it immediately.
    queueMicrotask(() => this._attachListener());
  }

  private _attachListener(): void {
    const cw = this._iframe.contentWindow;
    if (!cw) {
      // Try again after the first navigate — the GJS proxy is lazy.
      // The platform adapter may also call this explicitly.
      return;
    }
    cw.addEventListener('message', (event) => {
      const data = event.data as { type?: string; title?: string; url?: string };
      if (data && data.type === 'page-loaded' && typeof data.title === 'string' && typeof data.url === 'string') {
        for (const cb of this._loadedCbs) cb({ title: data.title, url: data.url });
      }
    });
  }

  navigate(url: string): void {
    // Truncate any forward history (browsers do the same on new
    // navigation after a back).
    this._history = this._history.slice(0, this._historyIndex + 1);
    this._history.push(url);
    this._historyIndex = this._history.length - 1;
    this._loadInto(url);
    this._emitState();
  }

  back(): void {
    if (!this.canGoBack) return;
    this._historyIndex--;
    this._loadInto(this._history[this._historyIndex]!);
    this._emitState();
  }

  forward(): void {
    if (!this.canGoForward) return;
    this._historyIndex++;
    this._loadInto(this._history[this._historyIndex]!);
    this._emitState();
  }

  reload(): void {
    if (this._historyIndex < 0) return;
    this._loadInto(this._history[this._historyIndex]!);
    // No state change — same index — but trigger the callback so the
    // status line can clear / re-flash.
    this._emitState();
  }

  get currentUrl(): string {
    return this._historyIndex >= 0 ? this._history[this._historyIndex]! : '';
  }

  get canGoBack(): boolean {
    return this._historyIndex > 0;
  }

  get canGoForward(): boolean {
    return this._historyIndex < this._history.length - 1;
  }

  onStateChange(cb: (state: NavState) => void): void {
    this._stateCbs.push(cb);
  }

  onPageLoaded(cb: (info: PageLoadedInfo) => void): void {
    this._loadedCbs.push(cb);
  }

  /**
   * Public hook for the platform adapter to re-attach the listener
   * after a `loadHtml` (GJS variant resets contentWindow on each
   * load). Browser variant doesn't need this — the real iframe keeps
   * its contentWindow across navigations.
   */
  reattachListener(): void {
    this._attachListener();
  }

  /** Internal: route a URL into the iframe, picking `srcdoc` for the
   *  `page:<name>` scheme and `src` for everything else. */
  private _loadInto(url: string): void {
    if (url.startsWith('page:')) {
      const name = url.slice('page:'.length);
      const page = PAGES[name];
      if (!page) {
        this._iframe.srcdoc = pageTemplate('Not found', url, `
          <h1>Page not found</h1>
          <p>The URL <code>${url}</code> is not a built-in page.
             Try <code>page:welcome</code>.</p>`);
        return;
      }
      this._iframe.srcdoc = page.html;
      return;
    }
    // Normal URL — set src directly. Both real iframe and IFrameBridge
    // honour the same setter.
    this._iframe.src = url;
  }

  private _emitState(): void {
    const state: NavState = {
      url: this.currentUrl,
      canGoBack: this.canGoBack,
      canGoForward: this.canGoForward,
    };
    for (const cb of this._stateCbs) cb(state);
  }
}

/** List of built-in page URLs — exported for UI dropdown / quick-nav buttons. */
export const BUILTIN_PAGE_URLS: string[] = Object.keys(PAGES).map((name) => `page:${name}`);

/** Default URL the browser opens on launch. */
export const DEFAULT_HOME_URL = 'page:welcome';
