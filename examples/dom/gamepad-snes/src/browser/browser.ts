// SNES Controller Gamepad Visualizer — browser entry point
// Uses Canvas2D rendering (shared with GJS version).

import { startGamepadLoop } from '../snes-controller.js';
import { renderSnesController } from '../snes-canvas-renderer.js';
import type { GamepadState } from '../snes-controller.js';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

let currentState: GamepadState | null = null;

// Resize canvas to fill window
function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
resize();
window.addEventListener('resize', resize, { passive: true });

// Unified render + gamepad poll loop
function loop() {
    renderSnesController(ctx, canvas.width, canvas.height, currentState);
    requestAnimationFrame(loop);
}
loop();

// Gamepad polling (separate rAF is fine in browser — browser supports multiple)
startGamepadLoop({
    onConnect(gamepad) {
        console.log(`Gamepad connected: ${gamepad.id}`);
    },
    onDisconnect() {
        console.log('Gamepad disconnected');
        currentState = null;
    },
    onUpdate(state) {
        currentState = state;
    },
});
