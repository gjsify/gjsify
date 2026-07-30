// Web Audio API for GJS — backed by GStreamer 1.0.
//
// This module has no side effects. Importing @gjsify/webaudio gives
// named access to Web Audio classes but does NOT register globals.
// Use @gjsify/webaudio/register to set globalThis.AudioContext, etc.

export { AudioContext } from './audio-context.js';
export { AudioBuffer } from './audio-buffer.js';
export { AudioNode } from './audio-node.js';
export { AudioDestinationNode } from './audio-destination-node.js';
export { AudioBufferSourceNode } from './audio-buffer-source-node.js';
export { GainNode } from './gain-node.js';
export { AudioParam } from './audio-param.js';
export { HTMLAudioElement } from './html-audio-element.js';
// Teardown control plane — `AudioContext.close()` and the GApplication
// `shutdown` hook drive this automatically; exported for hosts with a lifecycle
// of their own (a CLI, a test harness) that must guarantee NULL-state teardown.
export { stopAllPipelines } from './gst-teardown.js';
