// ECDH — stub pending native TypeScript reimplementation
// TODO: Reimplement ECDH using refs/create-ecdh as reference

function notImplemented(name: string): never {
  throw new Error(`crypto.${name}() is not yet implemented for GJS. See refs/create-ecdh/ for reference.`);
}

export function createECDH(_curveName: string): any {
  notImplemented('createECDH');
}

export function getCurves(): string[] {
  return [
    'secp256k1', 'secp224r1', 'secp192k1', 'secp192r1',
    'secp256r1', 'secp384r1', 'secp521r1',
    'prime192v1', 'prime256v1',
  ];
}
