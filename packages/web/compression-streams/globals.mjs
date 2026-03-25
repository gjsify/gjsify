/**
 * Re-exports native Compression Streams globals for use in Node.js builds.
 * On Node.js 23.11+, CompressionStream/DecompressionStream are native globals.
 */
export const CompressionStream = globalThis.CompressionStream;
export const DecompressionStream = globalThis.DecompressionStream;
