// SNES Controller Gamepad Visualizer — platform-agnostic demo engine
// Takes a standard HTMLCanvasElement and runs the complete gamepad polling +
// SNES controller rendering loop. Works identically in browser and GJS.
//
// Based on Alvaro Montoro's CodePen: https://codepen.io/alvaromontoro/full/bGbpmvR
// Uses standard Gamepad Web API (navigator.getGamepads + requestAnimationFrame).

import { renderSnesController } from './snes-canvas-renderer.js';
import { BUTTON_MAP, W3C_BUTTON_NAMES } from './snes-controller.js';
import type { GamepadState } from './snes-controller.js';

export interface SnesDemo {
    /** Current gamepad state (null when no gamepad connected). */
    readonly state: GamepadState | null;
}

/**
 * Start the SNES gamepad visualizer on the given canvas.
 * Polls `navigator.getGamepads()` and renders every frame via rAF.
 * Works in both browser and GJS (Canvas2DBridge).
 */
export function start(canvas: HTMLCanvasElement): SnesDemo {
    const ctx = canvas.getContext('2d')!;
    let currentState: GamepadState | null = null;
    let connected = false;

    function loop() {
        // Poll gamepad
        const gamepads = navigator.getGamepads();
        const gp = gamepads.find((g: Gamepad | null): g is Gamepad => g !== null && g.connected);

        if (gp) {
            if (!connected) {
                connected = true;
            }
            currentState = buildState(gp);
        } else if (connected) {
            connected = false;
            currentState = null;
        }

        // Render
        renderSnesController(ctx, canvas.width, canvas.height, currentState);

        requestAnimationFrame(loop);
    }

    requestAnimationFrame(loop);

    return {
        get state() { return currentState; },
    };
}

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
