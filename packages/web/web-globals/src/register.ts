// Side-effect module: registers the full Web API surface on GJS by chaining
// every sub-package's `/register` entry.
//
// On Node.js the alias layer maps this subpath to @gjsify/empty since all of
// these APIs are already native.

// DOMException (WebIDL standard)
import '@gjsify/dom-exception/register';

// DOM Events: Event, EventTarget, CustomEvent, MessageEvent
import '@gjsify/dom-events/register';

// AbortController, AbortSignal
import '@gjsify/abort-controller/register';

// WHATWG Streams: ReadableStream, WritableStream, TransformStream,
// TextEncoderStream, TextDecoderStream, queuing strategies
import '@gjsify/web-streams/register';

// CompressionStream, DecompressionStream
import '@gjsify/compression-streams/register';

// WebCrypto: crypto.subtle, getRandomValues, randomUUID
import '@gjsify/webcrypto/register';

// EventSource (Server-Sent Events)
import '@gjsify/eventsource/register';

// --- Consolidated globals (previously inline in index.ts) ---

// URL, URLSearchParams (WHATWG URL Standard, GLib.Uri-based)
import { URL, URLSearchParams } from '@gjsify/url';
if (typeof globalThis.URL !== 'function') {
  Object.defineProperty(globalThis, 'URL', { value: URL, writable: true, configurable: true });
}
if (typeof globalThis.URLSearchParams !== 'function') {
  Object.defineProperty(globalThis, 'URLSearchParams', { value: URLSearchParams, writable: true, configurable: true });
}

// Blob, File (WHATWG File API) — via @gjsify/buffer's /register entry
import '@gjsify/buffer/register';

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
