// Side-effect module: registers Web Audio API globals on GJS.
// On Node.js the alias layer routes this to @gjsify/empty.

import { AudioContext, HTMLAudioElement } from './index.js';

/** Module-local typed view of the globals this file writes. */
interface _WebAudioGlobals {
    AudioContext?: unknown;
    webkitAudioContext?: unknown;
    Audio?: unknown;
    HTMLAudioElement?: unknown;
}

const g = globalThis as unknown as _WebAudioGlobals;

if (typeof g.AudioContext === 'undefined') {
    g.AudioContext = AudioContext;
}
if (typeof g.webkitAudioContext === 'undefined') {
    g.webkitAudioContext = AudioContext;
}
if (typeof g.Audio === 'undefined') {
    g.Audio = HTMLAudioElement;
}
if (typeof g.HTMLAudioElement === 'undefined') {
    g.HTMLAudioElement = HTMLAudioElement;
}
