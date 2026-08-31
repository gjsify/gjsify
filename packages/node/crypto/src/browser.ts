// SPDX-License-Identifier: MIT
// Reimplemented for @gjsify browser target — inspired by crypto-browserify
// (Calvin Metcalf + browserify contributors, MIT) and aligned with WebCrypto
// (W3C). Sync APIs that have no WebCrypto equivalent throw ENOTSUP; the
// async variants are preferred.
//
// Slot is "browser:partial": WebCrypto covers hash / hmac / cipher / sign /
// random / pbkdf2 / hkdf, and ECDH is provided by a pure-BigInt EC backend
// (`browser/ecdh.ts`, no native dep). Classic DH, scrypt, RSA encrypt/decrypt,
// X509 and the sync digest paths throw ENOTSUP. Caller-facing throws live in
// `browser/stubs.ts` and
// the per-feature sub-modules under `browser/`; the audit-runtimes heuristic
// only scans this entry file for the slot marker, hence the explicit note.
//
// Reference: refs/crypto-browserify/* (+ sub-refs: hash-base, create-hash,
// create-hmac, randombytes, randomfill, pbkdf2, browserify-cipher,
// browserify-sign, create-ecdh, diffie-hellman, public-encrypt).
//
// This file is the browser entry point selected by the package's `"browser"`
// field + `exports."."` `"browser"` condition (Rolldown/Vite browser builds
// honour both via `mainFields:['browser','module','main']` and
// `conditionNames:['import','browser']`).
//
// Strategy: WebCrypto-first. Sync APIs that can't be expressed via WebCrypto
// throw a structured ENOTSUP error pointing at the async variant; classic DH
// and similar APIs without WebCrypto pendants throw ENOTSUP unconditionally.

import type { Buffer } from 'node:buffer';

// ─── WebCrypto re-export ────────────────────────────────────────────────────
// Browser-native `crypto.webcrypto` + `crypto.subtle` — Node's `crypto` module
// exposes `crypto.webcrypto` as a `Crypto` instance, and `crypto.subtle` as
// a `SubtleCrypto`. In the browser they are `globalThis.crypto` directly.

export const webcrypto: Crypto = globalThis.crypto;
export const subtle: SubtleCrypto = globalThis.crypto.subtle;

// ─── Constants ──────────────────────────────────────────────────────────────

export { constants } from './constants.js';

// ─── Random ─────────────────────────────────────────────────────────────────

export { randomBytes, randomFill, randomFillSync, randomUUID, randomInt } from './browser/random.js';

// ─── Hash + HMAC ────────────────────────────────────────────────────────────

export { Hash, createHash, getHashes, hash } from './browser/hash.js';
export { Hmac, createHmac } from './browser/hmac.js';

// ─── KDF (PBKDF2 / HKDF / scrypt) ───────────────────────────────────────────

export { pbkdf2, pbkdf2Sync, hkdf, hkdfSync, scrypt, scryptSync } from './browser/kdf.js';

// ─── Cipher / Decipher ──────────────────────────────────────────────────────

export {
    Cipher,
    Decipher,
    createCipher,
    createCipheriv,
    createDecipher,
    createDecipheriv,
    getCiphers,
} from './browser/cipher.js';

// ─── Sign / Verify ──────────────────────────────────────────────────────────

export { Sign, Verify, createSign, createVerify, sign, verify } from './browser/sign.js';

// ─── ECDH (pure-BigInt EC arithmetic — no native dep, sync API) ──────────────

export { createECDH, getCurves } from './browser/ecdh.js';

// ─── Stubs (DH, RSA, KeyObject, X509Certificate, generateKey*) ──────────────

export {
    createDiffieHellman,
    getDiffieHellman,
    DiffieHellman,
    DiffieHellmanGroup,
    createDiffieHellmanGroup,
    ecdsaSign,
    ecdsaVerify,
    publicEncrypt,
    privateDecrypt,
    privateEncrypt,
    publicDecrypt,
    rsaPssSign,
    rsaPssVerify,
    rsaOaepEncrypt,
    rsaOaepDecrypt,
    mgf1,
    KeyObject,
    createSecretKey,
    createPublicKey,
    createPrivateKey,
    generateKeyPair,
    generateKeyPairSync,
    generateKey,
    X509Certificate,
} from './browser/stubs.js';

// ─── timing-safe comparison ─────────────────────────────────────────────────
// Pure-TS, identical to the GJS implementation — no platform deps.

export { timingSafeEqual } from './timing-safe-equal.js';

// ─── Default export — mirror of named exports, matching the GJS index.ts ──

import { constants } from './constants.js';
import { randomBytes, randomFill, randomFillSync, randomUUID, randomInt } from './browser/random.js';
import { Hash, createHash, getHashes, hash } from './browser/hash.js';
import { Hmac, createHmac } from './browser/hmac.js';
import { pbkdf2, pbkdf2Sync, hkdf, hkdfSync, scrypt, scryptSync } from './browser/kdf.js';
import {
    Cipher,
    Decipher,
    createCipher,
    createCipheriv,
    createDecipher,
    createDecipheriv,
    getCiphers,
} from './browser/cipher.js';
import { Sign, Verify, createSign, createVerify, sign, verify } from './browser/sign.js';
import { createECDH, getCurves } from './browser/ecdh.js';
import {
    createDiffieHellman,
    getDiffieHellman,
    DiffieHellman,
    DiffieHellmanGroup,
    createDiffieHellmanGroup,
    ecdsaSign,
    ecdsaVerify,
    publicEncrypt,
    privateDecrypt,
    privateEncrypt,
    publicDecrypt,
    rsaPssSign,
    rsaPssVerify,
    rsaOaepEncrypt,
    rsaOaepDecrypt,
    mgf1,
    KeyObject,
    createSecretKey,
    createPublicKey,
    createPrivateKey,
    generateKeyPair,
    generateKeyPairSync,
    generateKey,
    X509Certificate,
} from './browser/stubs.js';
import { timingSafeEqual } from './timing-safe-equal.js';

// Re-export Buffer to silence "unused import" — Buffer is used transitively
// by the consumers but TypeScript needs the import statement to keep the
// type-only references resolvable at build time on browser targets.
export type { Buffer };

export default {
    webcrypto,
    subtle,
    constants,
    randomBytes,
    randomFill,
    randomFillSync,
    randomUUID,
    randomInt,
    Hash,
    createHash,
    getHashes,
    hash,
    Hmac,
    createHmac,
    pbkdf2,
    pbkdf2Sync,
    hkdf,
    hkdfSync,
    scrypt,
    scryptSync,
    Cipher,
    Decipher,
    createCipher,
    createCipheriv,
    createDecipher,
    createDecipheriv,
    getCiphers,
    Sign,
    Verify,
    createSign,
    createVerify,
    sign,
    verify,
    createDiffieHellman,
    getDiffieHellman,
    DiffieHellman,
    DiffieHellmanGroup,
    createDiffieHellmanGroup,
    createECDH,
    getCurves,
    ecdsaSign,
    ecdsaVerify,
    publicEncrypt,
    privateDecrypt,
    privateEncrypt,
    publicDecrypt,
    rsaPssSign,
    rsaPssVerify,
    rsaOaepEncrypt,
    rsaOaepDecrypt,
    mgf1,
    KeyObject,
    createSecretKey,
    createPublicKey,
    createPrivateKey,
    generateKeyPair,
    generateKeyPairSync,
    generateKey,
    X509Certificate,
    timingSafeEqual,
};
