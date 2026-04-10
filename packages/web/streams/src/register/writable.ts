// Registers: WritableStream

import { WritableStream } from '../index.js';

function isNativeStreamUsable(Ctor: unknown, method: string): boolean {
  try {
    if (typeof Ctor !== 'function') return false;
    return typeof (Ctor as any).prototype[method] === 'function';
  } catch {
    return false;
  }
}

if (!isNativeStreamUsable(globalThis.WritableStream, 'getWriter')) {
  (globalThis as any).WritableStream = WritableStream;
}
