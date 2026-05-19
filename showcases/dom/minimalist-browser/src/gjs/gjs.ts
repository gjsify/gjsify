// GJS variant — Adw.Application + ApplicationWindow + IFrameBridge.
//
// Wires the same `BrowserCore` (from `../browser-demo.js`) into native
// Adw widgets instead of DOM. The IFrameBridge's `iframeElement` IS an
// HTMLIFrameElement that satisfies the shared `IFrameHandle` contract,
// so BrowserCore drives it identically to the browser variant's real
// <iframe>.
//
// Status: the URL bar / nav buttons are Adw native widgets; the content
// area is the IFrameBridge (WebKit.WebView under the hood). PostMessage
// round-trip from page → parent works via the IFrameBridge's
// MessageBridge.

import '@girs/gjs';
import '@girs/gtk-4.0';
import '@girs/adw-1';

import Gtk from 'gi://Gtk?version=4.0';
import Gio from 'gi://Gio?version=2.0';
import Adw from 'gi://Adw?version=1';

import { IFrameBridge } from '@gjsify/iframe';
import { BrowserCore, BUILTIN_PAGE_URLS, DEFAULT_HOME_URL } from '../browser-demo.js';

function activate(app: Adw.Application): void {
  const win = new Adw.ApplicationWindow({
    application: app,
    default_width: 1100,
    default_height: 720,
    title: 'Minimalist Browser',
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

  // URL bar in the title area.
  const urlEntry = new Gtk.Entry({
    placeholder_text: 'page:welcome or https://…',
    hexpand: true,
    width_chars: 50,
  });
  urlEntry.set_text(DEFAULT_HOME_URL);
  headerBar.set_title_widget(urlEntry);

  // "Go" button in the end area.
  const goBtn = new Gtk.Button({ label: 'Go', css_classes: ['suggested-action'] });
  headerBar.pack_end(goBtn);

  // Main content area: a vertical Box with a quick-nav strip + the iframe + status line.
  const contentBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 0 });

  // Quick-nav strip — handy on first launch.
  const quickRow = new Gtk.Box({
    orientation: Gtk.Orientation.HORIZONTAL,
    spacing: 8,
    margin_start: 12, margin_end: 12, margin_top: 6, margin_bottom: 6,
  });
  const quickLabel = new Gtk.Label({ label: 'Quick nav:' });
  quickLabel.add_css_class('dim-label');
  quickRow.append(quickLabel);
  for (const url of BUILTIN_PAGE_URLS) {
    const btn = new Gtk.Button({ label: url });
    btn.add_css_class('flat');
    btn.connect('clicked', () => core.navigate(url));
    quickRow.append(btn);
  }
  contentBox.append(quickRow);

  // Construct the IFrameBridge — this is the content area. installGlobals()
  // sets globalThis.HTMLIFrameElement so other code (BrowserCore via
  // instanceof check, etc.) sees the right class. Not strictly needed for
  // our shared-core flow but cheap and consistent with iframe-basic.
  const iframeWidget = new IFrameBridge();
  iframeWidget.installGlobals();
  iframeWidget.vexpand = true;
  iframeWidget.hexpand = true;
  contentBox.append(iframeWidget);

  // Status line — surfaces the page-loaded postMessage announcement.
  const statusBar = new Gtk.Label({
    halign: Gtk.Align.START,
    margin_start: 12, margin_end: 12, margin_top: 4, margin_bottom: 4,
  });
  statusBar.add_css_class('dim-label');
  statusBar.add_css_class('monospace');
  statusBar.set_text('Status: idle');
  contentBox.append(statusBar);

  toolbarView.set_content(contentBox);
  win.set_content(toolbarView);

  // BrowserCore takes the IFrameBridge's iframeElement (HTMLIFrameElement)
  // — same duck-type the browser variant feeds it via the real <iframe>.
  const core = new BrowserCore(iframeWidget.iframeElement as unknown as import('../browser-demo.js').IFrameHandle);

  // GJS variant lazy-creates contentWindow on the first IFrameBridge
  // load, so re-attach the BrowserCore listener after every onReady.
  iframeWidget.onReady(() => {
    core.reattachListener();
  });

  core.onStateChange((state) => {
    urlEntry.set_text(state.url);
    backBtn.sensitive = state.canGoBack;
    forwardBtn.sensitive = state.canGoForward;
  });

  core.onPageLoaded((info) => {
    statusBar.set_text(`Status: loaded "${info.title}" (${info.url})`);
  });

  function submitUrl(): void {
    const url = urlEntry.get_text().trim();
    if (url) core.navigate(url);
  }
  goBtn.connect('clicked', submitUrl);
  urlEntry.connect('activate', submitUrl);
  backBtn.connect('clicked', () => core.back());
  forwardBtn.connect('clicked', () => core.forward());
  reloadBtn.connect('clicked', () => core.reload());

  // Initial navigation — loads page:welcome on launch.
  core.navigate(DEFAULT_HOME_URL);

  win.present();
}

function main(): void {
  const app = new Adw.Application({
    application_id: 'gjsify.examples.minimalist-browser',
    flags: Gio.ApplicationFlags.FLAGS_NONE,
  });
  app.connect('activate', () => activate(app));
  app.run([]);
}

main();
