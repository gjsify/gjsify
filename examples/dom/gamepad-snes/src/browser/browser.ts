// SNES Controller Gamepad Visualizer — browser entry point
// Uses the shared Canvas2D demo engine (same code as GJS).

import { start } from '../snes-gamepad-demo.js';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
resize();
window.addEventListener('resize', resize, { passive: true });

start(canvas);
