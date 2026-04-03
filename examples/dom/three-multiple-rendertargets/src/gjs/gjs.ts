// GJS/GTK4 entry point for three-multiple-rendertargets example.
// Ported from refs/three/examples/webgl_multiple_rendertargets.html
// Original: MIT license, three.js contributors

import '@girs/gjs';
import '@girs/gtk-4.0';

import Gtk from 'gi://Gtk?version=4.0';
import Gio from 'gi://Gio?version=2.0';
import { CanvasWebGLWidget } from '@gjsify/webgl';
import { start } from '../three-demo.js';

const app = new Gtk.Application({
    application_id: 'gjsify.examples.three-multiple-rendertargets',
    flags: Gio.ApplicationFlags.FLAGS_NONE,
});

app.connect('activate', () => {
    const win = new Gtk.ApplicationWindow({ application: app });
    win.set_default_size(900, 600);
    win.set_title('three.js — Multiple Render Targets (G-Buffer)');

    Object.defineProperty(globalThis, 'innerWidth', {
        get: () => win.get_width(),
        configurable: true,
    });
    Object.defineProperty(globalThis, 'innerHeight', {
        get: () => win.get_height(),
        configurable: true,
    });

    const glArea = new CanvasWebGLWidget();
    glArea.installGlobals();

    glArea.onReady((canvas) => {
        const ctx = glArea.get_context()!;
        print(`Context version: OpenGL${ctx.get_use_es() ? ' ES' : ''} ${ctx.get_version().join('.')}`);
        start(canvas as any);
    });

    win.set_child(glArea);
    win.present();
});

app.run([]);
