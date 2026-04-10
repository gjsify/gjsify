// Unified Web API surface for GJS — pure re-exports only.
//
// This module has no side effects. Importing `@gjsify/web-globals` gives
// you named access to the key Web API classes but does NOT register any
// globals. Use `@gjsify/web-globals/register` (or add the relevant
// identifiers to the `--globals` CLI flag) to actually set
// `globalThis.fetch`, `globalThis.ReadableStream`,
// `globalThis.AbortController`, etc.

// Re-export key types for convenience
export { DOMException } from '@gjsify/dom-exception';
export { AudioContext, HTMLAudioElement } from '@gjsify/webaudio';
export { Event, EventTarget, CustomEvent } from '@gjsify/dom-events';
export { AbortController, AbortSignal } from '@gjsify/abort-controller';
export { URL, URLSearchParams } from '@gjsify/url';
export { Blob, File } from '@gjsify/buffer';
export { FormData } from '@gjsify/formdata';
export { performance, PerformanceObserver } from '@gjsify/perf_hooks';
