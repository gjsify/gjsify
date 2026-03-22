// Sign/Verify wrappers around browserify-sign (pure-JS RSA/ECDSA)
// Reference: Node.js lib/internal/crypto/sig.js

// @ts-ignore — browserify-sign has no types
import browserifySign from 'browserify-sign';

const {
  createSign: _createSign,
  createVerify: _createVerify,
} = browserifySign;

/**
 * Creates and returns a Sign object using the given algorithm.
 */
export function createSign(algorithm: string): any {
  return _createSign(algorithm);
}

/**
 * Creates and returns a Verify object using the given algorithm.
 */
export function createVerify(algorithm: string): any {
  return _createVerify(algorithm);
}
