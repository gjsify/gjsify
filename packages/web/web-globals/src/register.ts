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

/**
 * Module-local typed view of the globals this file writes. Centralises the
 * 6 `(globalThis as any)` casts that would otherwise appear at every install
 * site.
 */
interface _RegisteredWebGlobals {
    URL?: unknown;
    URLSearchParams?: unknown;
    FormData?: unknown;
    performance?: unknown;
    PerformanceObserver?: unknown;
}

const g = globalThis as unknown as _RegisteredWebGlobals;

if (typeof globalThis.URL !== 'function') {
    g.URL = URL;
}
if (typeof globalThis.URLSearchParams !== 'function') {
    g.URLSearchParams = URLSearchParams;
}
if (typeof globalThis.FormData !== 'function') {
    g.FormData = FormData;
}
if (typeof globalThis.performance === 'undefined') {
    g.performance = performance;
}
if (typeof g.PerformanceObserver !== 'function') {
    g.PerformanceObserver = PerformanceObserver;
}

// Gamepad API via libmanette
import '@gjsify/gamepad/register';

// NOTE: neither @gjsify/webrtc/register NOR @gjsify/webaudio/register is
// included here. Both need native GStreamer typelibs that only exist when the
// bundle runs via `gjsify run` (which sets LD_LIBRARY_PATH/GI_TYPELIB_PATH),
// and `@gjsify/webaudio` additionally calls `Gst.init(null)` at module load.
// `--globals auto` injects both sets from `GJS_GLOBALS_MAP`, which points
// `AudioContext` / `Audio` / `HTMLAudioElement` at `@gjsify/webaudio/register`
// directly — so nothing is lost by not pulling them in from here.
//
// The webaudio import used to be here, which quietly contradicted this
// package's `node: "polyfill"` slot: `--globals auto` injects this catch-all,
// so every bundle that got it hard-required GStreamer at load. webrtc was
// already excluded for exactly this reason; webaudio was missed.
