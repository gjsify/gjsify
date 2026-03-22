// Node.js crypto module for GJS
// Core subset: Hash, Hmac, random operations
// Reference: Node.js lib/crypto.js

export { Hash, getHashes, hash } from './hash.js';
export { Hmac } from './hmac.js';
export {
  randomBytes,
  randomFill,
  randomFillSync,
  randomUUID,
  randomInt,
} from './random.js';
export { timingSafeEqual } from './timing-safe-equal.js';
export { constants } from './constants.js';

import { Hash } from './hash.js';
import { Hmac } from './hmac.js';

/** Create a Hash object for the given algorithm. */
export function createHash(algorithm: string): Hash {
  return new Hash(algorithm);
}

/** Create an Hmac object for the given algorithm and key. */
export function createHmac(algorithm: string, key: string | Buffer | Uint8Array): Hmac {
  return new Hmac(algorithm, key);
}
