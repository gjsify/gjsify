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

/**
 * Starts the gamepad polling loop. On each animation frame:
 * 1. Clears all `.active` highlights
 * 2. Reads the first connected gamepad via navigator.getGamepads()
 * 3. Highlights SVG elements matching pressed buttons
 *
 * @param doc Document (or document-like object with querySelector/querySelectorAll)
 * @param onConnect Called when a gamepad connects (optional, for UI updates)
 * @param onDisconnect Called when a gamepad disconnects (optional)
 */
export function startGamepadLoop(
    doc: Document,
    onConnect?: (gamepad: Gamepad) => void,
    onDisconnect?: () => void,
): () => void {
    let animationId: number | null = null;
    let connected = false;

    // Listen for connect/disconnect events
    const handleConnect = (e: Event) => {
        connected = true;
        const gp = (e as GamepadEvent).gamepad;
        onConnect?.(gp);
    };
    const handleDisconnect = () => {
        connected = false;
        clearHighlights(doc);
        onDisconnect?.();
    };

    window.addEventListener('gamepadconnected', handleConnect);
    window.addEventListener('gamepaddisconnected', handleDisconnect);

    function pollLoop() {
        // Clear all highlights from previous frame
        clearHighlights(doc);

        const gamepads = navigator.getGamepads();
        // Find first connected gamepad
        const gp = gamepads.find((g): g is Gamepad => g !== null && g.connected);

        if (gp) {
            if (!connected) {
                connected = true;
                onConnect?.(gp);
            }
            highlightButtons(doc, gp);
        }

        animationId = requestAnimationFrame(pollLoop);
    }

    // Start the loop
    animationId = requestAnimationFrame(pollLoop);

    // Return cleanup function
    return () => {
        if (animationId !== null) {
            cancelAnimationFrame(animationId);
        }
        window.removeEventListener('gamepadconnected', handleConnect);
        window.removeEventListener('gamepaddisconnected', handleDisconnect);
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
