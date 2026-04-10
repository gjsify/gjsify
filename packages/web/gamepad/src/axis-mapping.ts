// Gamepad Web API — axis mapping from libmanette to W3C standard gamepad layout
// Reference: https://w3c.github.io/gamepad/#remapping
//
// NOTE: Unlike buttons (which use Linux BTN_* hardware codes), libmanette 0.2
// axis events use SDL logical indices: 0=leftx, 1=lefty, 2=rightx, 3=righty,
// 4=lefttrigger, 5=righttrigger. The hardware ABS_* code is available via
// event.get_hardware_code() but the main axis index from get_absolute() is
// the SDL-mapped logical index.

/**
 * SDL logical axis indices as reported by Manette.Event.get_absolute().
 * These are the SDL gamepad mapping indices, NOT Linux ABS_* hardware codes.
 */
export const ManetteAxis = {
    LEFT_X: 0,          // SDL leftx
    LEFT_Y: 1,          // SDL lefty
    RIGHT_X: 2,         // SDL rightx
    RIGHT_Y: 3,         // SDL righty
    LEFT_TRIGGER: 4,    // SDL lefttrigger
    RIGHT_TRIGGER: 5,   // SDL righttrigger
} as const;

/**
 * W3C standard gamepad axis indices.
 * https://w3c.github.io/gamepad/#remapping
 */
export const W3CAxis = {
    LEFT_STICK_X: 0,
    LEFT_STICK_Y: 1,
    RIGHT_STICK_X: 2,
    RIGHT_STICK_Y: 3,
} as const;

/** Total number of axes in the W3C standard mapping. */
export const W3C_AXIS_COUNT = 4;

/**
 * Maps SDL logical axis → W3C axis index.
 * Stick axes (0–3) map 1:1. Trigger axes (4–5) are NOT in this map —
 * they are handled separately in gamepad-manager as buttons[6]/buttons[7].
 */
export const MANETTE_TO_W3C_AXIS: ReadonlyMap<number, number> = new Map([
    [ManetteAxis.LEFT_X,  W3CAxis.LEFT_STICK_X],
    [ManetteAxis.LEFT_Y,  W3CAxis.LEFT_STICK_Y],
    [ManetteAxis.RIGHT_X, W3CAxis.RIGHT_STICK_X],
    [ManetteAxis.RIGHT_Y, W3CAxis.RIGHT_STICK_Y],
]);

/** Threshold above which an analog trigger is considered "pressed". */
export const TRIGGER_PRESS_THRESHOLD = 0.5;
