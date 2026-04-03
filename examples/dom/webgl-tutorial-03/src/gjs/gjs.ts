import '@girs/gjs';
import '@girs/gtk-4.0';

import Gtk from 'gi://Gtk?version=4.0';
import Gio from 'gi://Gio?version=2.0';
import { CanvasWebGLWidget } from '@gjsify/webgl';
import { start } from '../webgl-demo.js';

const app = new Gtk.Application({
    application_id: 'gjsify.examples.webgl-tutorial-03',
    flags: Gio.ApplicationFlags.FLAGS_NONE,
});

app.connect('activate', () => {
    const win = new Gtk.ApplicationWindow({ application: app });
    win.set_default_size(800, 600);
    const glArea = new CanvasWebGLWidget();
    glArea.onReady((canvas) => start(canvas));
    win.set_child(glArea);
    win.present();
});

app.run([]);
