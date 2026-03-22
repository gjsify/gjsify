// Cipher/Decipher wrappers around browserify-cipher (pure-JS AES/DES)
// Reference: Node.js lib/internal/crypto/cipher.js

// @ts-ignore — browserify-cipher has no types
import browserifyCipher from 'browserify-cipher';

const {
  createCipher: _createCipher,
  createCipheriv: _createCipheriv,
  createDecipher: _createDecipher,
  createDecipheriv: _createDecipheriv,
  getCiphers: _getCiphers,
} = browserifyCipher;

/**
 * Creates and returns a Cipher object using the given algorithm and password.
 * @deprecated Use createCipheriv() instead.
 */
export function createCipher(algorithm: string, password: string | Buffer | Uint8Array): any {
  return _createCipher(algorithm, password);
}

/**
 * Creates and returns a Cipher object with the given algorithm, key, and IV.
 */
export function createCipheriv(algorithm: string, key: string | Buffer | Uint8Array, iv: string | Buffer | Uint8Array | null): any {
  return _createCipheriv(algorithm, key, iv);
}

/**
 * Creates and returns a Decipher object using the given algorithm and password.
 * @deprecated Use createDecipheriv() instead.
 */
export function createDecipher(algorithm: string, password: string | Buffer | Uint8Array): any {
  return _createDecipher(algorithm, password);
}

/**
 * Creates and returns a Decipher object with the given algorithm, key, and IV.
 */
export function createDecipheriv(algorithm: string, key: string | Buffer | Uint8Array, iv: string | Buffer | Uint8Array | null): any {
  return _createDecipheriv(algorithm, key, iv);
}

/**
 * Returns an array of the names of the supported cipher algorithms.
 */
export function getCiphers(): string[] {
  return _getCiphers();
}
