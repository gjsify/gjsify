// Native buffer module for GJS — no Deno dependency

import { Buffer, SlowBuffer, kMaxLength, kStringMaxLength, constants } from './buffer.js';

export {
  Buffer,
  SlowBuffer,
  kMaxLength,
  kStringMaxLength,
  constants,
};

// Re-export Web APIs that Node's buffer module also exports
export const Blob = globalThis.Blob;
export const File = (globalThis as any).File;
export const atob = globalThis.atob;
export const btoa = globalThis.btoa;

export const INSPECT_MAX_BYTES = 50;

export default {
  Buffer,
  SlowBuffer,
  Blob,
  File,
  atob,
  btoa,
  kMaxLength,
  kStringMaxLength,
  constants,
  INSPECT_MAX_BYTES,
};
