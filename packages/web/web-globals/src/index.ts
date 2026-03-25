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

// Re-export key types for convenience
export { DOMException } from '@gjsify/dom-exception';
export { Event, EventTarget, CustomEvent } from '@gjsify/dom-events';
export { AbortController, AbortSignal } from '@gjsify/abort-controller';
