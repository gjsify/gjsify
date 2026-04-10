// Gamepad Web API — axis mapping from libmanette to W3C standard gamepad layout
// Reference: https://w3c.github.io/gamepad/#remapping
// Reference: https://gnome.pages.gitlab.gnome.org/libmanette/doc/main/enum.Axis.html

/**
 * Manette axis indices as reported by Manette.Event.get_absolute().
 * Values from Manette.Axis enum (libmanette 0.2).
 */
export const ManetteAxis = {
    LEFT_X: 0,
    LEFT_Y: 1,
    RIGHT_X: 2,
    RIGHT_Y: 3,
    LEFT_TRIGGER: 4,
    RIGHT_TRIGGER: 5,
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
 * Maps Manette stick axis → W3C axis index.
 * Only stick axes (0–3) are mapped here.
 * Trigger axes (4–5) are mapped to W3C buttons[6]/buttons[7] — see gamepad-manager.
 */
export const MANETTE_TO_W3C_AXIS: ReadonlyMap<number, number> = new Map([
    [ManetteAxis.LEFT_X,  W3CAxis.LEFT_STICK_X],
    [ManetteAxis.LEFT_Y,  W3CAxis.LEFT_STICK_Y],
    [ManetteAxis.RIGHT_X, W3CAxis.RIGHT_STICK_X],
    [ManetteAxis.RIGHT_Y, W3CAxis.RIGHT_STICK_Y],
]);

/** Threshold above which an analog trigger is considered "pressed". */
export const TRIGGER_PRESS_THRESHOLD = 0.5;
