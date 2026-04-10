// Side-effect module: registers Web Audio API globals on GJS.
// On Node.js the alias layer routes this to @gjsify/empty.

import { AudioContext, HTMLAudioElement } from './index.js';

if (typeof (globalThis as any).AudioContext === 'undefined') {
    (globalThis as any).AudioContext = AudioContext;
}
if (typeof (globalThis as any).webkitAudioContext === 'undefined') {
    (globalThis as any).webkitAudioContext = AudioContext;
}
if (typeof (globalThis as any).Audio === 'undefined') {
    (globalThis as any).Audio = HTMLAudioElement;
}
if (typeof (globalThis as any).HTMLAudioElement === 'undefined') {
    (globalThis as any).HTMLAudioElement = HTMLAudioElement;
}
