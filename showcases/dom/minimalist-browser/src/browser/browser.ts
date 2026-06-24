// Browser variant — Adwaita-styled chrome built from @gjsify/adwaita-web custom
// elements, driving a real <iframe>. The structure mirrors the native GJS/GTK
// chrome (src/gjs/gjs.ts) so the two targets look identical: an Adwaita window
// with a header bar (linked-free flat nav buttons + a URL entry title-widget +
// a home button), a demo-page quick-nav, the web content, and a status line.
//
// Exposes `mount(container, options?)` so the website slideshow can embed the
// showcase. Standalone runs through `browser-main.ts` (`mount(document.body)`).

import '@gjsify/adwaita-web'; // registers the custom elements + self-injects the stylesheet
import type { AdwEntry, AdwHeaderBar } from '@gjsify/adwaita-web';
import { BrowserCore, BUILTIN_PAGE_URLS, DEFAULT_HOME_URL, type IFrameHandle } from '../browser-demo.js';

export interface MountOptions {
    /** Override the URL loaded on startup. */
    homeUrl?: string;
    /** @deprecated The header no longer shows an app title (HIG). Accepted for compatibility. */
    title?: string;
}

export interface ShowcaseHandle {
    pause(): void;
    resume(): void;
    readonly isPaused: boolean;
    navigate(url: string): void;
}

// Layout chrome that isn't a reusable Adwaita component — kept tiny and driven
// by the adwaita-web CSS custom properties so it follows the active theme.
const SHOWCASE_CSS = `
.mb-window { height: 100%; width: 100%; overflow: hidden; }
.mb-url { max-width: 720px; }
.mb-quicknav {
    display: flex; align-items: center; gap: 2px; flex-wrap: wrap;
    padding: 3px 9px;
    background: var(--window-bg-color);
    box-shadow: inset 0 -1px var(--headerbar-shade-color);
}
.mb-quicknav-label {
    margin: 0 6px 0 3px;
    color: var(--window-fg-color); opacity: var(--dim-opacity);
    font-size: var(--font-size-small);
}
.mb-iframe { flex: 1; min-height: 0; border: none; width: 100%; background: var(--view-bg-color); }
.mb-status {
    padding: 4px 12px;
    background: var(--window-bg-color);
    box-shadow: inset 0 1px var(--headerbar-shade-color);
    color: var(--window-fg-color); opacity: var(--dim-opacity);
    font-family: ui-monospace, 'Adwaita Mono', monospace; font-size: var(--font-size-small);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
`;

function ensureStyles(): void {
    // The Adwaita stylesheet is self-injected by `import '@gjsify/adwaita-web'`;
    // only the showcase's own layout chrome needs injecting here.
    if (!document.getElementById('minimalist-browser-style')) {
        const s = document.createElement('style');
        s.id = 'minimalist-browser-style';
        s.textContent = SHOWCASE_CSS;
        document.head.appendChild(s);
    }
}

function iconButton(icon: string, tooltip: string): HTMLElement {
    const b = document.createElement('adw-button');
    b.setAttribute('icon', icon);
    b.setAttribute('tooltip', tooltip);
    b.setAttribute('flat', '');
    return b;
}

export function mount(container: HTMLElement, options?: MountOptions): ShowcaseHandle {
    const homeUrl = options?.homeUrl ?? DEFAULT_HOME_URL;
    ensureStyles();

    // Adwaita window frame.
    const win = document.createElement('adw-window');
    win.classList.add('mb-window');

    // Header bar + the static body (quick-nav, content iframe, status).
    const header = document.createElement('adw-header-bar') as AdwHeaderBar;

    const quicknav = document.createElement('div');
    quicknav.className = 'mb-quicknav';

    const iframe = document.createElement('iframe');
    iframe.className = 'mb-iframe';
    iframe.setAttribute('sandbox', 'allow-scripts');

    const status = document.createElement('div');
    status.className = 'mb-status';
    status.textContent = 'Ready';

    win.append(header, quicknav, iframe, status);
    container.appendChild(win); // connects every custom element + creates header sections

    // Header navigation cluster (start): back / forward / reload.
    const backBtn = iconButton('go-previous', 'Back');
    const forwardBtn = iconButton('go-next', 'Forward');
    const reloadBtn = iconButton('view-refresh', 'Reload');
    backBtn.setAttribute('disabled', '');
    forwardBtn.setAttribute('disabled', '');
    header.startSection?.append(backBtn, forwardBtn, reloadBtn);

    // Header title-widget (center): the URL entry.
    const urlEntry = document.createElement('adw-entry') as AdwEntry;
    urlEntry.classList.add('mb-url');
    urlEntry.setAttribute('placeholder', 'Search or enter address');
    urlEntry.setAttribute('value', homeUrl);
    header.centerSection?.appendChild(urlEntry);

    // Header end: home.
    const homeBtn = iconButton('go-home', 'Home');
    header.endSection?.appendChild(homeBtn);

    // Quick-nav: built-in demo pages as flat buttons.
    const quickLabel = document.createElement('span');
    quickLabel.className = 'mb-quicknav-label';
    quickLabel.textContent = 'Demo pages';
    quicknav.appendChild(quickLabel);
    for (const url of BUILTIN_PAGE_URLS) {
        const b = document.createElement('adw-button');
        b.setAttribute('label', url);
        b.setAttribute('flat', '');
        b.addEventListener('click', () => core.navigate(url));
        quicknav.appendChild(b);
    }

    // Wire the shared navigation core. The built-in `page:*` documents announce
    // themselves with `window.parent.postMessage(...)` — which, in a real
    // browser, dispatches the `message` event on the HOST window, NOT on the
    // iframe's own `contentWindow`. And because the iframe is a sandboxed
    // (allow-scripts, no allow-same-origin) cross-origin frame, even *reading*
    // `iframe.contentWindow.addEventListener` throws a SecurityError. So instead
    // of handing `BrowserCore` the raw iframe (whose `contentWindow` is the
    // wrong, inaccessible target), we wrap it in an `IFrameHandle` whose
    // `contentWindow.addEventListener` subscribes on `window`, filtered to
    // messages originating from this iframe. The GJS variant doesn't need this:
    // its `IFrameBridge.iframeElement.contentWindow` is a same-process proxy that
    // bridges WebKit's script-message-handler, so listening there is correct.
    const iframeHandle: IFrameHandle = {
        get src() {
            return iframe.src;
        },
        set src(value: string) {
            iframe.src = value;
        },
        get srcdoc() {
            return iframe.srcdoc;
        },
        set srcdoc(value: string) {
            iframe.srcdoc = value;
        },
        get contentWindow() {
            return {
                addEventListener(_type: 'message', listener: (event: { data: unknown }) => void): void {
                    window.addEventListener('message', (event) => {
                        // Identity-compare the source WindowProxy (allowed even
                        // for cross-origin frames; reading its properties is not)
                        // so we only surface messages from our own iframe.
                        if (event.source === iframe.contentWindow) listener(event);
                    });
                },
            };
        },
    };
    const core = new BrowserCore(iframeHandle);
    let paused = false;

    core.onStateChange((state) => {
        if (paused) return;
        urlEntry.value = state.url;
        backBtn.toggleAttribute('disabled', !state.canGoBack);
        forwardBtn.toggleAttribute('disabled', !state.canGoForward);
    });
    core.onPageLoaded((info) => {
        if (paused) return;
        status.textContent = `Loaded “${info.title}” — ${info.url}`;
    });

    const submit = () => {
        const value = urlEntry.value.trim();
        if (value) core.navigate(value);
    };
    urlEntry.addEventListener('activate', submit);
    homeBtn.addEventListener('click', () => core.navigate(homeUrl));
    backBtn.addEventListener('click', () => core.back());
    forwardBtn.addEventListener('click', () => core.forward());
    reloadBtn.addEventListener('click', () => core.reload());

    core.navigate(homeUrl);

    return {
        pause(): void {
            paused = true;
        },
        resume(): void {
            paused = false;
        },
        get isPaused(): boolean {
            return paused;
        },
        navigate(url: string): void {
            core.navigate(url);
        },
    };
}
