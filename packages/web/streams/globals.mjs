/**
 * Re-exports native WHATWG Streams globals for browser / Node.js 18+ builds.
 * Used as the target for node:stream/web and stream/web alias in browser builds.
 */
export const ReadableStream = globalThis.ReadableStream;
export const WritableStream = globalThis.WritableStream;
export const TransformStream = globalThis.TransformStream;
export const ReadableStreamDefaultReader = globalThis.ReadableStreamDefaultReader;
export const ReadableStreamBYOBReader = globalThis.ReadableStreamBYOBReader;
export const WritableStreamDefaultWriter = globalThis.WritableStreamDefaultWriter;
export const ReadableStreamDefaultController = globalThis.ReadableStreamDefaultController;
export const ReadableByteStreamController = globalThis.ReadableByteStreamController;
export const WritableStreamDefaultController = globalThis.WritableStreamDefaultController;
export const TransformStreamDefaultController = globalThis.TransformStreamDefaultController;
export const ByteLengthQueuingStrategy = globalThis.ByteLengthQueuingStrategy;
export const CountQueuingStrategy = globalThis.CountQueuingStrategy;
export const TextEncoderStream = globalThis.TextEncoderStream;
export const TextDecoderStream = globalThis.TextDecoderStream;
