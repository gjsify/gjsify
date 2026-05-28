/**
 * Re-exports unified Web API globals for browser builds.
 *
 * `@gjsify/web-globals` is a convenience aggregator over sibling
 * `@gjsify/<web-pkg>` packages. On browser, each of those siblings routes
 * its own `/globals` to the corresponding native globalThis value, so the
 * cleanest re-export here is just to read the same names directly off
 * globalThis (matches what the polyfill `index.ts` surfaces in shape).
 */
export const DOMException = globalThis.DOMException;
export const AudioContext = globalThis.AudioContext;
export const HTMLAudioElement = globalThis.HTMLAudioElement;
export const Event = globalThis.Event;
export const EventTarget = globalThis.EventTarget;
export const CustomEvent = globalThis.CustomEvent;
export const AbortController = globalThis.AbortController;
export const AbortSignal = globalThis.AbortSignal;
export const URL = globalThis.URL;
export const URLSearchParams = globalThis.URLSearchParams;
export const Blob = globalThis.Blob;
export const File = globalThis.File;
export const FormData = globalThis.FormData;
export const performance = globalThis.performance;
export const PerformanceObserver = globalThis.PerformanceObserver;
