// GJS/Adwaita entry point for three-postprocessing-pixel example.
// Ported from refs/three/examples/webgl_postprocessing_pixel.html
// Original: MIT license, three.js authors (https://threejs.org)

import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio?version=2.0';
import { PixelWindow } from './pixel-window.js';

const app = new Adw.Application({
    application_id: 'gjsify.examples.three-postprocessing-pixel',
    flags: Gio.ApplicationFlags.FLAGS_NONE,
});

app.connect('activate', () => {
    let win = app.get_active_window();
    if (!win) win = new PixelWindow(app);
    win.present();
});

app.run([]);
