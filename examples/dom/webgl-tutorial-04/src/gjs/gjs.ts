import '@girs/gjs';
import '@girs/gtk-4.0';

import Gtk from 'gi://Gtk?version=4.0';
import Gio from 'gi://Gio?version=2.0';
import { WebGLBridge } from '@gjsify/webgl';
import { start } from '../webgl-demo.js';

const app = new Gtk.Application({
    application_id: 'gjsify.examples.webgl-tutorial-04',
    flags: Gio.ApplicationFlags.FLAGS_NONE,
});

app.connect('activate', () => {
    const win = new Gtk.ApplicationWindow({ application: app });
    win.set_default_size(800, 600);
    const glArea = new WebGLBridge();
    glArea.installGlobals(); // sets globalThis.requestAnimationFrame
    glArea.onReady((canvas) => {
        const ctx = glArea.get_context()!;
        print(`Context version: OpenGL${ctx.get_use_es() ? ' ES' : ''} ${ctx.get_version().join('.')}`);
        start(canvas);
    });
    win.set_child(glArea);
    win.present();
});

app.run([]);
