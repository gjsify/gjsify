// SNES Controller Gamepad Visualizer — GJS/Adwaita entry point
// Uses Canvas2DBridge for rendering and @gjsify/gamepad for controller input.
// Shares the Canvas2D demo engine with the browser version.

import '@girs/gjs';
import '@girs/gtk-4.0';

import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import { Canvas2DBridge } from '@gjsify/canvas2d';
import { describeGamepadBackend } from '@gjsify/gamepad';
import '@gjsify/gamepad/register';
import { createDebugPanel } from '../debug-panel.js';
import { start } from '../snes-gamepad-demo.js';

const app = new Adw.Application({
    application_id: 'gjsify.examples.gamepad-snes',
    flags: Gio.ApplicationFlags.FLAGS_NONE,
});

app.connect('activate', () => {
    const win = new Adw.ApplicationWindow({
        application: app,
        default_width: 700,
        default_height: 640,
        title: 'SNES Gamepad Tester',
    });

    const canvasWidget = new Canvas2DBridge();
    canvasWidget.set_hexpand(true);
    canvasWidget.set_vexpand(true);
    canvasWidget.installGlobals();

    const { label: debug, rumbleButton } = createDebugPanel(describeGamepadBackend());

    const content = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
    content.append(canvasWidget);
    content.append(debug);

    const headerBar = new Adw.HeaderBar();
    headerBar.pack_end(rumbleButton);
    const toolbarView = new Adw.ToolbarView();
    toolbarView.add_top_bar(headerBar);
    toolbarView.set_content(content);
    win.set_content(toolbarView);

    canvasWidget.onReady((canvas) => {
        canvas.width = canvasWidget.get_allocated_width();
        canvas.height = canvasWidget.get_allocated_height();
        // oxlint-disable-next-line typescript/no-explicit-any -- WebGLBridge/Canvas2DBridge canvas has no TypeScript type compatible with HTMLCanvasElement
        start(canvas as any);
    });

    win.present();
});

// runAsync, not run(): the sync loop blocks promise continuations, and the gamepad
// backend is probed and started asynchronously (a sync run() never connects a pad).
await app.runAsync([]);
