// SNES Controller Gamepad Visualizer — GJS/Adwaita entry point
// Uses Canvas2DWidget for rendering and @gjsify/gamepad for controller input.
// Shares the Canvas2D demo engine with the browser version.

import '@girs/gjs';
import '@girs/gtk-4.0';

import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio?version=2.0';
import { Canvas2DWidget } from '@gjsify/canvas2d';
import { start } from '../snes-gamepad-demo.js';

const app = new Adw.Application({
    application_id: 'gjsify.examples.gamepad-snes',
    flags: Gio.ApplicationFlags.FLAGS_NONE,
});

app.connect('activate', () => {
    const win = new Adw.ApplicationWindow({
        application: app,
        default_width: 700,
        default_height: 500,
        title: 'SNES Gamepad Tester',
    });

    const canvasWidget = new Canvas2DWidget();
    canvasWidget.set_hexpand(true);
    canvasWidget.set_vexpand(true);
    canvasWidget.installGlobals();

    const headerBar = new Adw.HeaderBar();
    const toolbarView = new Adw.ToolbarView();
    toolbarView.add_top_bar(headerBar);
    toolbarView.set_content(canvasWidget);
    win.set_content(toolbarView);

    canvasWidget.onReady((canvas) => {
        canvas.width = canvasWidget.get_allocated_width();
        canvas.height = canvasWidget.get_allocated_height();
        start(canvas as any);
    });

    win.present();
});

app.run([]);
