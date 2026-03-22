// Diffie-Hellman key exchange wrapper around diffie-hellman (pure-JS)
// Reference: Node.js lib/internal/crypto/diffiehellman.js

// @ts-ignore — diffie-hellman has no types
import { createDiffieHellman as _createDiffieHellman, getDiffieHellman as _getDiffieHellman } from 'diffie-hellman';

/**
 * Creates a DiffieHellman key exchange object.
 */
export function createDiffieHellman(
  prime: number | string | Buffer | Uint8Array,
  primeEncoding?: BufferEncoding | number,
  generator?: number | string | Buffer | Uint8Array,
  generatorEncoding?: BufferEncoding
): any {
  return _createDiffieHellman(prime as any, primeEncoding as any, generator as any, generatorEncoding as any);
}

/**
 * Returns a predefined DiffieHellman key exchange object for the given group.
 */
export function getDiffieHellman(groupName: string): any {
  return _getDiffieHellman(groupName);
}
