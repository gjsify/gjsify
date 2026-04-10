// Gamepad Web API — button mapping from libmanette to W3C standard gamepad layout
// Reference: https://w3c.github.io/gamepad/#remapping
//
// IMPORTANT: libmanette 0.2 delivers Linux input event codes (BTN_*) in
// Event.get_button(), NOT the Manette.Button enum values from the docs.
// The enum (SOUTH=5, EAST=7, …) describes the semantic meaning, but the
// actual values transmitted over signals are the kernel BTN_* constants.
// Reference: linux/input-event-codes.h

/**
 * Linux BTN_* input event codes as reported by Manette.Event.get_button().
 * These are the actual values libmanette 0.2 passes in button-press/release signals.
 */
export const LinuxButton = {
    BTN_SOUTH:     304,   // 0x130 — A (Xbox), B (Nintendo), Cross (PlayStation)
    BTN_EAST:      305,   // 0x131 — B (Xbox), A (Nintendo), Circle (PlayStation)
    BTN_C:         306,   // 0x132
    BTN_NORTH:     307,   // 0x133 — Y (Xbox), X (Nintendo), Triangle (PlayStation)
    BTN_WEST:      308,   // 0x134 — X (Xbox), Y (Nintendo), Square (PlayStation)
    BTN_Z:         309,   // 0x135
    BTN_TL:        310,   // 0x136 — Left shoulder (L, LB)
    BTN_TR:        311,   // 0x137 — Right shoulder (R, RB)
    BTN_TL2:       312,   // 0x138 — Left trigger (LT, L2)
    BTN_TR2:       313,   // 0x139 — Right trigger (RT, R2)
    BTN_SELECT:    314,   // 0x13a — Select / Back / Share
    BTN_START:     315,   // 0x13b — Start / Menu / Options
    BTN_MODE:      316,   // 0x13c — Home / Guide / PS
    BTN_THUMBL:    317,   // 0x13d — Left stick click (L3)
    BTN_THUMBR:    318,   // 0x13e — Right stick click (R3)
    BTN_DPAD_UP:   544,   // 0x220
    BTN_DPAD_DOWN: 545,   // 0x221
    BTN_DPAD_LEFT: 546,   // 0x222
    BTN_DPAD_RIGHT:547,   // 0x223
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
    LEFT_TRIGGER: 6,    // Analog trigger — also populated from axis events
    RIGHT_TRIGGER: 7,   // Analog trigger — also populated from axis events
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
 * Maps Linux BTN_* code → W3C standard button index.
 */
export const MANETTE_TO_W3C_BUTTON: ReadonlyMap<number, number> = new Map([
    [LinuxButton.BTN_SOUTH,      W3CButton.FACE_1],
    [LinuxButton.BTN_EAST,       W3CButton.FACE_2],
    [LinuxButton.BTN_WEST,       W3CButton.FACE_3],
    [LinuxButton.BTN_NORTH,      W3CButton.FACE_4],
    [LinuxButton.BTN_TL,         W3CButton.LEFT_BUMPER],
    [LinuxButton.BTN_TR,         W3CButton.RIGHT_BUMPER],
    [LinuxButton.BTN_TL2,        W3CButton.LEFT_TRIGGER],
    [LinuxButton.BTN_TR2,        W3CButton.RIGHT_TRIGGER],
    [LinuxButton.BTN_SELECT,     W3CButton.SELECT],
    [LinuxButton.BTN_START,      W3CButton.START],
    [LinuxButton.BTN_THUMBL,     W3CButton.LEFT_STICK],
    [LinuxButton.BTN_THUMBR,     W3CButton.RIGHT_STICK],
    [LinuxButton.BTN_DPAD_UP,    W3CButton.DPAD_UP],
    [LinuxButton.BTN_DPAD_DOWN,  W3CButton.DPAD_DOWN],
    [LinuxButton.BTN_DPAD_LEFT,  W3CButton.DPAD_LEFT],
    [LinuxButton.BTN_DPAD_RIGHT, W3CButton.DPAD_RIGHT],
    [LinuxButton.BTN_MODE,       W3CButton.HOME],
]);

// Keep the old name exported for backward compat in tests/examples
export { LinuxButton as ManetteButton };
