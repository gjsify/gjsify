// GJS/Adwaita entry point for canvas2d-fireworks example.

import '@girs/gjs';
import '@girs/gtk-4.0';

import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio?version=2.0';
import { FireworksWindow } from './fireworks-window.js';

const app = new Adw.Application({
    application_id: 'gjsify.examples.canvas2d-fireworks',
    flags: Gio.ApplicationFlags.FLAGS_NONE,
});

app.connect('activate', () => {
    let win = app.get_active_window();
    if (!win) win = new FireworksWindow(app);
    win.present();
});

app.run([]);
