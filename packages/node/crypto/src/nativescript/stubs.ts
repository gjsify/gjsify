// SPDX-License-Identifier: MIT
// ENOTSUP stubs for @gjsify NativeScript target.
// NativeScript V8 lacks GLib (no AES cipher), WebCrypto subtle (no RSA/ECDH),
// and native DH/EC crypto primitives. Each function throws a structured error
// pointing at the limitation — no silent failures.

function notSupported(name: string, hint?: string): never {
    const msg = `${name} is not supported in NativeScript builds.${hint ? ' ' + hint : ''}`;
    const err: NodeJS.ErrnoException = new Error(msg);
    err.code = 'ENOTSUP';
    throw err;
}

// ─── Cipher / Decipher ──────────────────────────────────────────────────────
// AES-CBC/CTR/GCM require a native crypto backend (GLib on GJS, SubtleCrypto
// on browser). NativeScript V8 has neither.

export function createCipher(..._args: unknown[]): never {
    return notSupported('createCipher', 'AES cipher requires a native crypto backend not available on NativeScript.');
}

export function createCipheriv(..._args: unknown[]): never {
    return notSupported('createCipheriv', 'AES cipher requires a native crypto backend not available on NativeScript.');
}

export function createDecipher(..._args: unknown[]): never {
    return notSupported(
        'createDecipher',
        'AES decipher requires a native crypto backend not available on NativeScript.',
    );
}

export function createDecipheriv(..._args: unknown[]): never {
    return notSupported(
        'createDecipheriv',
        'AES decipher requires a native crypto backend not available on NativeScript.',
    );
}

export function getCiphers(): string[] {
    return [];
}

// ─── Diffie-Hellman ────────────────────────────────────────────────────────

export function createDiffieHellman(..._args: unknown[]): never {
    return notSupported('createDiffieHellman');
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

export function createECDH(_curve: string): never {
    return notSupported('createECDH');
}

export function getCurves(): string[] {
    return [];
}

// ─── Sign / Verify ──────────────────────────────────────────────────────────

export function createSign(_algorithm: string): never {
    return notSupported('createSign');
}

export function createVerify(_algorithm: string): never {
    return notSupported('createVerify');
}

export class Sign {
    constructor() {
        notSupported('Sign');
    }
}

export class Verify {
    constructor() {
        notSupported('Verify');
    }
}

export function sign(..._args: unknown[]): never {
    return notSupported('sign');
}

export function verify(..._args: unknown[]): never {
    return notSupported('verify');
}

// ─── KDF: PBKDF2 / HKDF / scrypt ────────────────────────────────────────────
// PBKDF2 and HKDF rely on Hmac (available) but the async variants need
// crypto.subtle on the current impl. Stubs for now — a future PR can wire
// the @noble/hashes-based Hmac into pbkdf2/hkdf.

export function pbkdf2(..._args: unknown[]): never {
    return notSupported('pbkdf2', 'Use a pure-JS pbkdf2 implementation or a future @gjsify update.');
}

export function pbkdf2Sync(..._args: unknown[]): never {
    return notSupported('pbkdf2Sync', 'Use a pure-JS pbkdf2 implementation or a future @gjsify update.');
}

export function hkdf(..._args: unknown[]): never {
    return notSupported('hkdf', 'Use a pure-JS hkdf implementation or a future @gjsify update.');
}

export function hkdfSync(..._args: unknown[]): never {
    return notSupported('hkdfSync', 'Use a pure-JS hkdf implementation or a future @gjsify update.');
}

export function scrypt(..._args: unknown[]): never {
    return notSupported('scrypt');
}

export function scryptSync(..._args: unknown[]): never {
    return notSupported('scryptSync');
}

// ─── RSA / public-key ───────────────────────────────────────────────────────

export function ecdsaSign(..._args: unknown[]): never {
    return notSupported('ecdsaSign');
}

export function ecdsaVerify(..._args: unknown[]): never {
    return notSupported('ecdsaVerify');
}

export function publicEncrypt(..._args: unknown[]): never {
    return notSupported('publicEncrypt');
}

export function privateDecrypt(..._args: unknown[]): never {
    return notSupported('privateDecrypt');
}

export function privateEncrypt(..._args: unknown[]): never {
    return notSupported('privateEncrypt');
}

export function publicDecrypt(..._args: unknown[]): never {
    return notSupported('publicDecrypt');
}

export function rsaPssSign(..._args: unknown[]): never {
    return notSupported('rsaPssSign');
}

export function rsaPssVerify(..._args: unknown[]): never {
    return notSupported('rsaPssVerify');
}

export function rsaOaepEncrypt(..._args: unknown[]): never {
    return notSupported('rsaOaepEncrypt');
}

export function rsaOaepDecrypt(..._args: unknown[]): never {
    return notSupported('rsaOaepDecrypt');
}

export function mgf1(..._args: unknown[]): never {
    return notSupported('mgf1');
}

// ─── KeyObject / X509Certificate ────────────────────────────────────────────

export class KeyObject {
    constructor() {
        notSupported('KeyObject');
    }
}

export function createSecretKey(..._args: unknown[]): never {
    return notSupported('createSecretKey');
}

export function createPublicKey(..._args: unknown[]): never {
    return notSupported('createPublicKey');
}

export function createPrivateKey(..._args: unknown[]): never {
    return notSupported('createPrivateKey');
}

export class X509Certificate {
    constructor() {
        notSupported('X509Certificate');
    }
}
