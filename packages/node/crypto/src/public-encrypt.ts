// RSA public-key encryption wrappers around public-encrypt (pure-JS)
// Reference: Node.js lib/internal/crypto/cipher.js
//
// Uses lazy loading to avoid circular dependency.

let _pubEncMod: any = null;

function getPubEncModule() {
  if (!_pubEncMod) {
    // @ts-ignore — public-encrypt has no types
    _pubEncMod = require('public-encrypt/browser');
  }
  return _pubEncMod;
}

/**
 * Encrypts data with the given public key.
 */
export function publicEncrypt(key: any, buffer: Buffer | Uint8Array): Buffer {
  return getPubEncModule().publicEncrypt(key, buffer);
}

/**
 * Decrypts data with the given private key.
 */
export function privateDecrypt(key: any, buffer: Buffer | Uint8Array): Buffer {
  return getPubEncModule().privateDecrypt(key, buffer);
}

/**
 * Signs data with the given private key (low-level RSA sign).
 */
export function privateEncrypt(key: any, buffer: Buffer | Uint8Array): Buffer {
  return getPubEncModule().privateEncrypt(key, buffer);
}

/**
 * Verifies data with the given public key (low-level RSA verify).
 */
export function publicDecrypt(key: any, buffer: Buffer | Uint8Array): Buffer {
  return getPubEncModule().publicDecrypt(key, buffer);
}
