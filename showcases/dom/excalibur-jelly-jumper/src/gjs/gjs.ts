// GJS/Adwaita entry point for the Excalibur Jelly Jumper showcase.

import '@girs/gjs';
import '@girs/gtk-4.0';

import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio?version=2.0';

import { installDevtools } from '@gjsify/devtools';
import { JellyJumperWindow } from './jelly-jumper-window.js';

const app = new Adw.Application({
    application_id: 'gjsify.examples.excalibur-jelly-jumper',
    flags: Gio.ApplicationFlags.FLAGS_NONE,
});

// Opt-in devtools control plane — a no-op unless GJSIFY_DEVTOOLS is set, so
// production runs are unaffected. Makes the showcase screenshot/MCP-debuggable
// (`gjsify debug`), like the storybook.
app.connect('startup', () => installDevtools(app));

app.connect('activate', () => {
    let win = app.get_active_window();
    if (!win) win = new JellyJumperWindow(app);
    win.present();
});

// runAsync (NOT the sync run()): defers the blocking loop to a macrotask so the
// game's promise-driven boot (engine.start(), asset loading) drains WHILE the
// loop runs — required on the node-gi reverse bridge (`gjsify run --runtime
// node`) and the GJS-recommended lifecycle anyway (Gio.Application.runAsync).
await app.runAsync([]);
