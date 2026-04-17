// GJS/GTK4 entry point for canvas2d-confetti example.
// Pattern follows examples/dom/three-geometry-cube/src/gjs.ts

import '@girs/gjs';
import '@girs/gtk-4.0';

import Gtk from 'gi://Gtk?version=4.0';
import Gio from 'gi://Gio?version=2.0';
import { Canvas2DBridge } from '@gjsify/canvas2d';
import { start } from '../confetti.js';

const app = new Gtk.Application({
    application_id: 'gjsify.examples.canvas2d-confetti',
    flags: Gio.ApplicationFlags.FLAGS_NONE,
});

app.connect('activate', () => {
    const win = new Gtk.ApplicationWindow({ application: app });
    win.set_default_size(800, 600);
    win.set_title('Falling Confetti — Canvas 2D');

    const canvasWidget = new Canvas2DBridge();
    canvasWidget.installGlobals(); // sets globalThis.requestAnimationFrame

    canvasWidget.onReady((canvas) => {
        print(`Canvas 2D ready: ${canvas.width}x${canvas.height}`);
        start(canvas as any);
    });

    win.set_child(canvasWidget);
    win.present();
});

app.run([]);
