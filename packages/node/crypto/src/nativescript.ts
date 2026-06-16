// SPDX-License-Identifier: MIT
// NativeScript entry point for @gjsify/crypto.
//
// NativeScript V8 ships neither GLib (the GJS backend) nor crypto.subtle
// (the browser backend). This entry point selects the @noble/hashes-based
// pure-JS implementations for Hash and Hmac, the existing browser-compatible
// random module (NS does ship crypto.getRandomValues), and ENOTSUP stubs for
// everything that needs a native crypto backend.
//
// The package-level runtimes.nativescript slot stays "none" because the
// default entry (./index) uses GLib.Checksum (GJS-only); reach this backend
// explicitly via the "@gjsify/crypto/nativescript" subpath.
//   ✓ createHash — sha1, sha224, sha256, sha384, sha512, md5 (sync)
//   ✓ createHmac — all the above algorithms (sync)
//   ✓ randomBytes / randomFillSync / randomFill / randomUUID / randomInt
//   ✓ timingSafeEqual
//   ✓ constants
//   ✗ createCipheriv / createDecipheriv (ENOTSUP — requires AES native backend)
//   ✗ createDiffieHellman / createECDH (ENOTSUP)
//   ✗ createSign / createVerify (ENOTSUP)
//   ✗ pbkdf2 / hkdf / scrypt (ENOTSUP — future: wire @noble/hashes-based impls)
//   ✗ publicEncrypt / privateDecrypt (ENOTSUP)
//   ✗ KeyObject / X509Certificate (ENOTSUP)

// ─── Hash + HMAC (pure-JS, sync) ────────────────────────────────────────────

export { Hash, createHash, getHashes, hash } from './nativescript/hash.js';
export { Hmac, createHmac } from './nativescript/hmac.js';

// ─── Random (uses crypto.getRandomValues — available on NS V8) ──────────────
// browser/random.ts is pure-JS, uses only crypto.getRandomValues, and has no
// GLib or DOM dependency — safe to re-use on NativeScript.

export { randomBytes, randomFill, randomFillSync, randomUUID, randomInt } from './browser/random.js';

// ─── Timing-safe equal (pure-JS) ────────────────────────────────────────────

export { timingSafeEqual } from './timing-safe-equal.js';

// ─── Constants ──────────────────────────────────────────────────────────────

export { constants } from './constants.js';

// ─── ENOTSUP stubs for native-backend-dependent APIs ────────────────────────

export {
    createCipher,
    createCipheriv,
    createDecipher,
    createDecipheriv,
    getCiphers,
    createDiffieHellman,
    getDiffieHellman,
    DiffieHellman,
    DiffieHellmanGroup,
    createDiffieHellmanGroup,
    createECDH,
    getCurves,
    createSign,
    createVerify,
    Sign,
    Verify,
    sign,
    verify,
    pbkdf2,
    pbkdf2Sync,
    hkdf,
    hkdfSync,
    scrypt,
    scryptSync,
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
    X509Certificate,
} from './nativescript/stubs.js';

// ─── Default export ──────────────────────────────────────────────────────────

import { Hash, createHash, getHashes, hash } from './nativescript/hash.js';
import { Hmac, createHmac } from './nativescript/hmac.js';
import { randomBytes, randomFill, randomFillSync, randomUUID, randomInt } from './browser/random.js';
import { timingSafeEqual } from './timing-safe-equal.js';
import { constants } from './constants.js';
import {
    createCipher,
    createCipheriv,
    createDecipher,
    createDecipheriv,
    getCiphers,
    createDiffieHellman,
    getDiffieHellman,
    DiffieHellman,
    DiffieHellmanGroup,
    createDiffieHellmanGroup,
    createECDH,
    getCurves,
    createSign,
    createVerify,
    Sign,
    Verify,
    sign,
    verify,
    pbkdf2,
    pbkdf2Sync,
    hkdf,
    hkdfSync,
    scrypt,
    scryptSync,
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
    X509Certificate,
} from './nativescript/stubs.js';

export default {
    Hash,
    createHash,
    getHashes,
    hash,
    Hmac,
    createHmac,
    randomBytes,
    randomFill,
    randomFillSync,
    randomUUID,
    randomInt,
    timingSafeEqual,
    constants,
    createCipher,
    createCipheriv,
    createDecipher,
    createDecipheriv,
    getCiphers,
    createDiffieHellman,
    getDiffieHellman,
    DiffieHellman,
    DiffieHellmanGroup,
    createDiffieHellmanGroup,
    createECDH,
    getCurves,
    createSign,
    createVerify,
    Sign,
    Verify,
    sign,
    verify,
    pbkdf2,
    pbkdf2Sync,
    hkdf,
    hkdfSync,
    scrypt,
    scryptSync,
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
    X509Certificate,
};
