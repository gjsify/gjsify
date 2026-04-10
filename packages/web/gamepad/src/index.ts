// Gamepad Web API for GJS — original implementation using libmanette
// Reference: https://w3c.github.io/gamepad/

export { GamepadButton } from './gamepad-button.js';
export { Gamepad } from './gamepad.js';
export type {
    GamepadMappingType,
    GamepadHapticActuator,
    GamepadHapticEffectType,
    GamepadHapticsResult,
    GamepadEffectParameters,
} from './gamepad.js';
export { GamepadEvent } from './gamepad-event.js';
export type { GamepadEventInit } from './gamepad-event.js';
export { GamepadManager } from './gamepad-manager.js';
export { ManetteHapticActuator } from './haptic-actuator.js';
export { MANETTE_TO_W3C_BUTTON, ManetteButton, W3CButton, W3C_BUTTON_COUNT } from './button-mapping.js';
export { MANETTE_TO_W3C_AXIS, ManetteAxis, W3CAxis, W3C_AXIS_COUNT, TRIGGER_PRESS_THRESHOLD } from './axis-mapping.js';
