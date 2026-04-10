// SNES Controller Gamepad Visualizer — shared logic
// Uses the standard Gamepad Web API (navigator.getGamepads).
// Based on Alvaro Montoro's CodePen: https://codepen.io/alvaromontoro/full/bGbpmvR
//
// This module is platform-agnostic: works in the browser and on GJS
// (with @gjsify/gamepad providing navigator.getGamepads via libmanette).

/**
 * W3C Standard Gamepad button index → SVG element ID.
 * https://w3c.github.io/gamepad/#remapping
 *
 * SNES layout:
 *   B = Face1 (0), A = Face2 (1), Y = Face3 (2), X = Face4 (3)
 *   L = LB (4), R = RB (5)
 *   Select = 8, Start = 9
 *   D-pad: Up=12, Down=13, Left=14, Right=15
 */
const BUTTON_MAP: Record<number, string> = {
    0:  'button-b',       // Face1 → B (SNES bottom)
    1:  'button-a',       // Face2 → A (SNES right)
    2:  'button-y',       // Face3 → Y (SNES left)
    3:  'button-x',       // Face4 → X (SNES top)
    4:  'button-l',       // Left bumper → L
    5:  'button-r',       // Right bumper → R
    8:  'button-select',  // Select
    9:  'button-start',   // Start
    12: 'button-up',      // D-pad up
    13: 'button-down',    // D-pad down
    14: 'button-left',    // D-pad left
    15: 'button-right',   // D-pad right
};

/** CSS class applied to active SVG elements. */
const ACTIVE_CLASS = 'active';

/** W3C standard button names for display. */
const W3C_BUTTON_NAMES: Record<number, string> = {
    0: 'B (Face1)', 1: 'A (Face2)', 2: 'Y (Face3)', 3: 'X (Face4)',
    4: 'L', 5: 'R', 6: 'LT', 7: 'RT',
    8: 'Select', 9: 'Start', 10: 'L3', 11: 'R3',
    12: 'D-Up', 13: 'D-Down', 14: 'D-Left', 15: 'D-Right', 16: 'Home',
};

/** Snapshot of live gamepad state passed to the onUpdate callback. */
export interface GamepadState {
    id: string;
    index: number;
    mapping: string;
    axes: readonly number[];
    buttons: readonly { pressed: boolean; value: number }[];
    timestamp: number;
    /** Names of currently pressed buttons. */
    pressedButtons: string[];
}

export interface GamepadLoopCallbacks {
    onConnect?: (gamepad: Gamepad) => void;
    onDisconnect?: () => void;
    /** Called every frame with live gamepad state (only while connected). */
    onUpdate?: (state: GamepadState) => void;
}

/**
 * Starts the gamepad polling loop. On each animation frame:
 * 1. Clears all `.active` highlights
 * 2. Reads the first connected gamepad via navigator.getGamepads()
 * 3. Highlights SVG elements matching pressed buttons
 * 4. Calls onUpdate with live state snapshot
 *
 * @returns Cleanup function to stop the loop.
 */
export function startGamepadLoop(
    doc: Document,
    callbacks: GamepadLoopCallbacks,
): () => void {
    let animationId: number | null = null;
    let connected = false;

    const handleConnect = (e: Event) => {
        connected = true;
        const gp = (e as GamepadEvent).gamepad;
        callbacks.onConnect?.(gp);
    };
    const handleDisconnect = () => {
        connected = false;
        clearHighlights(doc);
        callbacks.onDisconnect?.();
    };

    window.addEventListener('gamepadconnected', handleConnect);
    window.addEventListener('gamepaddisconnected', handleDisconnect);

    function pollLoop() {
        clearHighlights(doc);

        const gamepads = navigator.getGamepads();
        const gp = gamepads.find((g): g is Gamepad => g !== null && g.connected);

        if (gp) {
            if (!connected) {
                connected = true;
                callbacks.onConnect?.(gp);
            }
            highlightButtons(doc, gp);
            callbacks.onUpdate?.(buildState(gp));
        }

        animationId = requestAnimationFrame(pollLoop);
    }

    animationId = requestAnimationFrame(pollLoop);

    return () => {
        if (animationId !== null) {
            cancelAnimationFrame(animationId);
        }
        window.removeEventListener('gamepadconnected', handleConnect);
        window.removeEventListener('gamepaddisconnected', handleDisconnect);
    };
}

function buildState(gp: Gamepad): GamepadState {
    const pressedButtons: string[] = [];
    for (let i = 0; i < gp.buttons.length; i++) {
        if (gp.buttons[i].pressed) {
            pressedButtons.push(W3C_BUTTON_NAMES[i] ?? `Button ${i}`);
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
    };
}

function clearHighlights(doc: Document): void {
    doc.querySelectorAll(`.${ACTIVE_CLASS}`).forEach(el => {
        el.classList.remove(ACTIVE_CLASS);
    });
}

function highlightButtons(doc: Document, gamepad: Gamepad): void {
    for (const [buttonIdx, elementId] of Object.entries(BUTTON_MAP)) {
        const btn = gamepad.buttons[Number(buttonIdx)];
        if (btn && btn.pressed) {
            const el = doc.getElementById(elementId);
            if (el) {
                el.classList.add(ACTIVE_CLASS);
            }
        }
    }
}
