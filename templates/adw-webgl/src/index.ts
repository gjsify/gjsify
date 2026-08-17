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

// runAsync, not the sync run(): it is the recommended Gio.Application lifecycle
// and what every multi-runtime showcase here uses, because sync run() blocks the
// thread inside the GLib main loop — which is what hangs a startup that awaits
// anything, and the documented hazard on the `--app node` reverse bridge.
// Measured at 0.40.0: this scene starts nothing async, so the sync form happens
// to work on all four today. Kept anyway, so the template does not hand a
// scaffolded app the form that breaks the moment it grows an async startup step.
await app.runAsync([]);
