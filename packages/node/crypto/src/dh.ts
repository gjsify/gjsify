// Diffie-Hellman — stub pending native TypeScript reimplementation
// TODO: Reimplement DH using refs/diffie-hellman as reference

function notImplemented(name: string): never {
  throw new Error(`crypto.${name}() is not yet implemented for GJS. See refs/diffie-hellman/ for reference.`);
}

export function createDiffieHellman(
  _prime: number | string | Buffer | Uint8Array,
  _primeEncoding?: BufferEncoding | number,
  _generator?: number | string | Buffer | Uint8Array,
  _generatorEncoding?: BufferEncoding
): any {
  notImplemented('createDiffieHellman');
}

export function getDiffieHellman(_groupName: string): any {
  notImplemented('getDiffieHellman');
}
