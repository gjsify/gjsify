// SNES Controller Gamepad Visualizer — GJS/Adwaita entry point
// Uses Canvas2DBridge for rendering and @gjsify/gamepad for controller input.
// Shares the Canvas2D demo engine with the browser version.

import '@girs/gjs';
import '@girs/gtk-4.0';

import { runAdwApp } from '@gjsify/adw-app';
import { Canvas2DBridge } from '@gjsify/canvas2d';
import { start } from '../snes-gamepad-demo.js';

runAdwApp({
    applicationId: 'gjsify.examples.gamepad-snes',
    title: 'SNES Gamepad Tester',
    defaultWidth: 700,
    defaultHeight: 500,
    build: () => {
        const canvasWidget = new Canvas2DBridge();
        canvasWidget.set_hexpand(true);
        canvasWidget.set_vexpand(true);
        canvasWidget.installGlobals();

        canvasWidget.onReady((canvas) => {
            canvas.width = canvasWidget.get_allocated_width();
            canvas.height = canvasWidget.get_allocated_height();
            start(canvas as any);
        });

        return canvasWidget;
    },
});
