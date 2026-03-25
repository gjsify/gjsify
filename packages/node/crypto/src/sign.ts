// Sign/Verify — RSA PKCS#1 v1.5 signature scheme for GJS
// Reference: refs/browserify-sign/browser/sign.js, refs/browserify-sign/browser/verify.js
// Reimplemented for GJS using native BigInt (ES2024)

import { Buffer } from 'node:buffer';
import { Hash } from './hash.js';
import { parsePemKey, rsaKeySize } from './asn1.js';
import type { RsaPrivateComponents, RsaPublicComponents } from './asn1.js';
import { modPow, bigIntToBytes, bytesToBigInt } from './bigint-math.js';

// ============================================================================
// PKCS#1 v1.5 DigestInfo structures
// ============================================================================

/**
 * DigestInfo DER prefix bytes for each supported hash algorithm.
 * These encode: SEQUENCE { SEQUENCE { OID hashAlg, NULL }, OCTET STRING hashValue }
 * excluding the actual hash value at the end.
 */
const DIGEST_INFO_PREFIX: Record<string, Uint8Array> = {
  sha1: new Uint8Array([
    0x30, 0x21, 0x30, 0x09, 0x06, 0x05,
    0x2b, 0x0e, 0x03, 0x02, 0x1a,
    0x05, 0x00, 0x04, 0x14,
  ]),
  sha256: new Uint8Array([
    0x30, 0x31, 0x30, 0x0d, 0x06, 0x09,
    0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01,
    0x05, 0x00, 0x04, 0x20,
  ]),
  sha512: new Uint8Array([
    0x30, 0x51, 0x30, 0x0d, 0x06, 0x09,
    0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x03,
    0x05, 0x00, 0x04, 0x40,
  ]),
};

// ============================================================================
// Algorithm normalization
// ============================================================================

/**
 * Normalize algorithm strings like "RSA-SHA256", "SHA256", "sha256" to
 * the canonical hash name used internally (e.g. "sha256").
 */
function normalizeSignAlgorithm(algorithm: string): string {
  let alg = algorithm.toLowerCase().replace(/-/g, '');
  // Strip leading "rsa" prefix (e.g., "rsasha256" -> "sha256")
  if (alg.startsWith('rsa')) {
    alg = alg.slice(3);
  }
  if (!DIGEST_INFO_PREFIX[alg]) {
    throw new Error(`Unsupported algorithm: ${algorithm}. Supported: RSA-SHA1, RSA-SHA256, RSA-SHA512`);
  }
  return alg;
}

// ============================================================================
// Key extraction helpers
// ============================================================================

interface KeyInput {
  key: string;
  passphrase?: string;
  padding?: number;
}

function extractPem(key: string | Buffer | KeyInput): string {
  if (typeof key === 'string') {
    return key;
  }
  if (Buffer.isBuffer(key) || key instanceof Uint8Array) {
    return Buffer.from(key).toString('utf8');
  }
  if (key && typeof key === 'object' && 'key' in key) {
    const k = key.key;
    if (typeof k === 'string') return k;
    if (Buffer.isBuffer(k) || (k as unknown) instanceof Uint8Array) return Buffer.from(k as Uint8Array).toString('utf8');
  }
  throw new TypeError('Invalid key argument');
}

// ============================================================================
// Sign class
// ============================================================================

/**
 * The Sign class generates RSA PKCS#1 v1.5 signatures.
 *
 * Usage:
 *   const sign = createSign('RSA-SHA256');
 *   sign.update('data');
 *   const signature = sign.sign(privateKey);
 */
export class Sign {
  private _algorithm: string;
  private _hash: Hash;
  private _finalized = false;

  constructor(algorithm: string) {
    this._algorithm = normalizeSignAlgorithm(algorithm);
    this._hash = new Hash(this._algorithm);
  }

  /**
   * Update the Sign object with the given data.
   */
  update(data: string | Buffer | Uint8Array, inputEncoding?: BufferEncoding): this {
    if (this._finalized) {
      throw new Error('Sign was already finalized');
    }
    this._hash.update(data, inputEncoding);
    return this;
  }

  /**
   * Compute the signature using the private key.
   * Returns the signature as a Buffer (or string if outputEncoding is given).
   */
  sign(privateKey: string | Buffer | KeyInput, outputEncoding?: BufferEncoding): Buffer | string {
    if (this._finalized) {
      throw new Error('Sign was already finalized');
    }
    this._finalized = true;

    // Hash the accumulated data
    const digest = this._hash.digest() as Buffer;

    // Parse the private key
    const pem = extractPem(privateKey);
    const parsed = parsePemKey(pem);
    if (parsed.type !== 'rsa-private') {
      throw new Error('privateKey must be an RSA private key');
    }
    const { n, e, d } = parsed.components;
    const keyLen = rsaKeySize(n);

    // Build DigestInfo = prefix || hash
    const prefix = DIGEST_INFO_PREFIX[this._algorithm];
    const digestInfo = new Uint8Array(prefix.length + digest.length);
    digestInfo.set(prefix, 0);
    digestInfo.set(digest, prefix.length);

    // Apply PKCS#1 v1.5 Type 1 padding
    // 0x00 0x01 [0xFF padding] 0x00 [DigestInfo]
    const padLen = keyLen - digestInfo.length - 3;
    if (padLen < 8) {
      throw new Error('Key is too short for the specified hash algorithm');
    }

    const em = new Uint8Array(keyLen);
    em[0] = 0x00;
    em[1] = 0x01;
    for (let i = 2; i < 2 + padLen; i++) {
      em[i] = 0xff;
    }
    em[2 + padLen] = 0x00;
    em.set(digestInfo, 3 + padLen);

    // RSA private key operation: signature = em^d mod n
    const m = bytesToBigInt(em);
    const s = modPow(m, d, n);
    const sigBytes = bigIntToBytes(s, keyLen);
    const sigBuf = Buffer.from(sigBytes);

    if (outputEncoding) {
      return sigBuf.toString(outputEncoding);
    }
    return sigBuf;
  }
}

// ============================================================================
// Verify class
// ============================================================================

/**
 * The Verify class verifies RSA PKCS#1 v1.5 signatures.
 *
 * Usage:
 *   const verify = createVerify('RSA-SHA256');
 *   verify.update('data');
 *   const ok = verify.verify(publicKey, signature);
 */
export class Verify {
  private _algorithm: string;
  private _hash: Hash;
  private _finalized = false;

  constructor(algorithm: string) {
    this._algorithm = normalizeSignAlgorithm(algorithm);
    this._hash = new Hash(this._algorithm);
  }

  /**
   * Update the Verify object with the given data.
   */
  update(data: string | Buffer | Uint8Array, inputEncoding?: BufferEncoding): this {
    if (this._finalized) {
      throw new Error('Verify was already finalized');
    }
    this._hash.update(data, inputEncoding);
    return this;
  }

  /**
   * Verify the signature against the public key.
   * Returns true if the signature is valid, false otherwise.
   */
  verify(
    publicKey: string | Buffer | KeyInput,
    signature: string | Buffer | Uint8Array,
    signatureEncoding?: BufferEncoding,
  ): boolean {
    if (this._finalized) {
      throw new Error('Verify was already finalized');
    }
    this._finalized = true;

    // Hash the accumulated data
    const digest = this._hash.digest() as Buffer;

    // Parse the public key
    const pem = extractPem(publicKey);
    const parsed = parsePemKey(pem);

    let n: bigint;
    let e: bigint;
    if (parsed.type === 'rsa-public') {
      n = parsed.components.n;
      e = parsed.components.e;
    } else if (parsed.type === 'rsa-private') {
      // Allow using a private key for verification (extract public components)
      n = parsed.components.n;
      e = parsed.components.e;
    } else {
      throw new Error('publicKey must be an RSA public or private key');
    }

    const keyLen = rsaKeySize(n);

    // Decode the signature
    let sigBytes: Uint8Array;
    if (typeof signature === 'string') {
      sigBytes = Buffer.from(signature, signatureEncoding || 'base64');
    } else {
      sigBytes = signature instanceof Uint8Array ? signature : Buffer.from(signature);
    }

    if (sigBytes.length !== keyLen) {
      return false;
    }

    // RSA public key operation: em = signature^e mod n
    const s = bytesToBigInt(sigBytes);
    if (s >= n) {
      return false;
    }
    const m = modPow(s, e, n);
    const em = bigIntToBytes(m, keyLen);

    // Verify PKCS#1 v1.5 Type 1 padding structure
    // Expected: 0x00 0x01 [0xFF...] 0x00 [DigestInfo]
    if (em[0] !== 0x00 || em[1] !== 0x01) {
      return false;
    }

    // Find the 0x00 separator after the 0xFF padding
    let sepIdx = 2;
    while (sepIdx < em.length && em[sepIdx] === 0xff) {
      sepIdx++;
    }
    if (sepIdx >= em.length || em[sepIdx] !== 0x00) {
      return false;
    }
    // Must have at least 8 bytes of 0xFF padding
    if (sepIdx - 2 < 8) {
      return false;
    }
    sepIdx++; // skip the 0x00 separator

    // Extract DigestInfo from the decrypted message
    const recoveredDigestInfo = em.slice(sepIdx);

    // Build expected DigestInfo
    const prefix = DIGEST_INFO_PREFIX[this._algorithm];
    const expectedDigestInfo = new Uint8Array(prefix.length + digest.length);
    expectedDigestInfo.set(prefix, 0);
    expectedDigestInfo.set(digest, prefix.length);

    // Constant-time comparison
    if (recoveredDigestInfo.length !== expectedDigestInfo.length) {
      return false;
    }
    let diff = 0;
    for (let i = 0; i < recoveredDigestInfo.length; i++) {
      diff |= recoveredDigestInfo[i] ^ expectedDigestInfo[i];
    }
    return diff === 0;
  }
}

// ============================================================================
// Factory functions
// ============================================================================

/**
 * Create and return a Sign object for the given algorithm.
 */
export function createSign(algorithm: string): Sign {
  return new Sign(algorithm);
}

/**
 * Create and return a Verify object for the given algorithm.
 */
export function createVerify(algorithm: string): Verify {
  return new Verify(algorithm);
}
