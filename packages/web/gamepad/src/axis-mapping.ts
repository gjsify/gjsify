// Gamepad Web API — axis mapping from libmanette to W3C standard gamepad layout
// Reference: https://w3c.github.io/gamepad/#remapping
//
// NOTE: Unlike buttons (which use Linux BTN_* hardware codes), libmanette 0.2
// axis events use SDL logical indices: 0=leftx, 1=lefty, 2=rightx, 3=righty,
// 4=lefttrigger, 5=righttrigger. The hardware ABS_* code is available via
// event.get_hardware_code() but the main axis index from get_absolute() is
// the SDL-mapped logical index.

/**
 * The axis codes `Manette.Event.get_absolute()` reports: Linux `ABS_*` codes. A mapped
 * device is translated by libmanette's own table (`manette-mapping.c`: `leftx`→ABS_X,
 * `lefty`→ABS_Y, `rightx`→ABS_RX, `righty`→ABS_RY; the triggers become the BUTTONS
 * BTN_TL2/BTN_TR2), an unmapped one passes its kernel codes through. Measured with a
 * uinput pad under gi://Manette: the right stick arrives as 3 and 4.
 *
 * NOT SDL mapping indices. This table once said RIGHT_X 2 / RIGHT_Y 3 / LEFT_TRIGGER 4,
 * which put the right stick's X on W3C axis 3 and its Y on the left trigger for every
 * controller libmanette maps; an 8BitDo N30 Pro 2 compared against the SDL3 shim showed it.
 */
export const ManetteAxis = {
    LEFT_X: 0, // ABS_X
    LEFT_Y: 1, // ABS_Y
    RIGHT_X: 3, // ABS_RX
    RIGHT_Y: 4, // ABS_RY
    // Analog triggers only reach here from an UNMAPPED device, as the evdev (xpad)
    // convention spells them; a mapped one reports BTN_TL2/BTN_TR2 buttons instead.
    LEFT_TRIGGER: 2, // ABS_Z
    RIGHT_TRIGGER: 5, // ABS_RZ
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
 * Maps the libmanette axis code → W3C axis index.
 * Only the four stick axes are in this map; the trigger codes are NOT —
 * they are handled separately in gamepad-manager as buttons[6]/buttons[7].
 */
export const MANETTE_TO_W3C_AXIS: ReadonlyMap<number, number> = new Map([
    [ManetteAxis.LEFT_X, W3CAxis.LEFT_STICK_X],
    [ManetteAxis.LEFT_Y, W3CAxis.LEFT_STICK_Y],
    [ManetteAxis.RIGHT_X, W3CAxis.RIGHT_STICK_X],
    [ManetteAxis.RIGHT_Y, W3CAxis.RIGHT_STICK_Y],
]);

/** Threshold above which an analog trigger is considered "pressed". */
export const TRIGGER_PRESS_THRESHOLD = 0.5;
