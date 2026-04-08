// Side-effect module: registers CompressionStream/DecompressionStream as
// globals on GJS. Node.js 18+ ships these natively — the alias layer maps
// this subpath to @gjsify/empty for Node builds.

import { CompressionStream, DecompressionStream } from './index.js';

if (typeof globalThis.CompressionStream === 'undefined') {
  (globalThis as any).CompressionStream = CompressionStream;
}
if (typeof globalThis.DecompressionStream === 'undefined') {
  (globalThis as any).DecompressionStream = DecompressionStream;
}
