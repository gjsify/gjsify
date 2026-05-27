// Side-effect module: registers CompressionStream/DecompressionStream as
// globals on GJS. Node.js 18+ ships these natively — the alias layer maps
// this subpath to @gjsify/empty for Node builds.

import { CompressionStream, DecompressionStream } from './index.js';

interface _CompressionGlobals {
    CompressionStream?: typeof CompressionStream;
    DecompressionStream?: typeof DecompressionStream;
}
const g = globalThis as unknown as _CompressionGlobals;

if (typeof globalThis.CompressionStream === 'undefined') {
    g.CompressionStream = CompressionStream;
}
if (typeof globalThis.DecompressionStream === 'undefined') {
    g.DecompressionStream = DecompressionStream;
}
