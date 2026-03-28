// GJS/GTK4 entry point for canvas2d-fireworks example.

import '@girs/gjs';
import '@girs/gtk-4.0';

import Gtk from 'gi://Gtk?version=4.0';
import Gio from 'gi://Gio?version=2.0';
import { Canvas2DWidget } from '@gjsify/canvas2d';
import { start } from './fireworks.js';

const app = new Gtk.Application({
    application_id: 'gjsify.examples.canvas2d-fireworks',
    flags: Gio.ApplicationFlags.FLAGS_NONE,
});

app.connect('activate', () => {
    const win = new Gtk.ApplicationWindow({ application: app });
    win.set_default_size(800, 600);
    win.set_title('Fireworks — Canvas 2D');

    const canvasWidget = new Canvas2DWidget();
    canvasWidget.installGlobals(); // sets globalThis.requestAnimationFrame

    canvasWidget.onReady((canvas) => {
        print(`Canvas 2D ready: ${canvas.width}x${canvas.height}`);
        start(canvas as any);
    });

    win.set_child(canvasWidget);
    win.present();
});

app.run([]);
