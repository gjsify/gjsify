// MGF1 (Mask Generation Function 1) per RFC 8017 Section B.2.1
// Used by RSA-PSS and RSA-OAEP

import { Hash } from './hash.js';

/**
 * MGF1 mask generation function.
 * Produces a mask of `length` bytes from `seed` using `hashAlgo`.
 */
export function mgf1(hashAlgo: string, seed: Uint8Array, length: number): Uint8Array {
  const hashLen = hashSize(hashAlgo);
  const mask = new Uint8Array(length);
  let offset = 0;
  let counter = 0;

  while (offset < length) {
    // counter as 4-byte big-endian
    const C = new Uint8Array(4);
    C[0] = (counter >>> 24) & 0xff;
    C[1] = (counter >>> 16) & 0xff;
    C[2] = (counter >>> 8) & 0xff;
    C[3] = counter & 0xff;

    const hash = new Hash(hashAlgo);
    hash.update(seed);
    hash.update(C);
    const digest = new Uint8Array(hash.digest() as any);

    const toCopy = Math.min(digest.length, length - offset);
    mask.set(digest.slice(0, toCopy), offset);
    offset += toCopy;
    counter++;
  }

  return mask;
}

function hashSize(algo: string): number {
  switch (algo.toLowerCase().replace(/-/g, '')) {
    case 'sha1': return 20;
    case 'sha256': return 32;
    case 'sha384': return 48;
    case 'sha512': return 64;
    default: throw new Error(`Unknown hash algorithm: ${algo}`);
  }
}
