// Reference: Node.js lib/buffer.js
// Reimplemented for GJS

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
import { registerGlobal } from '@gjsify/utils';

// Register Blob/File as globals on GJS if needed
registerGlobal('Blob', BlobImpl);
registerGlobal('File', FileImpl);

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
