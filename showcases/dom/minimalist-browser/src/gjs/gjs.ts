// GJS variant — Adw.Application + ApplicationWindow + IFrameBridge.
//
// Wires the same `BrowserCore` (from `../browser-demo.js`) into native Adw
// widgets. The chrome mirrors the browser/web variant (src/browser/browser.ts)
// so both targets look identical: an Adwaita window with a header bar (flat
// back/forward/reload icon buttons + a URL entry title-widget + a home button),
// a demo-page quick-nav toolbar, the WebKit content, and a status bottom bar.
//
// The IFrameBridge's `iframeElement` IS an HTMLIFrameElement satisfying the
// shared `IFrameHandle` contract, so BrowserCore drives it just like the real
// <iframe> in the browser variant.

import '@girs/gjs';
import '@girs/gtk-4.0';
import '@girs/adw-1';

import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import Pango from 'gi://Pango?version=1.0';

import { installDevtools } from '@gjsify/devtools';
import { IFrameBridge } from '@gjsify/iframe';
import { BrowserCore, BUILTIN_PAGE_URLS, DEFAULT_HOME_URL, type IFrameHandle } from '../browser-demo.js';

/** A flat header-bar icon button (back / forward / reload / home). */
function navButton(iconName: string, tooltip: string): Gtk.Button {
    const btn = new Gtk.Button({ icon_name: iconName, tooltip_text: tooltip });
    btn.add_css_class('flat');
    return btn;
}

function activate(app: Adw.Application): void {
    const win = new Adw.ApplicationWindow({
        application: app,
        default_width: 1100,
        default_height: 720,
        title: 'Minimalist Browser',
    });

    const toolbarView = new Adw.ToolbarView();

    // --- Header bar: [back][forward][reload]  ·  URL entry  ·  [home] ---
    const headerBar = new Adw.HeaderBar();

    const backBtn = navButton('go-previous-symbolic', 'Back');
    const forwardBtn = navButton('go-next-symbolic', 'Forward');
    const reloadBtn = navButton('view-refresh-symbolic', 'Reload');
    backBtn.sensitive = false;
    forwardBtn.sensitive = false;
    headerBar.pack_start(backBtn);
    headerBar.pack_start(forwardBtn);
    headerBar.pack_start(reloadBtn);

    const urlEntry = new Gtk.Entry({
        placeholder_text: 'Search or enter address',
        hexpand: true,
        width_chars: 50,
    });
    urlEntry.set_text(DEFAULT_HOME_URL);
    headerBar.set_title_widget(urlEntry);

    const homeBtn = navButton('go-home-symbolic', 'Home');
    headerBar.pack_end(homeBtn);

    toolbarView.add_top_bar(headerBar);

    // --- Quick-nav: built-in demo pages as flat buttons (a second top bar). ---
    const quickRow = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 2,
        margin_start: 6,
        margin_end: 6,
        margin_top: 3,
        margin_bottom: 3,
    });
    quickRow.add_css_class('toolbar');
    const quickLabel = new Gtk.Label({ label: 'Demo pages', margin_start: 3, margin_end: 6 });
    quickLabel.add_css_class('dim-label');
    quickLabel.add_css_class('caption');
    quickRow.append(quickLabel);
    for (const url of BUILTIN_PAGE_URLS) {
        const btn = new Gtk.Button({ label: url });
        btn.add_css_class('flat');
        btn.connect('clicked', () => core.navigate(url));
        quickRow.append(btn);
    }
    toolbarView.add_top_bar(quickRow);

    // --- Content: the IFrameBridge (WebKit.WebView under the hood). ---
    const iframeWidget = new IFrameBridge();
    iframeWidget.installGlobals();
    iframeWidget.vexpand = true;
    iframeWidget.hexpand = true;
    toolbarView.set_content(iframeWidget);

    // --- Status: a dim monospace bottom bar. ---
    const statusBar = new Gtk.Label({
        halign: Gtk.Align.START,
        xalign: 0,
        ellipsize: Pango.EllipsizeMode.END,
        margin_start: 12,
        margin_end: 12,
        margin_top: 4,
        margin_bottom: 4,
    });
    statusBar.add_css_class('dim-label');
    statusBar.add_css_class('monospace');
    statusBar.add_css_class('caption');
    statusBar.set_text('Ready');
    toolbarView.add_bottom_bar(statusBar);

    win.set_content(toolbarView);

    // --- Shared navigation core. ---
    const core = new BrowserCore(iframeWidget.iframeElement as unknown as IFrameHandle);

    // GJS lazy-creates contentWindow on the first IFrameBridge load, so
    // re-attach the BrowserCore listener after every onReady.
    iframeWidget.onReady(() => core.reattachListener());

    core.onStateChange((state) => {
        urlEntry.set_text(state.url);
        backBtn.sensitive = state.canGoBack;
        forwardBtn.sensitive = state.canGoForward;
    });
    core.onPageLoaded((info) => {
        statusBar.set_text(`Loaded “${info.title}” — ${info.url}`);
    });

    function submitUrl(): void {
        const url = urlEntry.get_text().trim();
        if (url) core.navigate(url);
    }
    urlEntry.connect('activate', submitUrl);
    homeBtn.connect('clicked', () => core.navigate(DEFAULT_HOME_URL));
    backBtn.connect('clicked', () => core.back());
    forwardBtn.connect('clicked', () => core.forward());
    reloadBtn.connect('clicked', () => core.reload());

    core.navigate(DEFAULT_HOME_URL);
    win.present();
}

function main(): void {
    const app = new Adw.Application({
        application_id: 'gjsify.examples.minimalist-browser',
        flags: Gio.ApplicationFlags.FLAGS_NONE,
    });
    // Opt-in devtools control plane — a no-op unless GJSIFY_DEVTOOLS is set, so
    // production runs are unaffected. Makes the showcase screenshot/MCP-debuggable
    // (`gjsify debug`), like the storybook.
    app.connect('startup', () => installDevtools(app));
    app.connect('activate', () => activate(app));
    app.run([]);
}

main();
