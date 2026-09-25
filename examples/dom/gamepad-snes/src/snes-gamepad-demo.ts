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
        get state() {
            return currentState;
        },
    };
}

/**
 * The first connected gamepad, or null. The debug panel and the rumble button read the
 * same one the visualizer draws.
 */
export type GetGamepads = () => (Gamepad | null)[];

const fromNavigator: GetGamepads = () => navigator.getGamepads();

export function firstGamepad(getGamepads: GetGamepads = fromNavigator): Gamepad | null {
    return getGamepads().find((g: Gamepad | null): g is Gamepad => g !== null && g.connected) ?? null;
}

/**
 * The debug panel's text: what the W3C surface reports for the first gamepad, raw.
 * `backend` is supplied by the host (on GJS and Node, `describeGamepadBackend()` from
 * `@gjsify/gamepad`; a browser does not say).
 */
export function debugText(backend: string, getGamepads: GetGamepads = fromNavigator): string {
    const gp = firstGamepad(getGamepads);
    const lines = [`backend: ${backend}`];
    if (!gp) return [...lines, 'no gamepad connected — press a button to wake it'].join('\n');
    const buttons = gp.buttons.map((b, i) => `${i}:${b.value.toFixed(2)}${b.pressed ? '*' : ''}`);
    lines.push(
        `id: ${gp.id}`,
        `index: ${gp.index}   mapping: ${gp.mapping || '(none)'}   timestamp: ${gp.timestamp.toFixed(0)}`,
        `buttons (${gp.buttons.length}): ${buttons.slice(0, 9).join(' ')}`,
        `             ${buttons.slice(9).join(' ')}`,
        `axes (${gp.axes.length}): ${gp.axes.map((a) => a.toFixed(3)).join('  ')}`,
        `vibrationActuator: ${gp.vibrationActuator ? 'present' : 'none'}`,
    );
    return lines.join('\n');
}

/** Half a second of full dual-rumble on the first gamepad; resolves to what happened. */
export async function rumble(getGamepads: GetGamepads = fromNavigator): Promise<string> {
    const actuator = firstGamepad(getGamepads)?.vibrationActuator;
    if (!actuator) return 'no gamepad with a vibration actuator';
    try {
        return `playEffect → ${await actuator.playEffect('dual-rumble', { duration: 500, strongMagnitude: 1, weakMagnitude: 1 })}`;
    } catch (error) {
        return `playEffect rejected: ${String(error)}`;
    }
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
