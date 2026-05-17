// Registers: ReadableStream, ReadableStreamBYOBReader, ReadableStreamBYOBRequest,
//            ReadableByteStreamController, ReadableStreamDefaultController,
//            ReadableStreamDefaultReader

import {
  ReadableStream,
  ReadableStreamBYOBReader,
  ReadableStreamBYOBRequest,
  ReadableByteStreamController,
  ReadableStreamDefaultController,
  ReadableStreamDefaultReader,
} from '../index.js';

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

// Reader / controller / request classes — only install if missing. SM140
// exposes some of these natively; install ours only on environments that
// don't provide them (real GJS without native streams).
if (typeof (globalThis as any).ReadableStreamBYOBReader === 'undefined') {
  (globalThis as any).ReadableStreamBYOBReader = ReadableStreamBYOBReader;
}
if (typeof (globalThis as any).ReadableStreamBYOBRequest === 'undefined') {
  (globalThis as any).ReadableStreamBYOBRequest = ReadableStreamBYOBRequest;
}
if (typeof (globalThis as any).ReadableByteStreamController === 'undefined') {
  (globalThis as any).ReadableByteStreamController = ReadableByteStreamController;
}
if (typeof (globalThis as any).ReadableStreamDefaultController === 'undefined') {
  (globalThis as any).ReadableStreamDefaultController = ReadableStreamDefaultController;
}
if (typeof (globalThis as any).ReadableStreamDefaultReader === 'undefined') {
  (globalThis as any).ReadableStreamDefaultReader = ReadableStreamDefaultReader;
}
