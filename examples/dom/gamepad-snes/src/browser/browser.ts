// SNES Controller Gamepad Visualizer — browser entry point
// Adapted from https://codepen.io/alvaromontoro/full/bGbpmvR
// Uses standard Gamepad Web API (no library dependencies)

import { startGamepadLoop, BUTTON_MAP } from '../snes-controller.js';
import type { GamepadState } from '../snes-controller.js';

const scrim = document.getElementById('scrim')!;
const infoPanel = document.getElementById('info-panel')!;
const elName = document.getElementById('info-name')!;
const elIndex = document.getElementById('info-index')!;
const elMapping = document.getElementById('info-mapping')!;
const elButtons = document.getElementById('info-buttons-total')!;
const elAxes = document.getElementById('info-axes-total')!;
const elPressed = document.getElementById('info-pressed')!;
const elAxesLive = document.getElementById('info-axes-live')!;
const elTimestamp = document.getElementById('info-timestamp')!;

function updateSvg(state: GamepadState) {
    // Clear all highlights from previous frame
    document.querySelectorAll('.active').forEach(el => el.classList.remove('active'));

    // Highlight active buttons on the SVG
    for (const btnId of state.activeButtons) {
        const el = document.getElementById(btnId);
        if (el) el.classList.add('active');
    }
}

function updateInfoPanel(state: GamepadState) {
    elName.textContent = state.id;
    elIndex.textContent = String(state.index);
    elMapping.textContent = state.mapping;
    elButtons.textContent = String(state.buttons.length);
    elAxes.textContent = String(state.axes.length);
    elPressed.textContent = state.pressedButtons.length > 0
        ? state.pressedButtons.join(', ')
        : '--';
    elAxesLive.textContent = state.axes
        .map((v, i) => `${i}: ${v >= 0 ? '+' : ''}${v.toFixed(2)}`)
        .join('  ');
    elTimestamp.textContent = state.timestamp.toFixed(1);
}

startGamepadLoop({
    onConnect() {
        scrim.classList.remove('open');
        infoPanel.classList.add('visible');
    },
    onDisconnect() {
        scrim.classList.add('open');
        infoPanel.classList.remove('visible');
        document.querySelectorAll('.active').forEach(el => el.classList.remove('active'));
    },
    onUpdate(state) {
        updateSvg(state);
        updateInfoPanel(state);
    },
});
