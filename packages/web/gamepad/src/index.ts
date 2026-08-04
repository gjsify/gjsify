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
// The platform-capability query the W3C surface has no word for: an all-null
// getGamepads() means BOTH "no controller connected" and "no gamepad backend on
// this host", and only this tells them apart. Same role as
// `isSecureRandomSource()` in @gjsify/webcrypto/random, `hasNativeSab()` and
// `hasOcspSupport()`.
export { hasGamepadBackend } from './backend.js';
export type { GamepadBackendStatus } from './backend.js';
export { ManetteHapticActuator } from './haptic-actuator.js';
export { MANETTE_TO_W3C_BUTTON, ManetteButton, W3CButton, W3C_BUTTON_COUNT } from './button-mapping.js';
export { MANETTE_TO_W3C_AXIS, ManetteAxis, W3CAxis, W3C_AXIS_COUNT, TRIGGER_PRESS_THRESHOLD } from './axis-mapping.js';
