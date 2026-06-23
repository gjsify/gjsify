// BrowserWindow — the native Adwaita shell for the minimalist browser.
//
// Extracted from showcases/dom/minimalist-browser/src/gjs/gjs.ts into a reusable
// class so both the showcase and the `gjsify browse` tool construct the same
// window. Drives the shared BrowserCore over an IFrameBridge (WebKit.WebView).

import Adw from '@girs/adw-1';
import Gtk from '@girs/gtk-4.0';

import { IFrameBridge } from '@gjsify/iframe';

import { BrowserCore, DEFAULT_HOME_URL, type IFrameHandle } from './browser-core.js';

export interface BrowserWindowOptions {
    /** Window title (default: "Minimalist Browser"). */
    title?: string;
    /** URL loaded on launch (default: `page:welcome`). */
    homeUrl?: string;
}

/**
 * A self-contained Adwaita browser window: HeaderBar with back/forward/reload +
 * URL entry, the WebKit content area, and a status line. The embedded
 * {@link IFrameBridge} captures the page console
 * so devtools `get_console` works.
 */
export class BrowserWindow {
    private readonly _win: Adw.ApplicationWindow;
    private readonly _core: BrowserCore;
    private readonly _iframeWidget: IFrameBridge;

    constructor(app: Adw.Application, options: BrowserWindowOptions = {}) {
        const homeUrl = options.homeUrl ?? DEFAULT_HOME_URL;

        this._win = new Adw.ApplicationWindow({
            application: app,
            default_width: 1100,
            default_height: 720,
            title: options.title ?? 'Minimalist Browser',
        });

        // Adw shell: ToolbarView (header bar at top, content fills remainder).
        const toolbarView = new Adw.ToolbarView();
        const headerBar = new Adw.HeaderBar();
        toolbarView.add_top_bar(headerBar);

        // Nav buttons in the header bar's start area.
        const backBtn = new Gtk.Button({ icon_name: 'go-previous-symbolic', tooltip_text: 'Back', sensitive: false });
        const forwardBtn = new Gtk.Button({ icon_name: 'go-next-symbolic', tooltip_text: 'Forward', sensitive: false });
        const reloadBtn = new Gtk.Button({ icon_name: 'view-refresh-symbolic', tooltip_text: 'Reload' });
        headerBar.pack_start(backBtn);
        headerBar.pack_start(forwardBtn);
        headerBar.pack_start(reloadBtn);

        // URL bar in the title area. No fixed `width_chars` — it would pin a
        // large minimum width and stop the window from being resized small;
        // `hexpand` already grows it to fill the header bar.
        const urlEntry = new Gtk.Entry({
            placeholder_text: 'page:welcome or https://…',
            hexpand: true,
        });
        urlEntry.set_text(homeUrl);
        headerBar.set_title_widget(urlEntry);

        // "Go" button in the end area.
        const goBtn = new Gtk.Button({ label: 'Go', css_classes: ['suggested-action'] });
        headerBar.pack_end(goBtn);

        // Main content: the WebKit content area + a status line. (The old
        // "Quick nav" strip of page:* demo pages was minimalist-browser showcase
        // cruft — confusing in a general debug browser, and its non-wrapping
        // buttons pinned the window's minimum width — so it is omitted here.)
        const contentBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 0 });

        // The content area — IFrameBridge (WebKit.WebView). captureConsole is on
        // so the devtools `get_console` tool has something to read.
        this._iframeWidget = new IFrameBridge({ captureConsole: true });
        this._iframeWidget.installGlobals();
        this._iframeWidget.vexpand = true;
        this._iframeWidget.hexpand = true;
        contentBox.append(this._iframeWidget);

        const statusBar = new Gtk.Label({
            halign: Gtk.Align.START,
            margin_start: 12,
            margin_end: 12,
            margin_top: 4,
            margin_bottom: 4,
        });
        statusBar.add_css_class('dim-label');
        statusBar.add_css_class('monospace');
        statusBar.set_text('Status: idle');
        contentBox.append(statusBar);

        toolbarView.set_content(contentBox);
        this._win.set_content(toolbarView);

        // BrowserCore drives the iframe element (duck-typed IFrameHandle).
        this._core = new BrowserCore(this._iframeWidget.iframeElement as unknown as IFrameHandle);

        // GJS variant lazy-creates contentWindow on the first load, so re-attach
        // the BrowserCore message listener after every load.
        this._iframeWidget.onReady(() => this._core.reattachListener());

        this._core.onStateChange((state) => {
            urlEntry.set_text(state.url);
            backBtn.sensitive = state.canGoBack;
            forwardBtn.sensitive = state.canGoForward;
        });
        this._core.onPageLoaded((info) => {
            statusBar.set_text(`Status: loaded "${info.title}" (${info.url})`);
        });

        const submitUrl = (): void => {
            const url = urlEntry.get_text().trim();
            if (url) this._core.navigate(url);
        };
        goBtn.connect('clicked', submitUrl);
        urlEntry.connect('activate', submitUrl);
        backBtn.connect('clicked', () => this._core.back());
        forwardBtn.connect('clicked', () => this._core.forward());
        reloadBtn.connect('clicked', () => this._core.reload());

        // Initial navigation.
        this._core.navigate(homeUrl);
    }

    /** The shared navigation core (history stack + page-loaded events). */
    get core(): BrowserCore {
        return this._core;
    }

    /** The Adw.ApplicationWindow. */
    get window(): Adw.ApplicationWindow {
        return this._win;
    }

    /** The IFrameBridge (WebKit.WebView) backing the content area. */
    get bridge(): IFrameBridge {
        return this._iframeWidget;
    }

    /** Navigate the content area to `url` (page:* built-in or a real URL). */
    navigate(url: string): void {
        this._core.navigate(url);
    }

    /** Present (show + raise) the window. */
    present(): void {
        this._win.present();
    }
}
