// Web Speech synthesis API for GJS — original implementation over libspiel (libspiel)
// Reference: https://webaudio.github.io/web-speech-api/#tts-section

export { SpeechSynthesis } from './speech-synthesis.js';
export type { SpeechSynthesisOptions } from './speech-synthesis.js';
export { SpeechSynthesisUtterance } from './utterance.js';
export { SpeechSynthesisVoice } from './voice.js';
export { SpeechSynthesisEvent, SpeechSynthesisErrorEvent } from './events.js';
export type { SpeechSynthesisErrorCode, SpeechSynthesisEventInit, SpeechSynthesisErrorEventInit } from './events.js';
// Non-standard: the W3C surface cannot tell "no voices installed" from "no speech stack".
// Same role as `hasGamepadBackend()` in @gjsify/gamepad.
export { describeSpeechSynthesisBackend, hasSpeechSynthesisBackend } from './backend.js';
export type { SpeechBackendStatus } from './backend.js';

import { SpeechSynthesis } from './speech-synthesis.js';
/** The shared instance, as `window.speechSynthesis`. */
export const speechSynthesis = new SpeechSynthesis();
