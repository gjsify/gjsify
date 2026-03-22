// Sign/Verify wrappers around browserify-sign (pure-JS RSA/ECDSA)
// Reference: Node.js lib/internal/crypto/sig.js
//
// Uses lazy loading to avoid circular dependency.

let _signMod: any = null;

function getSignModule() {
  if (!_signMod) {
    // @ts-ignore — browserify-sign has no types
    _signMod = require('browserify-sign/browser');
  }
  return _signMod;
}

/**
 * Creates and returns a Sign object using the given algorithm.
 */
export function createSign(algorithm: string): any {
  return getSignModule().createSign(algorithm);
}

/**
 * Creates and returns a Verify object using the given algorithm.
 */
export function createVerify(algorithm: string): any {
  return getSignModule().createVerify(algorithm);
}
