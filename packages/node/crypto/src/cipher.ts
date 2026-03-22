// Cipher/Decipher — stub pending native TypeScript reimplementation
// The browserify-cipher npm package cannot be used in GJS because:
// - Its dependencies use Transform.call(this) incompatible with ES6 classes
// - It depends on global Buffer and process not available in GJS at load time
// TODO: Reimplement AES/DES in TypeScript using refs/browserify-cipher as reference

import { Buffer } from 'buffer';

function notImplemented(name: string): never {
  throw new Error(`crypto.${name}() is not yet implemented for GJS. See refs/browserify-cipher/ for reference.`);
}

export function createCipher(_algorithm: string, _password: string | Buffer | Uint8Array): any {
  notImplemented('createCipher');
}

export function createCipheriv(_algorithm: string, _key: string | Buffer | Uint8Array, _iv: string | Buffer | Uint8Array | null): any {
  notImplemented('createCipheriv');
}

export function createDecipher(_algorithm: string, _password: string | Buffer | Uint8Array): any {
  notImplemented('createDecipher');
}

export function createDecipheriv(_algorithm: string, _key: string | Buffer | Uint8Array, _iv: string | Buffer | Uint8Array | null): any {
  notImplemented('createDecipheriv');
}

export function getCiphers(): string[] {
  return [
    'aes-128-cbc', 'aes-128-ecb', 'aes-192-cbc', 'aes-192-ecb',
    'aes-256-cbc', 'aes-256-ecb', 'aes-128-ctr', 'aes-192-ctr', 'aes-256-ctr',
    'aes-128-cfb', 'aes-192-cfb', 'aes-256-cfb',
    'des-cbc', 'des-ecb', 'des-ede3-cbc', 'des-ede3',
  ];
}
