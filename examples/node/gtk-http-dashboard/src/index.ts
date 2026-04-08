// GTK4 + HTTP Dashboard — GJS-only showcase example
// Demonstrates: GTK4 (Application, Window, Labels, TextView), http.createServer,
// GLib.idle_add for thread-safe UI updates, Gtk.Application.runAsync()

import '@gjsify/node-globals/register';
import '@girs/gjs';
import '@girs/gtk-4.0';

import Gtk from 'gi://Gtk?version=4.0';
import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';

const PORT = 3000;
let requestCount = 0;
const startTime = Date.now();

// GTK widget references
let statusLabel: Gtk.Label;
let countLabel: Gtk.Label;
let lastLabel: Gtk.Label;
let logBuffer: Gtk.TextBuffer;

function formatUptime(): string {
  const seconds = Math.floor((Date.now() - startTime) / 1000);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

function activate(app: Gtk.Application): void {
  const win = new Gtk.ApplicationWindow({ application: app });
  win.set_default_size(500, 400);
  win.set_title('gjsify HTTP Dashboard');

  const vbox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 8 });
  vbox.set_margin_top(16);
  vbox.set_margin_bottom(16);
  vbox.set_margin_start(16);
  vbox.set_margin_end(16);

  // Header
  const titleLabel = new Gtk.Label({ label: 'gjsify HTTP Dashboard' });
  titleLabel.add_css_class('title-2');

  // Status labels
  statusLabel = new Gtk.Label({ label: 'Server: Starting...', xalign: 0 });
  countLabel = new Gtk.Label({ label: 'Requests: 0', xalign: 0 });
  lastLabel = new Gtk.Label({ label: 'Last: —', xalign: 0 });

  // Log view
  const logLabel = new Gtk.Label({ label: 'Request Log:', xalign: 0 });
  logLabel.add_css_class('heading');
  logBuffer = new Gtk.TextBuffer();
  const logView = new Gtk.TextView({ buffer: logBuffer, editable: false, monospace: true });
  logView.set_wrap_mode(Gtk.WrapMode.WORD);
  const scrolled = new Gtk.ScrolledWindow({ vexpand: true });
  scrolled.set_child(logView);

  vbox.append(titleLabel);
  vbox.append(statusLabel);
  vbox.append(countLabel);
  vbox.append(lastLabel);
  vbox.append(new Gtk.Separator({}));
  vbox.append(logLabel);
  vbox.append(scrolled);

  win.set_child(vbox);
  win.present();

  // Start HTTP server
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    requestCount++;
    const now = new Date().toISOString();
    const method = req.method || 'GET';
    const url = req.url || '/';
    const logLine = `${now.slice(11, 19)} ${method} ${url}`;

    // Update GTK UI from main thread
    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
      countLabel.set_label(`Requests: ${requestCount}`);
      lastLabel.set_label(`Last: ${logLine}`);
      const iter = logBuffer.get_end_iter();
      logBuffer.insert(iter, logLine + '\n', -1);
      return GLib.SOURCE_REMOVE;
    });

    // Respond with JSON
    const data = JSON.stringify({
      dashboard: 'gjsify HTTP Dashboard',
      requests: requestCount,
      uptime: formatUptime(),
      method,
      url,
    });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(data);
  });

  server.listen(PORT, () => {
    statusLabel.set_label(`Server: http://localhost:${PORT}`);
  });

  // Periodic uptime update
  GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
    if (statusLabel) {
      statusLabel.set_label(`Server: http://localhost:${PORT} | Uptime: ${formatUptime()}`);
    }
    return GLib.SOURCE_CONTINUE;
  });
}

// Main — app.run() starts the GTK event loop. ensureMainLoop() (called by
// http.Server.listen()) detects the running GTK loop and skips creating a second one.
const app = Gtk.Application.new(
  'gjsify.examples.http-dashboard',
  Gio.ApplicationFlags.FLAGS_NONE,
);
app.connect('activate', () => activate(app));
app.run([]);
