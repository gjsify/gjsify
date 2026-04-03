// Browser entry point for canvas2d-confetti example.

import { start } from '../confetti.js';

const canvas = document.getElementsByTagName('canvas')[0];
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

window.addEventListener('resize', () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}, { passive: true });

start(canvas);
