// Side-effect module: registers the full Web API surface on GJS by chaining
// every sub-package's `/register` entry and filling in the few remaining
// globals that don't have their own dedicated register module yet
// (URL, FormData, performance, AudioContext, ...).
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

// Blob, File (WHATWG File API) — via @gjsify/buffer's /register entry
import '@gjsify/buffer/register';

// URL, URLSearchParams (WHATWG URL Standard, GLib.Uri-based)
import { URL, URLSearchParams } from '@gjsify/url';
// FormData (WHATWG XMLHttpRequest Standard)
import { FormData } from '@gjsify/formdata';
// Performance (Web Performance API)
import { performance, PerformanceObserver } from '@gjsify/perf_hooks';

if (typeof globalThis.URL !== 'function') {
  (globalThis as any).URL = URL;
}
if (typeof globalThis.URLSearchParams !== 'function') {
  (globalThis as any).URLSearchParams = URLSearchParams;
}
if (typeof globalThis.FormData !== 'function') {
  (globalThis as any).FormData = FormData;
}
if (typeof globalThis.performance === 'undefined') {
  (globalThis as any).performance = performance;
}
if (typeof (globalThis as any).PerformanceObserver !== 'function') {
  (globalThis as any).PerformanceObserver = PerformanceObserver;
}

// AudioContext stub — Web Audio API is not available in GJS.
// Libraries like Excalibur.js check for window.AudioContext; the stub prevents
// crashes and silently discards all audio. Future work: GStreamer backend.
import { AudioContext, HTMLAudioElement } from './audio-stub.js';

if (typeof (globalThis as any).AudioContext === 'undefined') {
  (globalThis as any).AudioContext = AudioContext;
}
if (typeof (globalThis as any).webkitAudioContext === 'undefined') {
  (globalThis as any).webkitAudioContext = AudioContext;
}
// HTMLAudioElement / Audio — Excalibur uses `new Audio()` for format detection
if (typeof (globalThis as any).Audio === 'undefined') {
  (globalThis as any).Audio = HTMLAudioElement;
}
if (typeof (globalThis as any).HTMLAudioElement === 'undefined') {
  (globalThis as any).HTMLAudioElement = HTMLAudioElement;
}
