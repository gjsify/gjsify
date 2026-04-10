// Gamepad Web API — button mapping from libmanette to W3C standard gamepad layout
// Reference: https://w3c.github.io/gamepad/#remapping
// Reference: https://gnome.pages.gitlab.gnome.org/libmanette/doc/main/enum.Button.html

/**
 * Manette button indices as reported by Manette.Event.get_button().
 * Values from Manette.Button enum (libmanette 0.2).
 */
export const ManetteButton = {
    DPAD_UP: 0,
    DPAD_DOWN: 1,
    DPAD_LEFT: 2,
    DPAD_RIGHT: 3,
    NORTH: 4,       // Y (Xbox), X (Nintendo), Triangle (PlayStation)
    SOUTH: 5,       // A (Xbox), B (Nintendo), Cross (PlayStation)
    WEST: 6,        // X (Xbox), Y (Nintendo), Square (PlayStation)
    EAST: 7,        // B (Xbox), A (Nintendo), Circle (PlayStation)
    SELECT: 8,
    START: 9,
    MODE: 10,        // Home / Guide / Steam
    LEFT_SHOULDER: 11,
    RIGHT_SHOULDER: 12,
    LEFT_STICK: 13,
    RIGHT_STICK: 14,
    LEFT_PADDLE1: 15,
    LEFT_PADDLE2: 16,
    RIGHT_PADDLE1: 17,
    RIGHT_PADDLE2: 18,
    MISC1: 19,
    TOUCHPAD: 25,
} as const;

/**
 * W3C standard gamepad button indices.
 * https://w3c.github.io/gamepad/#remapping
 */
export const W3CButton = {
    FACE_1: 0,          // A (Xbox), B (Nintendo), Cross (PlayStation)
    FACE_2: 1,          // B (Xbox), A (Nintendo), Circle (PlayStation)
    FACE_3: 2,          // X (Xbox), Y (Nintendo), Square (PlayStation)
    FACE_4: 3,          // Y (Xbox), X (Nintendo), Triangle (PlayStation)
    LEFT_BUMPER: 4,
    RIGHT_BUMPER: 5,
    LEFT_TRIGGER: 6,    // Analog trigger — populated from axis, not button
    RIGHT_TRIGGER: 7,   // Analog trigger — populated from axis, not button
    SELECT: 8,
    START: 9,
    LEFT_STICK: 10,
    RIGHT_STICK: 11,
    DPAD_UP: 12,
    DPAD_DOWN: 13,
    DPAD_LEFT: 14,
    DPAD_RIGHT: 15,
    HOME: 16,
} as const;

/** Total number of buttons in the W3C standard mapping. */
export const W3C_BUTTON_COUNT = 17;

/**
 * Maps Manette button index → W3C standard button index.
 * Triggers (W3C 6/7) are NOT in this map — they come from axis events.
 */
export const MANETTE_TO_W3C_BUTTON: ReadonlyMap<number, number> = new Map([
    [ManetteButton.SOUTH,           W3CButton.FACE_1],
    [ManetteButton.EAST,            W3CButton.FACE_2],
    [ManetteButton.WEST,            W3CButton.FACE_3],
    [ManetteButton.NORTH,           W3CButton.FACE_4],
    [ManetteButton.LEFT_SHOULDER,   W3CButton.LEFT_BUMPER],
    [ManetteButton.RIGHT_SHOULDER,  W3CButton.RIGHT_BUMPER],
    [ManetteButton.SELECT,          W3CButton.SELECT],
    [ManetteButton.START,           W3CButton.START],
    [ManetteButton.LEFT_STICK,      W3CButton.LEFT_STICK],
    [ManetteButton.RIGHT_STICK,     W3CButton.RIGHT_STICK],
    [ManetteButton.DPAD_UP,         W3CButton.DPAD_UP],
    [ManetteButton.DPAD_DOWN,       W3CButton.DPAD_DOWN],
    [ManetteButton.DPAD_LEFT,       W3CButton.DPAD_LEFT],
    [ManetteButton.DPAD_RIGHT,      W3CButton.DPAD_RIGHT],
    [ManetteButton.MODE,            W3CButton.HOME],
]);
