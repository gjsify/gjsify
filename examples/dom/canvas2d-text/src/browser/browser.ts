// Browser entry point for canvas2d-text baseline demo.

import { renderDemo } from '../canvas2d-text-demo.js';

const canvas = document.createElement('canvas');
document.body.appendChild(canvas);

function draw() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    renderDemo(canvas);
}

draw();
window.addEventListener('resize', draw, { passive: true });
