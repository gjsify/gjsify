// SNES Controller Gamepad Visualizer — GJS/Adwaita entry point
// Uses Canvas2DWidget for rendering and @gjsify/gamepad for controller input.
// Shares Canvas2D renderer and gamepad state types with the browser version.

import '@girs/gjs';
import '@girs/gtk-4.0';

import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio?version=2.0';
import { Canvas2DWidget } from '@gjsify/canvas2d';
import { renderSnesController } from '../snes-canvas-renderer.js';
import { BUTTON_MAP, W3C_BUTTON_NAMES } from '../snes-controller.js';
import type { GamepadState } from '../snes-controller.js';

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

    // Adwaita toolbar view with header bar
    const headerBar = new Adw.HeaderBar();
    const toolbarView = new Adw.ToolbarView();
    toolbarView.add_top_bar(headerBar);
    toolbarView.set_content(canvasWidget);

    win.set_content(toolbarView);

    let currentState: GamepadState | null = null;
    let connected = false;

    canvasWidget.onReady((canvas, rawCtx) => {
        print(`Canvas ready: ${canvas.width}x${canvas.height}`);
        const ctx = rawCtx as unknown as CanvasRenderingContext2D;

        // Single unified loop: poll gamepad + render
        function loop() {
            const gamepads = navigator.getGamepads();
            const gp = gamepads.find((g: Gamepad | null): g is Gamepad => g !== null && g.connected);

            if (gp) {
                if (!connected) {
                    connected = true;
                    print(`Gamepad connected: ${gp.id}`);
                }
                currentState = buildState(gp);
            } else if (connected) {
                connected = false;
                currentState = null;
                print('Gamepad disconnected');
            }

            renderSnesController(ctx, canvas.width, canvas.height, currentState);
            requestAnimationFrame(loop);
        }
        loop();
    });

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

    win.present();
});

app.run([]);

function buildState(gp: Gamepad): GamepadState {
    const pressedButtons: string[] = [];
    const activeButtons = new Set<string>();

    for (let i = 0; i < gp.buttons.length; i++) {
        if (gp.buttons[i].pressed) {
            pressedButtons.push(W3C_BUTTON_NAMES[i] ?? `Button ${i}`);
            const snesId = BUTTON_MAP[i];
            if (snesId) activeButtons.add(snesId);
        }
    }

    return {
        id: gp.id,
        index: gp.index,
        mapping: gp.mapping || '(none)',
        axes: gp.axes,
        buttons: gp.buttons,
        timestamp: gp.timestamp,
        pressedButtons,
        activeButtons,
    };
}
