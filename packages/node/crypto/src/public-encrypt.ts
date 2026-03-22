// RSA public-key encryption wrappers around public-encrypt (pure-JS)
// Reference: Node.js lib/internal/crypto/cipher.js

// @ts-ignore — public-encrypt has no types
import _publicEncrypt from 'public-encrypt';

const {
  publicEncrypt: _pubEncrypt,
  privateDecrypt: _privDecrypt,
  privateEncrypt: _privEncrypt,
  publicDecrypt: _pubDecrypt,
} = _publicEncrypt;

/**
 * Encrypts data with the given public key.
 */
export function publicEncrypt(key: any, buffer: Buffer | Uint8Array): Buffer {
  return _pubEncrypt(key, buffer);
}

/**
 * Decrypts data with the given private key.
 */
export function privateDecrypt(key: any, buffer: Buffer | Uint8Array): Buffer {
  return _privDecrypt(key, buffer);
}

/**
 * Signs data with the given private key (low-level RSA sign).
 */
export function privateEncrypt(key: any, buffer: Buffer | Uint8Array): Buffer {
  return _privEncrypt(key, buffer);
}

/**
 * Verifies data with the given public key (low-level RSA verify).
 */
export function publicDecrypt(key: any, buffer: Buffer | Uint8Array): Buffer {
  return _pubDecrypt(key, buffer);
}
