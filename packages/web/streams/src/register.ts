// Side-effect module: registers the WHATWG Streams constructors as globals
// on GJS, replacing broken native implementations if necessary.
// On Node.js the alias layer routes this to @gjsify/empty.

import {
  ReadableStream,
  WritableStream,
  TransformStream,
  ByteLengthQueuingStrategy,
  CountQueuingStrategy,
  TextEncoderStream,
  TextDecoderStream,
} from './index.js';

// Validate that a native stream class produces functional instances.
// GJS may expose stream constructors that return objects missing core methods
// (e.g. ReadableStream exists but instances lack getReader()).
function isNativeStreamUsable(Ctor: unknown, method: string): boolean {
  try {
    if (typeof Ctor !== 'function') return false;
    return typeof (Ctor as any).prototype[method] === 'function';
  } catch {
    return false;
  }
}

if (!isNativeStreamUsable(globalThis.ReadableStream, 'getReader')) {
  (globalThis as any).ReadableStream = ReadableStream;
}
if (!isNativeStreamUsable(globalThis.WritableStream, 'getWriter')) {
  (globalThis as any).WritableStream = WritableStream;
}
if (!isNativeStreamUsable(globalThis.TransformStream, 'readable')) {
  (globalThis as any).TransformStream = TransformStream;
}
if (typeof globalThis.ByteLengthQueuingStrategy === 'undefined') {
  (globalThis as any).ByteLengthQueuingStrategy = ByteLengthQueuingStrategy;
}
if (typeof globalThis.CountQueuingStrategy === 'undefined') {
  (globalThis as any).CountQueuingStrategy = CountQueuingStrategy;
}
if (typeof globalThis.TextEncoderStream === 'undefined') {
  (globalThis as any).TextEncoderStream = TextEncoderStream;
}
if (typeof globalThis.TextDecoderStream === 'undefined') {
  (globalThis as any).TextDecoderStream = TextDecoderStream;
}
