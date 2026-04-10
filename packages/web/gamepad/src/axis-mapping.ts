// Gamepad Web API — axis mapping from libmanette to W3C standard gamepad layout
// Reference: https://w3c.github.io/gamepad/#remapping
//
// IMPORTANT: libmanette 0.2 delivers Linux ABS_* hardware codes in
// Event.get_absolute(), NOT the Manette.Axis enum values from the docs.
// Reference: linux/input-event-codes.h

/**
 * Linux ABS_* input event codes as reported by Manette.Event.get_absolute().
 * These are the actual values libmanette 0.2 passes in absolute-axis-event signals.
 */
export const LinuxAxis = {
    ABS_X:  0,    // Left stick X
    ABS_Y:  1,    // Left stick Y
    ABS_Z:  2,    // Left trigger (analog)
    ABS_RX: 3,    // Right stick X
    ABS_RY: 4,    // Right stick Y
    ABS_RZ: 5,    // Right trigger (analog)
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
 * Maps Linux ABS_* code → W3C axis index.
 * Only stick axes are mapped here.
 * Trigger axes (ABS_Z, ABS_RZ) are mapped to W3C buttons[6]/buttons[7] — see gamepad-manager.
 */
export const MANETTE_TO_W3C_AXIS: ReadonlyMap<number, number> = new Map([
    [LinuxAxis.ABS_X,  W3CAxis.LEFT_STICK_X],
    [LinuxAxis.ABS_Y,  W3CAxis.LEFT_STICK_Y],
    [LinuxAxis.ABS_RX, W3CAxis.RIGHT_STICK_X],
    [LinuxAxis.ABS_RY, W3CAxis.RIGHT_STICK_Y],
]);

/** Threshold above which an analog trigger is considered "pressed". */
export const TRIGGER_PRESS_THRESHOLD = 0.5;

// Keep the old name exported for backward compat
export { LinuxAxis as ManetteAxis };
