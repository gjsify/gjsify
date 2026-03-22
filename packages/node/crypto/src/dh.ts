// Diffie-Hellman key exchange wrapper around diffie-hellman (pure-JS)
// Reference: Node.js lib/internal/crypto/diffiehellman.js
//
// Uses lazy loading to avoid circular dependency.

let _dhMod: any = null;

function getDhModule() {
  if (!_dhMod) {
    // @ts-ignore — diffie-hellman has no types
    _dhMod = require('diffie-hellman/browser');
  }
  return _dhMod;
}

/**
 * Creates a DiffieHellman key exchange object.
 */
export function createDiffieHellman(
  prime: number | string | Buffer | Uint8Array,
  primeEncoding?: BufferEncoding | number,
  generator?: number | string | Buffer | Uint8Array,
  generatorEncoding?: BufferEncoding
): any {
  return getDhModule().createDiffieHellman(prime as any, primeEncoding as any, generator as any, generatorEncoding as any);
}

/**
 * Returns a predefined DiffieHellman key exchange object for the given group.
 */
export function getDiffieHellman(groupName: string): any {
  return getDhModule().getDiffieHellman(groupName);
}
