// SNES Controller Gamepad Visualizer — GJS/GTK4 entry point
// Uses Canvas2DWidget for rendering and @gjsify/gamepad for controller input.
// Shares gamepad polling logic and Canvas2D renderer with the browser version.

import '@girs/gjs';
import '@girs/gtk-4.0';

import Gtk from 'gi://Gtk?version=4.0';
import Gio from 'gi://Gio?version=2.0';
import { Canvas2DWidget } from '@gjsify/canvas2d';
import { startGamepadLoop } from '../snes-controller.js';
import { renderSnesController } from '../snes-canvas-renderer.js';
import type { GamepadState } from '../snes-controller.js';

const app = new Gtk.Application({
    application_id: 'gjsify.examples.gamepad-snes',
    flags: Gio.ApplicationFlags.FLAGS_NONE,
});

app.connect('activate', () => {
    const win = new Gtk.ApplicationWindow({ application: app });
    win.set_default_size(700, 500);
    win.set_title('SNES Gamepad Tester');

    const canvasWidget = new Canvas2DWidget();
    canvasWidget.installGlobals();

    let currentState: GamepadState | null = null;

    canvasWidget.onReady((canvas, rawCtx) => {
        print(`Canvas ready: ${canvas.width}x${canvas.height}`);
        const ctx = rawCtx as unknown as CanvasRenderingContext2D;

        // Start render loop — redraws every frame
        function render() {
            renderSnesController(ctx, canvas.width, canvas.height, currentState);
            requestAnimationFrame(render);
        }
        render();

        // Start gamepad polling — updates state each frame
        startGamepadLoop({
            onConnect(gamepad) {
                print(`Gamepad connected: ${gamepad.id}`);
            },
            onDisconnect() {
                print('Gamepad disconnected');
                currentState = null;
            },
            onUpdate(state) {
                currentState = state;
            },
        });
    });

    // Re-render on resize
    canvasWidget.onResize(() => {
        if (canvasWidget.canvas) {
            const ctx = canvasWidget.canvas.getContext('2d');
            if (ctx) {
                renderSnesController(
                    ctx as CanvasRenderingContext2D,
                    canvasWidget.canvas.width,
                    canvasWidget.canvas.height,
                    currentState,
                );
                canvasWidget.queue_draw();
            }
        }
    });

    win.set_child(canvasWidget);
    win.present();
});

app.run([]);
