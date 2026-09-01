// Browser variant: Adwaita-styled chrome from @gjsify/adwaita-web custom elements driving a real
// <iframe>, structured to match the native GTK chrome in src/gjs/gjs.ts so both targets look alike.
// `mount(container, options?)` is what lets the website slideshow embed the showcase; standalone goes
// through browser-main.ts.

import '@gjsify/adwaita-web'; // registers the custom elements + self-injects the stylesheet
// A showcase is served to whatever browser opens it, so it cannot assume the host has
// Adwaita Sans the way a GNOME desktop does. `import '@gjsify/adwaita-web'` names the
// family and ships no `@font-face`, so without this call the chrome renders in the host's
// default sans on macOS, on Windows and on any Linux that is not GNOME — and looks right
// only on the machine it was written on.
import { applyAdwaitaFonts } from '@gjsify/adwaita-web/fonts';
import type { Adw, Gtk } from '@gjsify/adwaita-web';
import { BrowserCore, BUILTIN_PAGE_URLS, DEFAULT_HOME_URL, type IFrameHandle } from '../browser-demo.js';

// Idempotent, and a no-op where there is no `document` — so a build-time import of this
// module (the website slideshow does one) neither throws nor half-applies.
applyAdwaitaFonts();

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

// Layout chrome only, no reusable component: driven by the adwaita-web CSS custom properties so it
// follows the active theme.
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
    const b = document.createElement('gtk-button');
    b.setAttribute('icon', icon);
    b.setAttribute('tooltip', tooltip);
    b.setAttribute('flat', '');
    return b;
}

export function mount(container: HTMLElement, options?: MountOptions): ShowcaseHandle {
    const homeUrl = options?.homeUrl ?? DEFAULT_HOME_URL;
    ensureStyles();

    const win = document.createElement('adw-window');
    win.classList.add('mb-window');

    const header = document.createElement('adw-header-bar') as Adw.HeaderBar;

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

    const backBtn = iconButton('go-previous', 'Back');
    const forwardBtn = iconButton('go-next', 'Forward');
    const reloadBtn = iconButton('view-refresh', 'Reload');
    backBtn.setAttribute('disabled', '');
    forwardBtn.setAttribute('disabled', '');
    header.startSection?.append(backBtn, forwardBtn, reloadBtn);

    const urlEntry = document.createElement('gtk-entry') as Gtk.Entry;
    urlEntry.classList.add('mb-url');
    urlEntry.setAttribute('placeholder', 'Search or enter address');
    urlEntry.setAttribute('value', homeUrl);
    header.centerSection?.appendChild(urlEntry);

    const homeBtn = iconButton('go-home', 'Home');
    header.endSection?.appendChild(homeBtn);

    const quickLabel = document.createElement('span');
    quickLabel.className = 'mb-quicknav-label';
    quickLabel.textContent = 'Demo pages';
    quicknav.appendChild(quickLabel);
    for (const url of BUILTIN_PAGE_URLS) {
        const b = document.createElement('gtk-button');
        b.setAttribute('label', url);
        b.setAttribute('flat', '');
        b.addEventListener('click', () => core.navigate(url));
        quicknav.appendChild(b);
    }

    // BrowserCore cannot be handed the raw iframe here. `window.parent.postMessage(...)` from a
    // page dispatches `message` on the HOST window, not on the iframe's `contentWindow`, and since
    // this iframe is sandboxed cross-origin (allow-scripts without allow-same-origin) even READING
    // `iframe.contentWindow.addEventListener` throws a SecurityError. So the handle subscribes on
    // `window`, filtered to this iframe. The GJS variant needs none of it: its
    // `IFrameBridge.iframeElement.contentWindow` is a same-process proxy over WebKit's
    // script-message-handler, so listening there is already correct.
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
                        // Identity-comparing the source WindowProxy is allowed even cross-origin;
                        // reading its properties is not.
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
