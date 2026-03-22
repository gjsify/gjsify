// Constant-time comparison to prevent timing attacks
// Reference: Node.js lib/internal/crypto/util.js

import { Buffer } from 'buffer';

/**
 * Compare two buffers in constant time to prevent timing attacks.
 * Both buffers must have the same length.
 */
export function timingSafeEqual(a: Buffer | Uint8Array, b: Buffer | Uint8Array): boolean {
  if (a.length !== b.length) {
    throw new RangeError('Input buffers must have the same byte length');
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }

  return result === 0;
}
