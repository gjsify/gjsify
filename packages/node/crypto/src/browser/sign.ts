// SPDX-License-Identifier: MIT
// Reimplemented for @gjsify browser target — inspired by crypto-browserify
// (Calvin Metcalf + browserify contributors, MIT) and aligned with WebCrypto
// (W3C). Sync APIs that have no WebCrypto equivalent throw ENOTSUP; the
// async variants are preferred.
//
// Reference: refs/crypto-browserify/* (+ sub-refs: browserify-sign,
// create-ecdh, public-encrypt).
//
// Architectural note: Sign/Verify accept a digest algorithm + a Node-style
// key object. WebCrypto wants a `CryptoKey` directly. The async variants
// `signAsync()` / `verifyAsync()` accept a pre-imported `CryptoKey` and
// return promises. The sync variants throw `ENOTSUP_SYNC_SIGN`.

import { Buffer } from 'node:buffer';

const WEBCRYPTO_HASH_ALGOS: Record<string, string> = {
    sha1: 'SHA-1',
    sha256: 'SHA-256',
    sha384: 'SHA-384',
    sha512: 'SHA-512',
};

function normalizeHash(algorithm: string): string {
    const normalized = algorithm.toLowerCase().replace(/-/g, '');
    const webAlgo = WEBCRYPTO_HASH_ALGOS[normalized];
    if (!webAlgo) {
        throw new Error(`Unsupported digest in browser builds: ${algorithm}`);
    }
    return webAlgo;
}

function getWebSubtle(): SubtleCrypto {
    if (typeof globalThis.crypto === 'undefined' || typeof globalThis.crypto.subtle === 'undefined') {
        throw new Error('WebCrypto SubtleCrypto is unavailable in this environment');
    }
    return globalThis.crypto.subtle;
}

function syncUnsupportedError(): Error {
    const err: NodeJS.ErrnoException = new Error(
        'Synchronous Sign.sign() / Verify.verify() is not supported in browser builds. ' +
            'Use signAsync(cryptoKey) / verifyAsync(cryptoKey, signature) with a pre-imported CryptoKey.',
    );
    err.code = 'ENOTSUP_SYNC_SIGN';
    return err;
}

abstract class SignBase {
    protected _algorithm: string;
    protected _webAlgo: string;
    protected _chunks: Uint8Array[] = [];
    protected _finalized = false;

    constructor(algorithm: string) {
        this._algorithm = algorithm.toLowerCase();
        this._webAlgo = normalizeHash(algorithm);
    }

    update(data: string | Buffer | Uint8Array, inputEncoding?: BufferEncoding): this {
        if (this._finalized) {
            throw new Error('Sign/Verify already finalised');
        }
        const bytes =
            typeof data === 'string'
                ? Buffer.from(data, inputEncoding ?? 'utf8')
                : data instanceof Uint8Array
                  ? data
                  : Buffer.from(data);
        this._chunks.push(bytes);
        return this;
    }

    protected _allBytes(): Uint8Array {
        if (this._chunks.length === 0) return new Uint8Array(0);
        if (this._chunks.length === 1) return this._chunks[0];
        const totalLen = this._chunks.reduce((n, c) => n + c.byteLength, 0);
        const out = new Uint8Array(totalLen);
        let offset = 0;
        for (const chunk of this._chunks) {
            out.set(chunk, offset);
            offset += chunk.byteLength;
        }
        return out;
    }
}

export class Sign extends SignBase {
    /** Sync sign — throws ENOTSUP_SYNC_SIGN. */
    sign(_privateKey: unknown, _outputFormat?: BufferEncoding): Buffer | string {
        throw syncUnsupportedError();
    }

    /**
     * Async sign — accepts a pre-imported `CryptoKey` (use `subtle.importKey`).
     * Algorithm depends on the digest used in `createSign(digest)`:
     * - RSASSA-PKCS1-v1_5 if the key was imported as such
     * - ECDSA if the key is EC
     * - RSA-PSS if the key was imported with PSS metadata
     * Caller is responsible for matching the key algorithm; this wrapper
     * defaults to the `key.algorithm.name` reported by the CryptoKey.
     */
    async signAsync(privateKey: CryptoKey, outputEncoding?: BufferEncoding): Promise<Buffer | string> {
        if (this._finalized) {
            throw new Error('Sign already finalised');
        }
        this._finalized = true;
        const subtle = getWebSubtle();
        const algName = privateKey.algorithm.name;
        let params: AlgorithmIdentifier | RsaPssParams | EcdsaParams;
        if (algName === 'ECDSA') {
            params = { name: 'ECDSA', hash: this._webAlgo };
        } else if (algName === 'RSA-PSS') {
            params = { name: 'RSA-PSS', saltLength: 32 };
        } else {
            params = algName; // RSASSA-PKCS1-v1_5
        }
        const signature = await subtle.sign(params, privateKey, this._allBytes() as BufferSource);
        const buf = Buffer.from(signature);
        return outputEncoding ? buf.toString(outputEncoding) : buf;
    }
}

export class Verify extends SignBase {
    /** Sync verify — throws ENOTSUP_SYNC_SIGN. */
    verify(_publicKey: unknown, _signature: string | Buffer | Uint8Array, _signatureFormat?: BufferEncoding): boolean {
        throw syncUnsupportedError();
    }

    async verifyAsync(publicKey: CryptoKey, signature: Buffer | Uint8Array): Promise<boolean> {
        if (this._finalized) {
            throw new Error('Verify already finalised');
        }
        this._finalized = true;
        const subtle = getWebSubtle();
        const algName = publicKey.algorithm.name;
        let params: AlgorithmIdentifier | RsaPssParams | EcdsaParams;
        if (algName === 'ECDSA') {
            params = { name: 'ECDSA', hash: this._webAlgo };
        } else if (algName === 'RSA-PSS') {
            params = { name: 'RSA-PSS', saltLength: 32 };
        } else {
            params = algName;
        }
        return subtle.verify(params, publicKey, signature as BufferSource, this._allBytes() as BufferSource);
    }
}

export function createSign(algorithm: string): Sign {
    return new Sign(algorithm);
}

export function createVerify(algorithm: string): Verify {
    return new Verify(algorithm);
}

/** One-shot sign — Node 15+ API. Async only in browser builds. */
export async function sign(
    algorithm: string | null | undefined,
    data: Buffer | Uint8Array,
    key: CryptoKey,
): Promise<Buffer> {
    const subtle = getWebSubtle();
    const algName = key.algorithm.name;
    let params: AlgorithmIdentifier | RsaPssParams | EcdsaParams;
    if (algName === 'ECDSA') {
        params = { name: 'ECDSA', hash: algorithm ? normalizeHash(algorithm) : 'SHA-256' };
    } else if (algName === 'RSA-PSS') {
        params = { name: 'RSA-PSS', saltLength: 32 };
    } else {
        params = algName;
    }
    return Buffer.from(await subtle.sign(params, key, data as BufferSource));
}

export async function verify(
    algorithm: string | null | undefined,
    data: Buffer | Uint8Array,
    key: CryptoKey,
    signature: Buffer | Uint8Array,
): Promise<boolean> {
    const subtle = getWebSubtle();
    const algName = key.algorithm.name;
    let params: AlgorithmIdentifier | RsaPssParams | EcdsaParams;
    if (algName === 'ECDSA') {
        params = { name: 'ECDSA', hash: algorithm ? normalizeHash(algorithm) : 'SHA-256' };
    } else if (algName === 'RSA-PSS') {
        params = { name: 'RSA-PSS', saltLength: 32 };
    } else {
        params = algName;
    }
    return subtle.verify(params, key, signature as BufferSource, data as BufferSource);
}
