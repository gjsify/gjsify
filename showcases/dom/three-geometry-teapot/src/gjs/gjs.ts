// GJS/Adwaita entry point for three-geometry-teapot example.
// Ported from refs/three/examples/webgl_geometry_teapot.html

import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio?version=2.0';

import { installDevtools } from '@gjsify/devtools';
import { TeapotWindow } from './teapot-window.js';

const app = new Adw.Application({
    application_id: 'gjsify.examples.three-geometry-teapot',
    flags: Gio.ApplicationFlags.FLAGS_NONE,
});

app.connect('startup', () => installDevtools(app));

app.connect('activate', () => {
    let win = app.get_active_window();
    if (!win) win = new TeapotWindow(app);
    win.present();
});

// runAsync (NOT the sync run()): defers the blocking main loop to a macrotask so
// the synchronous view load doesn't hang on its spinner, and it is the required
// lifecycle on the `--app node` reverse bridge (a sync run() deadlocks there) as
// well as the GJS-recommended one (Gio.Application.runAsync). Runs on all runtimes.
await app.runAsync([]);
