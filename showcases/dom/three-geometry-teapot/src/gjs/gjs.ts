// GJS/Adwaita entry point for three-geometry-teapot example.
// Ported from refs/three/examples/webgl_geometry_teapot.html

import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio?version=2.0';
import { TeapotWindow } from './teapot-window.js';

const app = new Adw.Application({
    application_id: 'gjsify.examples.three-geometry-teapot',
    flags: Gio.ApplicationFlags.FLAGS_NONE,
});

app.connect('activate', () => {
    let win = app.get_active_window();
    if (!win) win = new TeapotWindow(app);
    win.present();
});

app.run([]);
