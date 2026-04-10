// SNES Controller Gamepad Visualizer — browser entry point
// Adapted from https://codepen.io/alvaromontoro/full/bGbpmvR
// Uses standard Gamepad Web API (no library dependencies)

import { startGamepadLoop } from '../snes-controller.js';

const scrim = document.getElementById('scrim')!;
const status = document.getElementById('status-text')!;

startGamepadLoop(
    document,
    (gamepad) => {
        // Hide the "connect your gamepad" overlay
        scrim.classList.remove('open');
        status.textContent = gamepad.id;
    },
    () => {
        // Show the overlay again when disconnected
        scrim.classList.add('open');
        status.textContent = '';
    },
);
