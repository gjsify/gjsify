// GJS/Adwaita entry point for three-loader-ldraw example.
// Ported from refs/three/examples/webgl_loader_ldraw.html
// Original: MIT license, three.js authors (https://threejs.org)
// This software uses the LDraw Parts Library (http://www.ldraw.org), CC BY 2.0.

import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio?version=2.0';
import { LDrawWindow } from './ldraw-window.js';

const app = new Adw.Application({
    application_id: 'gjsify.examples.three-loader-ldraw',
    flags: Gio.ApplicationFlags.FLAGS_NONE,
});

app.connect('activate', () => {
    let win = app.get_active_window();
    if (!win) win = new LDrawWindow(app);
    win.present();
});

app.run([]);
