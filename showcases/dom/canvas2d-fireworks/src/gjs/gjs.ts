// GJS/Adwaita entry point for canvas2d-fireworks example.

import '@girs/gjs';
import '@girs/gtk-4.0';

import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio?version=2.0';

import { installDevtools } from '@gjsify/devtools';
import { FireworksWindow } from './fireworks-window.js';

const app = new Adw.Application({
    application_id: 'gjsify.examples.canvas2d-fireworks',
    flags: Gio.ApplicationFlags.FLAGS_NONE,
});

// Opt-in devtools control plane — a no-op unless GJSIFY_DEVTOOLS is set, so
// production runs are unaffected. Makes the showcase screenshot/MCP-debuggable
// (`gjsify debug`), like the storybook.
app.connect('startup', () => installDevtools(app));

app.connect('activate', () => {
    let win = app.get_active_window();
    if (!win) win = new FireworksWindow(app);
    win.present();
});

app.run([]);
