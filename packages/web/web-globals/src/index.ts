// Unified Web API globals for GJS
// Importing each package triggers its global registration (e.g. globalThis.Event = ...)
// On Node.js, these are no-ops since natives are already available.

// DOMException (WebIDL standard)
import '@gjsify/dom-exception';

// DOM Events: Event, EventTarget, CustomEvent
import '@gjsify/dom-events';

// AbortController, AbortSignal
import '@gjsify/abort-controller';

// WHATWG Streams: ReadableStream, WritableStream, TransformStream,
// TextEncoderStream, TextDecoderStream, queuing strategies
import '@gjsify/web-streams';

// CompressionStream, DecompressionStream
import '@gjsify/compression-streams';

// WebCrypto: crypto.subtle, getRandomValues, randomUUID
import '@gjsify/webcrypto';

// EventSource (Server-Sent Events)
import '@gjsify/eventsource';

// --- Newly consolidated globals ---

// URL, URLSearchParams (WHATWG URL Standard, GLib.Uri-based)
import { URL, URLSearchParams } from '@gjsify/url';
if (typeof globalThis.URL !== 'function') {
  Object.defineProperty(globalThis, 'URL', { value: URL, writable: true, configurable: true });
}
if (typeof globalThis.URLSearchParams !== 'function') {
  Object.defineProperty(globalThis, 'URLSearchParams', { value: URLSearchParams, writable: true, configurable: true });
}

// Blob, File (WHATWG File API)
import { Blob, File } from '@gjsify/buffer';
if (typeof globalThis.Blob !== 'function') {
  Object.defineProperty(globalThis, 'Blob', { value: Blob, writable: true, configurable: true });
}
if (typeof (globalThis as any).File !== 'function') {
  Object.defineProperty(globalThis, 'File', { value: File, writable: true, configurable: true });
}

// FormData (WHATWG XMLHttpRequest Standard)
import { FormData } from '@gjsify/formdata';
if (typeof globalThis.FormData !== 'function') {
  Object.defineProperty(globalThis, 'FormData', { value: FormData, writable: true, configurable: true });
}

// Performance (Web Performance API)
import { performance, PerformanceObserver } from '@gjsify/perf_hooks';
if (!globalThis.performance) {
  Object.defineProperty(globalThis, 'performance', { value: performance, writable: true, configurable: true });
}
if (typeof (globalThis as any).PerformanceObserver !== 'function') {
  Object.defineProperty(globalThis, 'PerformanceObserver', { value: PerformanceObserver, writable: true, configurable: true });
}

// Re-export key types for convenience
export { DOMException } from '@gjsify/dom-exception';
export { Event, EventTarget, CustomEvent } from '@gjsify/dom-events';
export { AbortController, AbortSignal } from '@gjsify/abort-controller';
export { URL, URLSearchParams } from '@gjsify/url';
export { Blob, File } from '@gjsify/buffer';
export { FormData } from '@gjsify/formdata';
export { performance, PerformanceObserver } from '@gjsify/perf_hooks';
