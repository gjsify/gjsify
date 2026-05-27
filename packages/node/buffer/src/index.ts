// Reference: Node.js lib/buffer.js
// Reimplemented for GJS

import { Buffer, SlowBuffer, kMaxLength, kStringMaxLength, constants } from './buffer.js';

export { Buffer, SlowBuffer, kMaxLength, kStringMaxLength, constants };

// Re-export encoding + base64 helpers that used to live in `@gjsify/utils`.
// `@gjsify/string_decoder`, `@gjsify/crypto`, and other Buffer/encoding
// consumers import these from here (their natural home — they describe the
// Buffer-encoding contract).
export { normalizeEncoding, checkEncoding, type Encoding } from './encoding.js';
export { base64Encode, base64Decode, atobPolyfill, btoaPolyfill } from './base64.js';

// Re-export Web APIs that Node's buffer module also exports (Blob since Node 18)
import { Blob as BlobImpl, File as FileImpl } from './blob.js';

// Note: Blob/File globals are no longer registered at import time. Use the
// `/register` subpath (`import '@gjsify/buffer/register'`) if you need
// globalThis.Blob / File to be set on GJS.

export { BlobImpl as Blob, FileImpl as File };
export const atob = globalThis.atob;
export const btoa = globalThis.btoa;

export const INSPECT_MAX_BYTES = 50;

export default {
    Buffer,
    SlowBuffer,
    Blob: BlobImpl,
    File: FileImpl,
    atob,
    btoa,
    kMaxLength,
    kStringMaxLength,
    constants,
    INSPECT_MAX_BYTES,
};
