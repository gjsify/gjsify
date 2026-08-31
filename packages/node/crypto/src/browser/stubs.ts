// SPDX-License-Identifier: MIT
// Reimplemented for @gjsify browser target — inspired by crypto-browserify
// (Calvin Metcalf + browserify contributors, MIT) and aligned with WebCrypto
// (W3C). Sync APIs that have no WebCrypto equivalent throw ENOTSUP; the
// async variants are preferred.
//
// Reference: refs/crypto-browserify/* (+ sub-refs: diffie-hellman,
// create-ecdh, public-encrypt).
//
// This file groups every API that has no WebCrypto equivalent or no sensible
// browser pendant. Each throws an ENOTSUP-typed error with a clear message
// directing the caller to an async WebCrypto path or `partial` runtime slot.

import type { Buffer } from 'node:buffer';

function notSupported(name: string, hint?: string): never {
    const msg = `${name} is not supported in browser builds.${hint ? ' ' + hint : ''}`;
    const err: NodeJS.ErrnoException = new Error(msg);
    err.code = 'ENOTSUP';
    throw err;
}

// ─── Diffie-Hellman ────────────────────────────────────────────────────────

export function createDiffieHellman(..._args: unknown[]): never {
    return notSupported(
        'createDiffieHellman',
        'WebCrypto does not expose classic DH. Use crypto.subtle.deriveBits({name:"ECDH",…}) instead.',
    );
}

export function getDiffieHellman(_groupName: string): never {
    return notSupported('getDiffieHellman');
}

export class DiffieHellman {
    constructor() {
        notSupported('DiffieHellman');
    }
}

export class DiffieHellmanGroup {
    constructor() {
        notSupported('DiffieHellmanGroup');
    }
}

export function createDiffieHellmanGroup(_groupName: string): never {
    return notSupported('createDiffieHellmanGroup');
}

// ─── ECDH ───────────────────────────────────────────────────────────────────
// Implemented with pure-BigInt EC arithmetic in `browser/ecdh.ts`
// (`createECDH` / `getCurves`) — not stubbed here.

// ─── ECDSA helpers (one-shot wrappers on top of sign.ts) ────────────────────

export function ecdsaSign(): never {
    return notSupported('ecdsaSign', 'Use createSign("sha256").update(…).signAsync(cryptoKey).');
}

export function ecdsaVerify(): never {
    return notSupported('ecdsaVerify', 'Use createVerify("sha256").update(…).verifyAsync(cryptoKey, signature).');
}

// ─── RSA Encrypt/Decrypt ────────────────────────────────────────────────────

export function publicEncrypt(_keyLike: unknown, _data: Buffer | Uint8Array): never {
    return notSupported('publicEncrypt', 'Use crypto.subtle.encrypt({name:"RSA-OAEP",…}, cryptoKey, plaintext).');
}

export function privateDecrypt(_keyLike: unknown, _data: Buffer | Uint8Array): never {
    return notSupported('privateDecrypt', 'Use crypto.subtle.decrypt({name:"RSA-OAEP",…}, cryptoKey, ciphertext).');
}

export function privateEncrypt(_keyLike: unknown, _data: Buffer | Uint8Array): never {
    return notSupported('privateEncrypt', 'No WebCrypto equivalent — used by legacy JWT libraries only.');
}

export function publicDecrypt(_keyLike: unknown, _data: Buffer | Uint8Array): never {
    return notSupported('publicDecrypt', 'No WebCrypto equivalent — used by legacy JWT libraries only.');
}

// ─── RSA PSS / OAEP helpers ────────────────────────────────────────────────

export function rsaPssSign(): never {
    return notSupported('rsaPssSign', 'Use createSign(digest).signAsync(rsaPssCryptoKey).');
}

export function rsaPssVerify(): never {
    return notSupported('rsaPssVerify', 'Use createVerify(digest).verifyAsync(rsaPssCryptoKey, signature).');
}

export function rsaOaepEncrypt(): never {
    return notSupported('rsaOaepEncrypt', 'Use crypto.subtle.encrypt({name:"RSA-OAEP",…}, cryptoKey, plaintext).');
}

export function rsaOaepDecrypt(): never {
    return notSupported('rsaOaepDecrypt', 'Use crypto.subtle.decrypt({name:"RSA-OAEP",…}, cryptoKey, ciphertext).');
}

// ─── MGF1 — internal RSA helper, no WebCrypto pendant ──────────────────────

export function mgf1(): never {
    return notSupported('mgf1', 'WebCrypto does not expose MGF1 directly — it is internal to RSA-OAEP/PSS.');
}

// ─── KeyObject / KeyPair generation ─────────────────────────────────────────
//
// Node's `KeyObject` wraps a serialised key handle; WebCrypto's `CryptoKey`
// is the closest equivalent but the surface differs (no PEM/JWK export
// synchronously). We provide stubs and direct callers at WebCrypto.

export class KeyObject {
    constructor() {
        notSupported('KeyObject', 'Use crypto.subtle.importKey / exportKey to obtain a CryptoKey instead.');
    }
    static from(): never {
        return notSupported('KeyObject.from');
    }
}

export function createSecretKey(_key: Buffer | Uint8Array): never {
    return notSupported('createSecretKey', 'Use crypto.subtle.importKey("raw", key, …).');
}

export function createPublicKey(_keyLike: unknown): never {
    return notSupported('createPublicKey', 'Use crypto.subtle.importKey("spki" | "jwk", …).');
}

export function createPrivateKey(_keyLike: unknown): never {
    return notSupported('createPrivateKey', 'Use crypto.subtle.importKey("pkcs8" | "jwk", …).');
}

export function generateKeyPair(..._args: unknown[]): never {
    return notSupported('generateKeyPair', 'Use crypto.subtle.generateKey({name:…, …}, true, [usages]).');
}

export function generateKeyPairSync(..._args: unknown[]): never {
    return notSupported(
        'generateKeyPairSync',
        'No sync key-pair gen in WebCrypto. Use crypto.subtle.generateKey (async).',
    );
}

export function generateKey(..._args: unknown[]): never {
    return notSupported('generateKey', 'Use crypto.subtle.generateKey for symmetric keys.');
}

// ─── X509Certificate ────────────────────────────────────────────────────────

export class X509Certificate {
    constructor() {
        notSupported(
            'X509Certificate',
            'WebCrypto does not expose X.509 parsing. Use a third-party library or the platform certificate APIs.',
        );
    }
}
