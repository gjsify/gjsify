// RSA-PSS (Probabilistic Signature Scheme) per RFC 8017 Section 8.1
// Reference: refs/node/lib/internal/crypto/sig.js
// Copyright (c) Node.js contributors. MIT license.
// Reimplemented for GJS using BigInt RSA math

import { createHash } from './hash.js';
import { randomBytes } from './random.js';
import { mgf1 } from './mgf1.js';
import { parsePemKey, rsaKeySize } from './asn1.js';
import type { RsaPrivateComponents, RsaPublicComponents } from './asn1.js';

// ---------------------------------------------------------------------------
// RSA math (shared with sign.ts)
// ---------------------------------------------------------------------------

function modPow(base: bigint, exp: bigint, m: bigint): bigint {
  if (m === 1n) return 0n;
  base = ((base % m) + m) % m;
  let result = 1n;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % m;
    exp >>= 1n;
    base = (base * base) % m;
  }
  return result;
}

function bigIntToBytes(value: bigint, length: number): Uint8Array {
  const result = new Uint8Array(length);
  let v = value;
  for (let i = length - 1; i >= 0; i--) {
    result[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return result;
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let result = 0n;
  for (const b of bytes) result = (result << 8n) | BigInt(b);
  return result;
}

function hashSize(algo: string): number {
  switch (algo.toLowerCase().replace(/-/g, '')) {
    case 'sha1': return 20;
    case 'sha256': return 32;
    case 'sha384': return 48;
    case 'sha512': return 64;
    default: throw new Error(`Unknown hash: ${algo}`);
  }
}

function hashDigest(algo: string, data: Uint8Array): Uint8Array {
  const h = createHash(algo);
  h.update(data);
  return new Uint8Array(h.digest());
}

// ---------------------------------------------------------------------------
// EMSA-PSS-ENCODE (RFC 8017 Section 9.1.1)
// ---------------------------------------------------------------------------

function emsaPssEncode(
  mHash: Uint8Array,
  emBits: number,
  hashAlgo: string,
  saltLength: number,
): Uint8Array {
  const hLen = hashSize(hashAlgo);
  const emLen = Math.ceil(emBits / 8);

  if (emLen < hLen + saltLength + 2) {
    throw new Error('RSA-PSS: encoding error — key too short');
  }

  const salt = saltLength > 0 ? new Uint8Array(randomBytes(saltLength)) : new Uint8Array(0);

  // M' = (0x)00 00 00 00 00 00 00 00 || mHash || salt
  const mPrime = new Uint8Array(8 + hLen + saltLength);
  mPrime.set(mHash, 8);
  mPrime.set(salt, 8 + hLen);

  const H = hashDigest(hashAlgo, mPrime);

  // DB = PS || 0x01 || salt (PS = zero bytes of length emLen - hLen - saltLength - 2)
  const dbLen = emLen - hLen - 1;
  const DB = new Uint8Array(dbLen);
  DB[dbLen - saltLength - 1] = 0x01;
  DB.set(salt, dbLen - saltLength);

  // dbMask = MGF(H, emLen - hLen - 1)
  const dbMask = mgf1(hashAlgo, H, dbLen);

  // maskedDB = DB ⊕ dbMask
  const maskedDB = new Uint8Array(dbLen);
  for (let i = 0; i < dbLen; i++) maskedDB[i] = DB[i] ^ dbMask[i];

  // Set leftmost (8*emLen - emBits) bits of maskedDB to zero
  const zeroBits = 8 * emLen - emBits;
  if (zeroBits > 0) maskedDB[0] &= (0xff >>> zeroBits);

  // EM = maskedDB || H || 0xbc
  const EM = new Uint8Array(emLen);
  EM.set(maskedDB, 0);
  EM.set(H, dbLen);
  EM[emLen - 1] = 0xbc;

  return EM;
}

// ---------------------------------------------------------------------------
// EMSA-PSS-VERIFY (RFC 8017 Section 9.1.2)
// ---------------------------------------------------------------------------

function emsaPssVerify(
  mHash: Uint8Array,
  EM: Uint8Array,
  emBits: number,
  hashAlgo: string,
  saltLength: number,
): boolean {
  const hLen = hashSize(hashAlgo);
  const emLen = Math.ceil(emBits / 8);

  if (emLen < hLen + saltLength + 2) return false;
  if (EM[emLen - 1] !== 0xbc) return false;

  const dbLen = emLen - hLen - 1;
  const maskedDB = EM.slice(0, dbLen);
  const H = EM.slice(dbLen, dbLen + hLen);

  // Check leftmost bits
  const zeroBits = 8 * emLen - emBits;
  if (zeroBits > 0 && (maskedDB[0] & (0xff << (8 - zeroBits))) !== 0) return false;

  // dbMask = MGF(H, dbLen)
  const dbMask = mgf1(hashAlgo, H, dbLen);

  // DB = maskedDB ⊕ dbMask
  const DB = new Uint8Array(dbLen);
  for (let i = 0; i < dbLen; i++) DB[i] = maskedDB[i] ^ dbMask[i];

  // Zero leftmost bits
  if (zeroBits > 0) DB[0] &= (0xff >>> zeroBits);

  // Check PS: DB[0..dbLen-saltLength-2] should all be 0x00
  for (let i = 0; i < dbLen - saltLength - 1; i++) {
    if (DB[i] !== 0x00) return false;
  }
  if (DB[dbLen - saltLength - 1] !== 0x01) return false;

  const salt = DB.slice(dbLen - saltLength);

  // M' = (0x)00 00 00 00 00 00 00 00 || mHash || salt
  const mPrime = new Uint8Array(8 + hLen + saltLength);
  mPrime.set(mHash, 8);
  mPrime.set(salt, 8 + hLen);

  const HPrime = hashDigest(hashAlgo, mPrime);

  // Compare H and H'
  if (H.length !== HPrime.length) return false;
  let diff = 0;
  for (let i = 0; i < H.length; i++) diff |= H[i] ^ HPrime[i];
  return diff === 0;
}

// ---------------------------------------------------------------------------
// RSA-PSS Sign / Verify (operating on raw BigInt components)
// ---------------------------------------------------------------------------

/**
 * RSA-PSS sign using PEM private key.
 */
export function rsaPssSign(
  hashAlgo: string,
  privKeyPem: string,
  data: Uint8Array,
  saltLength: number,
): Uint8Array {
  const parsed = parsePemKey(privKeyPem);
  if (parsed.type !== 'rsa-private') throw new Error('RSA-PSS: expected RSA private key');
  const { n, d } = parsed.components as RsaPrivateComponents;

  const keyBits = rsaKeySize(n);
  const keyBytes = Math.ceil(keyBits / 8);

  const mHash = hashDigest(hashAlgo, data);
  const EM = emsaPssEncode(mHash, keyBits - 1, hashAlgo, saltLength);

  // RSASP1: s = EM^d mod n
  const m = bytesToBigInt(EM);
  const s = modPow(m, d, n);
  return bigIntToBytes(s, keyBytes);
}

/**
 * RSA-PSS verify using PEM public key.
 */
export function rsaPssVerify(
  hashAlgo: string,
  pubKeyPem: string,
  signature: Uint8Array,
  data: Uint8Array,
  saltLength: number,
): boolean {
  const parsed = parsePemKey(pubKeyPem);
  let n: bigint, e: bigint;
  if (parsed.type === 'rsa-public') {
    ({ n, e } = parsed.components as RsaPublicComponents);
  } else if (parsed.type === 'rsa-private') {
    ({ n, e } = parsed.components as RsaPrivateComponents);
  } else {
    throw new Error('RSA-PSS: expected RSA key');
  }

  const keyBits = rsaKeySize(n);
  const keyBytes = Math.ceil(keyBits / 8);

  if (signature.length !== keyBytes) return false;

  // RSAVP1: m = s^e mod n
  const s = bytesToBigInt(signature);
  const m = modPow(s, e, n);
  const EM = bigIntToBytes(m, Math.ceil((keyBits - 1) / 8));

  const mHash = hashDigest(hashAlgo, data);
  return emsaPssVerify(mHash, EM, keyBits - 1, hashAlgo, saltLength);
}
