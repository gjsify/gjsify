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

/**
 * The subset of `globalThis` this register module writes to. Each name maps
 * to a constructor function whose presence we feature-detect; we never read
 * back through this shape, only assign. Defining it once removes 11
 * `(globalThis as any)` casts in the install sites.
 */
interface _StreamGlobals {
    ReadableStream?: unknown;
    ReadableStreamBYOBReader?: unknown;
    ReadableStreamBYOBRequest?: unknown;
    ReadableByteStreamController?: unknown;
    ReadableStreamDefaultController?: unknown;
    ReadableStreamDefaultReader?: unknown;
}

const g = globalThis as unknown as _StreamGlobals;

function isNativeStreamUsable(Ctor: unknown, method: string): boolean {
    try {
        if (typeof Ctor !== 'function') return false;
        const proto = (Ctor as { prototype?: Record<string, unknown> }).prototype;
        return typeof proto?.[method] === 'function';
    } catch {
        return false;
    }
}

if (!isNativeStreamUsable(globalThis.ReadableStream, 'getReader')) {
    g.ReadableStream = ReadableStream;
}

// Reader / controller / request classes — only install if missing. SM140
// exposes some of these natively; install ours only on environments that
// don't provide them (real GJS without native streams).
if (typeof g.ReadableStreamBYOBReader === 'undefined') {
    g.ReadableStreamBYOBReader = ReadableStreamBYOBReader;
}
if (typeof g.ReadableStreamBYOBRequest === 'undefined') {
    g.ReadableStreamBYOBRequest = ReadableStreamBYOBRequest;
}
if (typeof g.ReadableByteStreamController === 'undefined') {
    g.ReadableByteStreamController = ReadableByteStreamController;
}
if (typeof g.ReadableStreamDefaultController === 'undefined') {
    g.ReadableStreamDefaultController = ReadableStreamDefaultController;
}
if (typeof g.ReadableStreamDefaultReader === 'undefined') {
    g.ReadableStreamDefaultReader = ReadableStreamDefaultReader;
}
