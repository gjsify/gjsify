/**
 * Re-exports native Web Audio API globals for browser builds.
 *
 * `AudioContext` and the related node hierarchy are universal in modern
 * browsers (Chrome 34+, Firefox 25+, Safari 14.1+ unprefixed).
 *
 * The dynamic resolver in `@gjsify/resolve-npm/runtime-aliases.mjs` routes
 * `@gjsify/webaudio` here when `package.json#gjsify.runtimes.browser === "native"`.
 *
 * NOT used on Node — Node has no AudioContext global.
 */

export const AudioContext = globalThis.AudioContext;
export const AudioBuffer = globalThis.AudioBuffer;
export const AudioBufferSourceNode = globalThis.AudioBufferSourceNode;
export const GainNode = globalThis.GainNode;
export const AudioParam = globalThis.AudioParam;
export const HTMLAudioElement = globalThis.HTMLAudioElement;
export const OfflineAudioContext = globalThis.OfflineAudioContext;
