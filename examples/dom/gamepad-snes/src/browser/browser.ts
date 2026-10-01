// SNES Controller Gamepad Visualizer — browser entry point
// Uses the shared Canvas2D demo engine (same code as GJS).

import { debugText, rumble, start } from '../snes-gamepad-demo.js';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
resize();
window.addEventListener('resize', resize, { passive: true });

start(canvas);

// The same debug panel as the GJS entry; the browser does not name its backend.
const debug = document.getElementById('debug') as HTMLPreElement;
setInterval(() => (debug.textContent = debugText("the browser's own")), 100);
const rumbleButton = document.getElementById('rumble') as HTMLButtonElement;
rumbleButton.addEventListener('click', () => {
    void rumble().then((result) => (rumbleButton.title = result));
});
