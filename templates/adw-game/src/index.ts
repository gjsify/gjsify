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

// runAsync, not the blocking run(): it defers the main loop by one macrotask, so
// promise work queued while the app starts — engine.start(), and the resources a
// real game loads before its first frame — settles before the loop takes the
// thread. The blocking run() does boot THIS starter game on all four runtimes;
// runAsync is the lifecycle GJS recommends and the one a growing game needs.
await app.runAsync([]);
