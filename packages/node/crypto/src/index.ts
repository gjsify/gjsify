// Node.js crypto module for GJS
// Hash via GLib.Checksum, Hmac via pure-JS (using Hash), random via WebCrypto/GLib
// Reference: Node.js lib/crypto.js

// === GLib.Checksum-based implementations ===
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

// PBKDF2/HKDF/scrypt implementations (using pure-JS Hmac)
export { pbkdf2, pbkdf2Sync } from './pbkdf2.js';
export { hkdf, hkdfSync } from './hkdf.js';
export { scrypt, scryptSync } from './scrypt.js';

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

// === Browserify pure-JS wrappers (lazy-loaded to break circular deps) ===
// These packages internally use create-hash/create-hmac/randombytes which
// the bundler aliases back to this module. Lazy loading ensures the native
// exports above are available before the browserify modules initialize.

export { createCipher, createCipheriv, createDecipher, createDecipheriv, getCiphers } from './cipher.js';
export { Sign, Verify, createSign, createVerify } from './sign.js';
export { createDiffieHellman, getDiffieHellman, DiffieHellman, DiffieHellmanGroup, createDiffieHellmanGroup } from './dh.js';
export { createECDH, getCurves } from './ecdh.js';
export { publicEncrypt, privateDecrypt, privateEncrypt, publicDecrypt } from './public-encrypt.js';
