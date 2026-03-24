// WHATWG Streams API for GJS
// Reference: refs/node/lib/internal/webstreams/
// Copyright (c) Node.js contributors. MIT license.
// Reimplemented for GJS — pure TypeScript, no native bindings.
//
// On Node.js (and any environment with native Web Streams), this module
// re-exports the native globals for zero overhead.
// On GJS, it provides a full polyfill and registers globals.

import { WritableStream, WritableStreamDefaultWriter, WritableStreamDefaultController } from './writable-stream.js';
import { ReadableStream, ReadableStreamDefaultReader, ReadableStreamDefaultController } from './readable-stream.js';
import { TransformStream, TransformStreamDefaultController } from './transform-stream.js';
import { ByteLengthQueuingStrategy, CountQueuingStrategy } from './queuing-strategies.js';
import { TextEncoderStream } from './text-encoder-stream.js';
import { TextDecoderStream } from './text-decoder-stream.js';

// Use native if available (Node.js 18+), polyfill otherwise
const _WritableStream = typeof globalThis.WritableStream === 'function'
  ? globalThis.WritableStream
  : WritableStream;
const _ReadableStream = typeof globalThis.ReadableStream === 'function'
  ? globalThis.ReadableStream
  : ReadableStream;
const _TransformStream = typeof globalThis.TransformStream === 'function'
  ? globalThis.TransformStream
  : TransformStream;
const _ByteLengthQueuingStrategy = typeof globalThis.ByteLengthQueuingStrategy === 'function'
  ? globalThis.ByteLengthQueuingStrategy
  : ByteLengthQueuingStrategy;
const _CountQueuingStrategy = typeof globalThis.CountQueuingStrategy === 'function'
  ? globalThis.CountQueuingStrategy
  : CountQueuingStrategy;
const _TextEncoderStream = typeof globalThis.TextEncoderStream === 'function'
  ? globalThis.TextEncoderStream
  : TextEncoderStream;
const _TextDecoderStream = typeof globalThis.TextDecoderStream === 'function'
  ? globalThis.TextDecoderStream
  : TextDecoderStream;

// Register globals on GJS
if (typeof globalThis.WritableStream === 'undefined') {
  (globalThis as any).WritableStream = WritableStream;
}
if (typeof globalThis.ReadableStream === 'undefined') {
  (globalThis as any).ReadableStream = ReadableStream;
}
if (typeof globalThis.TransformStream === 'undefined') {
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

export {
  _WritableStream as WritableStream,
  _ReadableStream as ReadableStream,
  _TransformStream as TransformStream,
  _ByteLengthQueuingStrategy as ByteLengthQueuingStrategy,
  _CountQueuingStrategy as CountQueuingStrategy,
  _TextEncoderStream as TextEncoderStream,
  _TextDecoderStream as TextDecoderStream,
};

// Re-export class types for direct import
export { WritableStreamDefaultWriter, WritableStreamDefaultController } from './writable-stream.js';
export { ReadableStreamDefaultReader, ReadableStreamDefaultController } from './readable-stream.js';
export { TransformStreamDefaultController } from './transform-stream.js';

// Re-export internals needed by other packages
export {
  isWritableStream,
  isWritableStreamLocked,
  writableStreamAbort,
  writableStreamClose,
  writableStreamCloseQueuedOrInFlight,
  writableStreamDefaultWriterCloseWithErrorPropagation,
  writableStreamDefaultControllerErrorIfNeeded,
  createWritableStream,
} from './writable-stream.js';

export {
  isReadableStream,
  isReadableStreamLocked,
  readableStreamCancel,
  readableStreamClose,
  readableStreamError,
  readableStreamDefaultControllerClose,
  readableStreamDefaultControllerEnqueue,
  readableStreamDefaultControllerError,
  readableStreamDefaultControllerGetDesiredSize,
  readableStreamDefaultControllerCanCloseOrEnqueue,
  readableStreamDefaultControllerHasBackpressure,
  setupReadableStreamDefaultController,
  createReadableStream,
} from './readable-stream.js';

export {
  isTransformStream,
  isTransformStreamDefaultController,
} from './transform-stream.js';

export default {
  WritableStream: _WritableStream,
  ReadableStream: _ReadableStream,
  TransformStream: _TransformStream,
  ByteLengthQueuingStrategy: _ByteLengthQueuingStrategy,
  CountQueuingStrategy: _CountQueuingStrategy,
  TextEncoderStream: _TextEncoderStream,
  TextDecoderStream: _TextDecoderStream,
};
