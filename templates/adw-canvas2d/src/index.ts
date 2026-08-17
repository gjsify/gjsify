import '@girs/gjs';
import '@girs/gtk-4.0';

import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio?version=2.0';
import { MainWindow } from './main-window.js';

const app = new Adw.Application({
    application_id: 'org.gjsify.example',
    flags: Gio.ApplicationFlags.FLAGS_NONE,
});

app.connect('activate', () => {
    let win = app.get_active_window();
    if (!win) win = new MainWindow(app);
    win.present();
});

// runAsync, not the sync run(): it defers the blocking main loop to a macrotask so
// promise continuations queued before it still drain. A sync run() works today, but
// it parks them until the loop returns the moment anything here becomes asynchronous
// — ADR 0009's latent hang, which node-gi inherits on node/bun/deno (node-gtk #442).
// One lifecycle for all four runtimes, and the one a scaffolded app should grow from.
await app.runAsync([]);
