// https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/Tutorial/Getting_started_with_WebGL
// https://github.com/mdn/dom-examples/tree/main/webgl-examples/tutorial/sample1

import '@girs/gjs';
import '@girs/gtk-4.0';

import Gtk from 'gi://Gtk?version=4.0';
import Gio from 'gi://Gio?version=2.0';
import { CanvasWebGLWidget } from '@gjsify/webgl';

const app = new Gtk.Application({
    application_id: 'gjsify.examples.webgl-tutorial-01',
    flags: Gio.ApplicationFlags.FLAGS_NONE,
});

app.connect('activate', () => {
    const win = new Gtk.ApplicationWindow({ application: app });
    win.set_default_size(800, 600);
    const glArea = new CanvasWebGLWidget();
    glArea.onReady((_canvas, gl) => {
        const ctx = glArea.get_context()!;
        print(`Context version: OpenGL${ctx.get_use_es() ? ' ES' : ''} ${ctx.get_version().join('.')}`);
        gl.clearColor(0.0, 0.0, 0.0, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT);
    });
    win.set_child(glArea);
    win.present();
});

app.run([]);
