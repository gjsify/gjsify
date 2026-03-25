// ECDSA (Elliptic Curve Digital Signature Algorithm) for GJS
// Implements RFC 6979 (deterministic k) + FIPS 186-4 signature generation/verification
// Reference: refs/node/lib/internal/crypto/sig.js
// Copyright (c) Node.js contributors. MIT license.
// Reimplemented for GJS using BigInt elliptic curve arithmetic from ecdh.ts

import { Buffer } from 'buffer';
import { Hash } from './hash.js';
import { Hmac } from './hmac.js';
import {
  mod, modInverse, scalarMul, pointAdd,
  CURVES, CURVE_ALIASES,
  type ECPoint, type CurveParams,
} from './ecdh.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bigintToBytes(n: bigint, len: number): Uint8Array {
  const hex = n.toString(16).padStart(len * 2, '0');
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToBigint(bytes: Uint8Array): bigint {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex.length > 0 ? BigInt('0x' + hex) : 0n;
}

function getCurve(curveName: string): CurveParams {
  const alias = CURVE_ALIASES[curveName.toLowerCase()];
  if (!alias) throw new Error(`Unsupported curve: ${curveName}`);
  return CURVES[alias];
}

/** Truncate hash to curve order bit length (FIPS 186-4 Section 6.4) */
function truncateHash(hash: Uint8Array, curve: CurveParams): bigint {
  const orderBits = curve.n.toString(2).length;
  let e = bytesToBigint(hash);
  const hashBits = hash.length * 8;
  if (hashBits > orderBits) {
    e >>= BigInt(hashBits - orderBits);
  }
  return e;
}

// ---------------------------------------------------------------------------
// RFC 6979 — Deterministic k generation via HMAC-DRBG
// ---------------------------------------------------------------------------

function hmacDigest(algo: string, key: Uint8Array, data: Uint8Array): Uint8Array {
  const hmac = new Hmac(algo, key);
  hmac.update(data);
  return new Uint8Array(hmac.digest() as any);
}

/**
 * Generate deterministic k per RFC 6979 Section 3.2.
 * Uses HMAC-DRBG seeded with private key and message hash.
 */
function rfc6979(
  hashAlgo: string,
  privKey: bigint,
  msgHash: Uint8Array,
  curve: CurveParams,
): bigint {
  const qLen = curve.byteLength;
  const hLen = msgHash.length;

  // Step a: h1 = H(m) — already provided as msgHash
  // Step b: V = 0x01 * hLen
  let V: any = new Uint8Array(hLen).fill(0x01);
  // Step c: K = 0x00 * hLen
  let K: any = new Uint8Array(hLen).fill(0x00);

  // int2octets(x) — private key as fixed-length big-endian bytes
  const x = bigintToBytes(privKey, qLen);
  // bits2octets(h1) — truncate hash to curve order, then encode
  const z = bigintToBytes(mod(truncateHash(msgHash, curve), curve.n), qLen);

  // Step d: K = HMAC_K(V || 0x00 || int2octets(x) || bits2octets(h1))
  const concat0 = new Uint8Array(hLen + 1 + qLen + qLen);
  concat0.set(V, 0);
  concat0[hLen] = 0x00;
  concat0.set(x, hLen + 1);
  concat0.set(z, hLen + 1 + qLen);
  K = hmacDigest(hashAlgo, K, concat0);

  // Step e: V = HMAC_K(V)
  V = hmacDigest(hashAlgo, K, V);

  // Step f: K = HMAC_K(V || 0x01 || int2octets(x) || bits2octets(h1))
  const concat1 = new Uint8Array(hLen + 1 + qLen + qLen);
  concat1.set(V, 0);
  concat1[hLen] = 0x01;
  concat1.set(x, hLen + 1);
  concat1.set(z, hLen + 1 + qLen);
  K = hmacDigest(hashAlgo, K, concat1);

  // Step g: V = HMAC_K(V)
  V = hmacDigest(hashAlgo, K, V);

  // Step h: Generate k candidates
  for (let attempt = 0; attempt < 100; attempt++) {
    // Step h.1–h.2: Generate T by concatenating HMAC_K(V) blocks
    let T: any = new Uint8Array(0);
    while (T.length < qLen) {
      V = hmacDigest(hashAlgo, K, V);
      const newT = new Uint8Array(T.length + V.length);
      newT.set(T, 0);
      newT.set(V, T.length);
      T = newT;
    }

    // Step h.3: k = bits2int(T)
    const k = truncateHash(T.slice(0, qLen), curve);

    // Check: 1 <= k < n
    if (k >= 1n && k < curve.n) {
      return k;
    }

    // h.3 retry: K = HMAC_K(V || 0x00), V = HMAC_K(V)
    const retryConcat = new Uint8Array(hLen + 1);
    retryConcat.set(V, 0);
    retryConcat[hLen] = 0x00;
    K = hmacDigest(hashAlgo, K, retryConcat);
    V = hmacDigest(hashAlgo, K, V);
  }

  throw new Error('RFC 6979: failed to generate valid k after 100 attempts');
}

// ---------------------------------------------------------------------------
// ECDSA Sign
// ---------------------------------------------------------------------------

/**
 * ECDSA signature generation per FIPS 186-4 Section 6.4.
 *
 * @param hashAlgo Hash algorithm name (e.g. 'sha256')
 * @param privKeyBytes Private key as big-endian bytes
 * @param data Data to sign (will be hashed)
 * @param curveName Curve name (e.g. 'P-256')
 * @returns Signature as r || s concatenated (each curve.byteLength bytes)
 */
export function ecdsaSign(
  hashAlgo: string,
  privKeyBytes: Uint8Array,
  data: Uint8Array,
  curveName: string,
): Uint8Array {
  const curve = getCurve(curveName);
  const G: ECPoint = { x: curve.Gx, y: curve.Gy };
  const d = bytesToBigint(privKeyBytes);

  // Hash the message
  const hash = new Hash(hashAlgo);
  hash.update(data);
  const msgHash = new Uint8Array(hash.digest() as any);

  // Truncate hash to curve order bit length
  const e = truncateHash(msgHash, curve);

  // Generate deterministic k via RFC 6979
  const k = rfc6979(hashAlgo, d, msgHash, curve);

  // R = k * G
  const R = scalarMul(k, G, curve);
  if (R === null) throw new Error('ECDSA: k * G is point at infinity');

  // r = R.x mod n
  const r = mod(R.x, curve.n);
  if (r === 0n) throw new Error('ECDSA: r is zero');

  // s = k^-1 * (e + r * d) mod n
  const kInv = modInverse(k, curve.n);
  const s = mod(kInv * (e + r * d), curve.n);
  if (s === 0n) throw new Error('ECDSA: s is zero');

  // Encode as r || s (fixed-length concatenation)
  const sigLen = curve.byteLength;
  const sig = new Uint8Array(sigLen * 2);
  sig.set(bigintToBytes(r, sigLen), 0);
  sig.set(bigintToBytes(s, sigLen), sigLen);
  return sig;
}

// ---------------------------------------------------------------------------
// ECDSA Verify
// ---------------------------------------------------------------------------

/**
 * ECDSA signature verification per FIPS 186-4 Section 6.4.
 *
 * @param hashAlgo Hash algorithm name (e.g. 'sha256')
 * @param pubKeyBytes Public key as uncompressed point (0x04 || x || y)
 * @param signature Signature as r || s concatenated
 * @param data Signed data (will be hashed)
 * @param curveName Curve name (e.g. 'P-256')
 * @returns true if signature is valid
 */
export function ecdsaVerify(
  hashAlgo: string,
  pubKeyBytes: Uint8Array,
  signature: Uint8Array,
  data: Uint8Array,
  curveName: string,
): boolean {
  const curve = getCurve(curveName);
  const G: ECPoint = { x: curve.Gx, y: curve.Gy };
  const sigLen = curve.byteLength;

  // Parse public key (uncompressed: 0x04 || x || y)
  if (pubKeyBytes[0] !== 0x04 || pubKeyBytes.length !== 1 + sigLen * 2) {
    return false; // Only uncompressed point format supported
  }
  const Qx = bytesToBigint(pubKeyBytes.slice(1, 1 + sigLen));
  const Qy = bytesToBigint(pubKeyBytes.slice(1 + sigLen));
  const Q: ECPoint = { x: Qx, y: Qy };

  // Parse signature (r || s)
  if (signature.length !== sigLen * 2) return false;
  const r = bytesToBigint(signature.slice(0, sigLen));
  const s = bytesToBigint(signature.slice(sigLen));

  // Check: 1 <= r < n, 1 <= s < n
  if (r < 1n || r >= curve.n || s < 1n || s >= curve.n) return false;

  // Hash the message
  const hash = new Hash(hashAlgo);
  hash.update(data);
  const msgHash = new Uint8Array(hash.digest() as any);
  const e = truncateHash(msgHash, curve);

  // w = s^-1 mod n
  const w = modInverse(s, curve.n);

  // u1 = e * w mod n, u2 = r * w mod n
  const u1 = mod(e * w, curve.n);
  const u2 = mod(r * w, curve.n);

  // R' = u1 * G + u2 * Q
  const R1 = scalarMul(u1, G, curve);
  const R2 = scalarMul(u2, Q, curve);
  const R = pointAdd(R1, R2, curve);

  if (R === null) return false;

  // Check: r === R'.x mod n
  return mod(R.x, curve.n) === r;
}
