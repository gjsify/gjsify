// Gamepad Web API — GamepadButton
// Reference: https://w3c.github.io/gamepad/#dom-gamepadbutton

/**
 * Represents the state of a single button on a gamepad.
 * https://w3c.github.io/gamepad/#dom-gamepadbutton
 */
export class GamepadButton {
    pressed: boolean;
    touched: boolean;
    value: number;

    constructor(pressed = false, touched = false, value = 0) {
        this.pressed = pressed;
        this.touched = touched;
        this.value = value;
    }

    get [Symbol.toStringTag]() {
        return 'GamepadButton';
    }
}
