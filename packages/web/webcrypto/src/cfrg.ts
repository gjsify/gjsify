// Ed25519 / X25519 for SubtleCrypto (W3C WebCrypto § Ed25519, § X25519)
// Reference: refs/node/lib/internal/crypto/cfrg.js, refs/node/lib/internal/crypto/diffiehellman.js
// Copyright (c) Node.js contributors. MIT license.
// Reimplemented for GJS over node:crypto's KeyObject, sign/verify and
// diffieHellman — @gjsify/crypto on GJS, Node's own on Node — so the key
// codecs and the curve arithmetic live in ONE place.

import { CryptoKey, type CryptoKeyPair, type KeyUsage } from './crypto-key.js';
import { DOMException } from '@gjsify/dom-exception';
import { base64urlDecode, toUint8Array } from './util.js';

export type CfrgName = 'Ed25519' | 'X25519';

/** The slice of a node:crypto KeyObject this module drives. */
export interface KeyObjectLike {
    readonly type: 'public' | 'private' | 'secret';
    readonly asymmetricKeyType?: string;
    export(options: { format: string; type?: string }): Uint8Array | string | Record<string, unknown>;
}

/** The node:crypto functions this module needs, handed in by subtle.ts's lazy loader. */
export interface CfrgCrypto {
    generateKeyPairSync(type: string): { publicKey: KeyObjectLike; privateKey: KeyObjectLike };
    sign(algorithm: null, data: Uint8Array, key: KeyObjectLike): Uint8Array;
    verify(algorithm: null, data: Uint8Array, key: KeyObjectLike, signature: Uint8Array): boolean;
    diffieHellman(options: { privateKey: KeyObjectLike; publicKey: KeyObjectLike }): Uint8Array;
    createPrivateKey(input: unknown): KeyObjectLike;
    createPublicKey(input: unknown): KeyObjectLike;
}

/** CryptoKey handle of an Ed25519 / X25519 key. */
export interface CfrgHandle {
    keyObject: KeyObjectLike;
}

const USAGES: Record<CfrgName, { public: KeyUsage[]; private: KeyUsage[] }> = {
    Ed25519: { public: ['verify'], private: ['sign'] },
    X25519: { public: [], private: ['deriveKey', 'deriveBits'] },
};

// RFC 8410 SubjectPublicKeyInfo prefix: the raw-format import wraps the 32 bytes in it.
const SPKI_PREFIX: Record<CfrgName, number[]> = {
    Ed25519: [0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00],
    X25519: [0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x03, 0x21, 0x00],
};

export function cfrgName(name: string): CfrgName | undefined {
    const upper = name.toUpperCase();
    if (upper === 'ED25519') return 'Ed25519';
    if (upper === 'X25519') return 'X25519';
    return undefined;
}

function assertUsages(usages: KeyUsage[], allowed: KeyUsage[]): void {
    for (const usage of usages) {
        if (!allowed.includes(usage)) {
            throw new DOMException(`Unsupported key usage: ${usage}`, 'SyntaxError');
        }
    }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    return (bytes.buffer as ArrayBuffer).slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function keyObjectOf(key: CryptoKey): KeyObjectLike {
    return (key._handle as CfrgHandle).keyObject;
}

export function cfrgGenerateKey(
    c: CfrgCrypto,
    name: CfrgName,
    extractable: boolean,
    usages: KeyUsage[],
): CryptoKeyPair {
    assertUsages(usages, [...USAGES[name].public, ...USAGES[name].private]);
    const privateUsages = usages.filter((u) => USAGES[name].private.includes(u));
    if (privateUsages.length === 0) {
        throw new DOMException('Usages cannot be empty when creating a key.', 'SyntaxError');
    }
    const publicUsages = usages.filter((u) => USAGES[name].public.includes(u));
    const { publicKey, privateKey } = c.generateKeyPairSync(name.toLowerCase());
    return {
        publicKey: new CryptoKey('public', true, { name }, publicUsages, { keyObject: publicKey } satisfies CfrgHandle),
        privateKey: new CryptoKey('private', extractable, { name }, privateUsages, {
            keyObject: privateKey,
        } satisfies CfrgHandle),
    };
}

function validateJwk(jwk: JsonWebKey, name: CfrgName, extractable: boolean, usages: KeyUsage[]): void {
    if (jwk === null || typeof jwk !== 'object') throw new DOMException('Invalid keyData', 'DataError');
    if (jwk.kty !== 'OKP') throw new DOMException('Invalid JWK "kty" Parameter', 'DataError');
    if (jwk.crv !== name) throw new DOMException('JWK "crv" Parameter and algorithm name mismatch', 'DataError');
    if (name === 'Ed25519' && jwk.alg !== undefined && jwk.alg !== 'Ed25519' && jwk.alg !== 'EdDSA') {
        throw new DOMException('JWK "alg" does not match the requested algorithm', 'DataError');
    }
    const expectedUse = name === 'X25519' ? 'enc' : 'sig';
    if (usages.length > 0 && jwk.use !== undefined && jwk.use !== expectedUse) {
        throw new DOMException('Invalid JWK "use" Parameter', 'DataError');
    }
    if (jwk.key_ops !== undefined) {
        if (!Array.isArray(jwk.key_ops)) throw new DOMException('Invalid JWK "key_ops" Parameter', 'DataError');
        for (const usage of usages) {
            if (!jwk.key_ops.includes(usage)) {
                throw new DOMException('Key operations and usage mismatch', 'DataError');
            }
        }
    }
    if (jwk.ext === false && extractable) {
        throw new DOMException('JWK "ext" Parameter and extractable mismatch', 'DataError');
    }
    if (typeof jwk.x !== 'string' || (jwk.d !== undefined && typeof jwk.d !== 'string')) {
        throw new DOMException('Invalid keyData', 'DataError');
    }
}

export function cfrgImportKey(
    c: CfrgCrypto,
    format: string,
    keyData: BufferSource | JsonWebKey,
    name: CfrgName,
    extractable: boolean,
    usages: KeyUsage[],
): CryptoKey {
    let keyObject: KeyObjectLike;
    let kind: 'public' | 'private';
    // The node:crypto import calls throw on malformed key material — which
    // WebCrypto reports as DataError, the one error name importKey may use.
    const importOrDataError = (fn: () => KeyObjectLike): KeyObjectLike => {
        try {
            return fn();
        } catch (err) {
            throw new DOMException(`Invalid keyData: ${(err as Error).message}`, 'DataError');
        }
    };
    switch (format) {
        case 'raw': {
            assertUsages(usages, USAGES[name].public);
            const raw = toUint8Array(keyData as BufferSource);
            if (raw.length !== 32) throw new DOMException('Invalid keyData', 'DataError');
            const der = new Uint8Array(44);
            der.set(SPKI_PREFIX[name], 0);
            der.set(raw, 12);
            keyObject = importOrDataError(() => c.createPublicKey({ key: der, format: 'der', type: 'spki' }));
            kind = 'public';
            break;
        }
        case 'spki': {
            assertUsages(usages, USAGES[name].public);
            const der = toUint8Array(keyData as BufferSource);
            keyObject = importOrDataError(() => c.createPublicKey({ key: der, format: 'der', type: 'spki' }));
            kind = 'public';
            break;
        }
        case 'pkcs8': {
            assertUsages(usages, USAGES[name].private);
            const der = toUint8Array(keyData as BufferSource);
            keyObject = importOrDataError(() => c.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' }));
            kind = 'private';
            break;
        }
        case 'jwk': {
            const jwk = keyData as JsonWebKey;
            validateJwk(jwk, name, extractable, usages);
            kind = jwk.d === undefined ? 'public' : 'private';
            assertUsages(usages, USAGES[name][kind]);
            if (kind === 'private') {
                keyObject = importOrDataError(() => c.createPrivateKey({ key: jwk, format: 'jwk' }));
                // The spec checks x against d: a JWK whose halves disagree is not one key.
                const x = (c.createPublicKey(keyObject).export({ format: 'jwk' }) as { x: string }).x;
                if (x !== jwk.x) throw new DOMException('Invalid JWK: "x" does not match "d"', 'DataError');
            } else {
                if (base64urlDecode(jwk.x as string).length !== 32) {
                    throw new DOMException('Invalid keyData', 'DataError');
                }
                keyObject = importOrDataError(() => c.createPublicKey({ key: jwk, format: 'jwk' }));
            }
            break;
        }
        default:
            throw new DOMException(`Unsupported format: ${format}`, 'NotSupportedError');
    }
    if (keyObject.asymmetricKeyType !== name.toLowerCase()) {
        throw new DOMException('Invalid key type', 'DataError');
    }
    if (kind === 'private' && usages.length === 0) {
        throw new DOMException('Usages cannot be empty when importing a private key.', 'SyntaxError');
    }
    return new CryptoKey(kind, extractable, { name }, usages, { keyObject } satisfies CfrgHandle);
}

/** Node's (and current WebCrypto's) answer to a format the key type cannot take. */
function wrongKindForFormat(key: CryptoKey, format: string): DOMException {
    return new DOMException(
        `Unable to export ${key.algorithm.name} ${key.type} key using ${format} format`,
        'NotSupportedError',
    );
}

export function cfrgExportKey(format: string, key: CryptoKey): ArrayBuffer | JsonWebKey {
    const keyObject = keyObjectOf(key);
    switch (format) {
        case 'raw': {
            if (key.type !== 'public') throw wrongKindForFormat(key, format);
            const x = (keyObject.export({ format: 'jwk' }) as { x: string }).x;
            return toArrayBuffer(base64urlDecode(x));
        }
        case 'spki': {
            if (key.type !== 'public') throw wrongKindForFormat(key, format);
            return toArrayBuffer(keyObject.export({ format: 'der', type: 'spki' }) as Uint8Array);
        }
        case 'pkcs8': {
            if (key.type !== 'private') throw wrongKindForFormat(key, format);
            return toArrayBuffer(keyObject.export({ format: 'der', type: 'pkcs8' }) as Uint8Array);
        }
        case 'jwk': {
            const exported = keyObject.export({ format: 'jwk' }) as Record<string, string>;
            const jwk: JsonWebKey = { kty: 'OKP', crv: key.algorithm.name, x: exported.x };
            if (key.type === 'private') jwk.d = exported.d;
            if (key.algorithm.name === 'Ed25519') jwk.alg = 'Ed25519';
            jwk.key_ops = [...key.usages];
            jwk.ext = key.extractable;
            return jwk;
        }
        default:
            throw new DOMException(`Unsupported export format: ${format}`, 'NotSupportedError');
    }
}

export function ed25519Sign(c: CfrgCrypto, key: CryptoKey, data: Uint8Array): ArrayBuffer {
    if (key.type !== 'private') throw new DOMException('Key must be a private key', 'InvalidAccessError');
    return toArrayBuffer(c.sign(null, data, keyObjectOf(key)));
}

export function ed25519Verify(c: CfrgCrypto, key: CryptoKey, signature: Uint8Array, data: Uint8Array): boolean {
    if (key.type !== 'public') throw new DOMException('Key must be a public key', 'InvalidAccessError');
    return c.verify(null, data, keyObjectOf(key), signature);
}

/**
 * X25519 deriveBits: the full 32-byte secret for a null length, else its
 * first `length` bits. The all-zero secret of a low-order peer key is an
 * OperationError per spec, which node:crypto's refusal maps onto.
 */
export function x25519DeriveBits(
    c: CfrgCrypto,
    baseKey: CryptoKey,
    publicKey: CryptoKey,
    length: number | null | undefined,
): ArrayBuffer {
    if (baseKey.type !== 'private') throw new DOMException('baseKey must be a private key', 'InvalidAccessError');
    if (!(publicKey instanceof CryptoKey) || publicKey.type !== 'public') {
        throw new DOMException('algorithm.public must be a public key', 'InvalidAccessError');
    }
    if (publicKey.algorithm.name !== baseKey.algorithm.name) {
        throw new DOMException('The public and private keys must be of the same type', 'InvalidAccessError');
    }
    let secret: Uint8Array;
    try {
        secret = new Uint8Array(
            c.diffieHellman({ privateKey: keyObjectOf(baseKey), publicKey: keyObjectOf(publicKey) }),
        );
    } catch (err) {
        // node:crypto refuses a low-order peer key; WebCrypto names that OperationError.
        throw new DOMException(`Deriving bits failed: ${(err as Error).message}`, 'OperationError');
    }
    if (length === null || length === undefined) return toArrayBuffer(secret);
    if (length > secret.length * 8) {
        throw new DOMException('derived bit length is too small', 'OperationError');
    }
    const out = secret.slice(0, Math.ceil(length / 8));
    if (length % 8 !== 0) out[out.length - 1] &= 0xff << (8 - (length % 8));
    return toArrayBuffer(out);
}
