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

// Use native if available and functional (Node.js 18+), polyfill otherwise
const _ReadableStream = isNativeStreamUsable(globalThis.ReadableStream, 'getReader')
  ? globalThis.ReadableStream
  : ReadableStream;
const _WritableStream = isNativeStreamUsable(globalThis.WritableStream, 'getWriter')
  ? globalThis.WritableStream
  : WritableStream;
const _TransformStream = isNativeStreamUsable(globalThis.TransformStream, 'readable')
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

// Note: globals are no longer registered at import time. Use the `/register`
// subpath (`import '@gjsify/web-streams/register'`) if you need the stream
// constructors to be set on globalThis (and to replace broken native
// implementations on GJS).

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
