// Node.js crypto module for GJS
// Hash/Hmac via GLib, random via WebCrypto/GLib, ciphers/sign/DH via browserify pure-JS
// Reference: Node.js lib/crypto.js

// Native GLib implementations
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

// Native PBKDF2/HKDF implementations (GLib.Hmac based)
export { pbkdf2, pbkdf2Sync } from './pbkdf2.js';
export { hkdf, hkdfSync } from './hkdf.js';

// Cipher/Decipher (browserify-cipher — pure-JS AES/DES)
export { createCipher, createCipheriv, createDecipher, createDecipheriv, getCiphers } from './cipher.js';

// Sign/Verify (browserify-sign — pure-JS RSA/ECDSA)
export { createSign, createVerify } from './sign.js';

// Diffie-Hellman (pure-JS)
export { createDiffieHellman, getDiffieHellman } from './dh.js';

// ECDH (pure-JS via elliptic)
export { createECDH, getCurves } from './ecdh.js';

// RSA public-key encryption (pure-JS)
export { publicEncrypt, privateDecrypt, privateEncrypt, publicDecrypt } from './public-encrypt.js';

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
