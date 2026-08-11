// GJS/Adwaita entry point for three-loader-ldraw example.
// Ported from refs/three/examples/webgl_loader_ldraw.html
// Original: MIT license, three.js authors (https://threejs.org)
// This software uses the LDraw Parts Library (http://www.ldraw.org), CC BY 2.0.

import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio?version=2.0';

import { installDevtools } from '@gjsify/devtools';
import { LDrawWindow } from './ldraw-window.js';

const app = new Adw.Application({
    application_id: 'gjsify.examples.three-loader-ldraw',
    flags: Gio.ApplicationFlags.FLAGS_NONE,
});

// Opt-in devtools control plane — a no-op unless GJSIFY_DEVTOOLS is set, so
// production runs are unaffected. It is how the rendered model gets verified
// without a human: the model arrives through an async loader, so "the window
// opened" proves nothing about what is in the GLArea.
app.connect('startup', () => installDevtools(app));

app.connect('activate', () => {
    let win = app.get_active_window();
    if (!win) win = new LDrawWindow(app);
    win.present();
});

// runAsync (NOT the sync run()): the GJS-recommended lifecycle, and the required
// one on the `--app node` reverse bridge where a sync run() deadlocks.
await app.runAsync([]);
