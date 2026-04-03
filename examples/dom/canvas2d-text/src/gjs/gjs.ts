// GJS/GTK4 entry point for canvas2d-text baseline demo.

import '@girs/gjs';
import '@girs/gtk-4.0';

import Gtk from 'gi://Gtk?version=4.0';
import Gio from 'gi://Gio?version=2.0';
import { Canvas2DWidget } from '@gjsify/canvas2d';
import { renderDemo, DEFAULT_WIDTH, DEFAULT_HEIGHT } from '../canvas2d-text-demo.js';

const app = new Gtk.Application({
    application_id: 'gjsify.examples.canvas2d-text',
    flags: Gio.ApplicationFlags.FLAGS_NONE,
});

app.connect('activate', () => {
    const win = new Gtk.ApplicationWindow({ application: app });
    win.set_default_size(DEFAULT_WIDTH, DEFAULT_HEIGHT);
    win.set_title('Canvas 2D — textBaseline Visual Demo');

    const canvasWidget = new Canvas2DWidget();
    canvasWidget.installGlobals();

    canvasWidget.onReady((canvas) => {
        renderDemo(canvas as any);
    });

    // Re-render whenever the window is resized
    canvasWidget.onResize((_w, _h) => {
        if (canvasWidget.canvas) {
            renderDemo(canvasWidget.canvas);
            canvasWidget.queue_draw();
        }
    });

    win.set_child(canvasWidget);
    win.present();
});

app.run([]);
