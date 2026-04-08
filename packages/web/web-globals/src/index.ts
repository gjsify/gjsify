// Unified Web API surface for GJS — pure re-exports only.
//
// This module has no side effects. Importing `@gjsify/web-globals` gives
// you named access to the key Web API classes but does NOT register any
// globals. Use `@gjsify/web-globals/register` (or let the gjsify esbuild
// plugin auto-inject it) to actually set `globalThis.fetch`,
// `globalThis.ReadableStream`, `globalThis.AbortController`, etc.

// Re-export key types for convenience
export { DOMException } from '@gjsify/dom-exception';
export { Event, EventTarget, CustomEvent } from '@gjsify/dom-events';
export { AbortController, AbortSignal } from '@gjsify/abort-controller';
export { URL, URLSearchParams } from '@gjsify/url';
export { Blob, File } from '@gjsify/buffer';
export { FormData } from '@gjsify/formdata';
export { performance, PerformanceObserver } from '@gjsify/perf_hooks';
