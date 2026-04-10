// SNES Controller Gamepad Visualizer — GJS/GTK4 entry point
// Uses Canvas2DWidget for rendering and @gjsify/gamepad for controller input.
// Shares gamepad polling logic and Canvas2D renderer with the browser version.

import '@girs/gjs';
import '@girs/gtk-4.0';

import Gtk from 'gi://Gtk?version=4.0';
import Gio from 'gi://Gio?version=2.0';
import { Canvas2DWidget } from '@gjsify/canvas2d';
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
    let connected = false;

    // Listen for gamepad connect/disconnect on globalThis
    globalThis.addEventListener?.('gamepadconnected', (e: Event) => {
        connected = true;
        const gp = (e as GamepadEvent).gamepad;
        print(`Gamepad connected: ${gp.id}`);
    });
    globalThis.addEventListener?.('gamepaddisconnected', () => {
        connected = false;
        currentState = null;
        print('Gamepad disconnected');
    });

    canvasWidget.onReady((canvas, rawCtx) => {
        print(`Canvas ready: ${canvas.width}x${canvas.height}`);
        const ctx = rawCtx as unknown as CanvasRenderingContext2D;

        // Single unified loop: poll gamepad + render in one rAF callback
        function loop() {
            // Poll gamepad state
            const gamepads = navigator.getGamepads();
            const gp = gamepads.find((g: Gamepad | null): g is Gamepad => g !== null && g.connected);

            if (gp) {
                if (!connected) {
                    connected = true;
                    print(`Gamepad connected: ${gp.id}`);
                }
                currentState = buildState(gp);
            }

            // Render
            renderSnesController(ctx, canvas.width, canvas.height, currentState);

            requestAnimationFrame(loop);
        }
        loop();
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

// Inline state builder (avoids importing startGamepadLoop which would start a second rAF)
import { BUTTON_MAP, W3C_BUTTON_NAMES } from '../snes-controller.js';

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
