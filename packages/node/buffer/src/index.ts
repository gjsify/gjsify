// Native buffer module for GJS — no Deno dependency

import { Buffer, SlowBuffer, kMaxLength, kStringMaxLength, constants } from './buffer.js';

export {
  Buffer,
  SlowBuffer,
  kMaxLength,
  kStringMaxLength,
  constants,
};

// Re-export Web APIs that Node's buffer module also exports (Blob since Node 18)
import { Blob as BlobImpl, File as FileImpl } from './blob.js';

// Register Blob/File as globals on GJS if needed
if (typeof globalThis.Blob === 'undefined') {
  (globalThis as any).Blob = BlobImpl;
}
if (typeof (globalThis as any).File === 'undefined') {
  (globalThis as any).File = FileImpl;
}

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
