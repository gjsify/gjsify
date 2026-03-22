// ECDH (Elliptic Curve Diffie-Hellman) wrapper around create-ecdh (pure-JS)
// Reference: Node.js lib/internal/crypto/diffiehellman.js
//
// Uses lazy loading to avoid circular dependency.

let _ecdhMod: any = null;

function getEcdhModule() {
  if (!_ecdhMod) {
    // @ts-ignore — create-ecdh has no types
    _ecdhMod = require('create-ecdh/browser');
  }
  return _ecdhMod;
}

/**
 * Creates an Elliptic Curve Diffie-Hellman key exchange object.
 */
export function createECDH(curveName: string): any {
  return getEcdhModule()(curveName);
}

/**
 * Returns the list of supported EC curve names.
 */
export function getCurves(): string[] {
  return [
    'secp256k1', 'secp224r1', 'secp192k1', 'secp192r1',
    'secp256r1', 'secp384r1', 'secp521r1',
    'prime192v1', 'prime256v1',
  ];
}
