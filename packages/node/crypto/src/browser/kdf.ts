// SPDX-License-Identifier: MIT
// Reimplemented for @gjsify browser target — inspired by crypto-browserify
// (Calvin Metcalf + browserify contributors, MIT) and aligned with WebCrypto
// (W3C). Sync APIs that have no WebCrypto equivalent throw ENOTSUP; the
// async variants are preferred.
//
// Reference: refs/crypto-browserify/* (+ sub-ref: pbkdf2).

import { Buffer } from 'node:buffer';

const WEBCRYPTO_HASH_ALGOS: Record<string, string> = {
    sha1: 'SHA-1',
    sha256: 'SHA-256',
    sha384: 'SHA-384',
    sha512: 'SHA-512',
};

function normalizeAlgorithm(algorithm: string): string {
    return algorithm.toLowerCase().replace(/-/g, '');
}

function getWebSubtle(): SubtleCrypto {
    if (typeof globalThis.crypto === 'undefined' || typeof globalThis.crypto.subtle === 'undefined') {
        throw new Error('WebCrypto SubtleCrypto is unavailable in this environment');
    }
    return globalThis.crypto.subtle;
}

function toBytes(input: string | Buffer | Uint8Array): Uint8Array {
    if (typeof input === 'string') return Buffer.from(input, 'utf8');
    return input instanceof Uint8Array ? input : Buffer.from(input);
}

function resolveWebAlgo(digest: string): string {
    const normalized = normalizeAlgorithm(digest);
    const algo = WEBCRYPTO_HASH_ALGOS[normalized];
    if (!algo) {
        throw new Error(`Unsupported PBKDF2/HKDF digest: ${digest}`);
    }
    return algo;
}

type Pbkdf2Callback = (err: Error | null, derivedKey: Buffer) => void;

/** PBKDF2 — async via `subtle.deriveBits`. */
export function pbkdf2(
    password: string | Buffer | Uint8Array,
    salt: string | Buffer | Uint8Array,
    iterations: number,
    keylen: number,
    digest: string,
    callback?: Pbkdf2Callback,
): void;
export function pbkdf2(
    password: string | Buffer | Uint8Array,
    salt: string | Buffer | Uint8Array,
    iterations: number,
    keylen: number,
    digestOrCallback: string | Pbkdf2Callback,
    callback?: Pbkdf2Callback,
): void {
    let digest: string;
    let cb: Pbkdf2Callback;
    if (typeof digestOrCallback === 'function') {
        // Legacy: pbkdf2(password, salt, iterations, keylen, callback) defaults to sha1.
        digest = 'sha1';
        cb = digestOrCallback;
    } else {
        digest = digestOrCallback;
        cb = callback!;
    }

    const webAlgo = resolveWebAlgo(digest);
    const passBytes = toBytes(password);
    const saltBytes = toBytes(salt);
    const subtle = getWebSubtle();

    subtle
        .importKey('raw', passBytes as BufferSource, { name: 'PBKDF2' }, false, ['deriveBits'])
        .then((key) =>
            subtle.deriveBits(
                { name: 'PBKDF2', salt: saltBytes as BufferSource, iterations, hash: webAlgo },
                key,
                keylen * 8,
            ),
        )
        .then((derived) => cb(null, Buffer.from(derived)))
        .catch((err) => cb(err as Error, Buffer.alloc(0)));
}

/** Synchronous PBKDF2 — throws ENOTSUP_SYNC_KDF in browser builds. */
export function pbkdf2Sync(
    _password: string | Buffer | Uint8Array,
    _salt: string | Buffer | Uint8Array,
    _iterations: number,
    _keylen: number,
    _digest?: string,
): Buffer {
    const err: NodeJS.ErrnoException = new Error(
        'Synchronous pbkdf2Sync is not supported in browser builds. Use pbkdf2() with a callback, ' +
            'or await crypto.subtle.deriveBits({name:"PBKDF2", …}) directly.',
    );
    err.code = 'ENOTSUP_SYNC_KDF';
    throw err;
}

type HkdfCallback = (err: Error | null, derivedKey: ArrayBuffer) => void;

/** HKDF — async via `subtle.deriveBits`. */
export function hkdf(
    digest: string,
    ikm: string | Buffer | Uint8Array,
    salt: string | Buffer | Uint8Array,
    info: string | Buffer | Uint8Array,
    keylen: number,
    callback: HkdfCallback,
): void {
    const webAlgo = resolveWebAlgo(digest);
    const subtle = getWebSubtle();

    subtle
        .importKey('raw', toBytes(ikm) as BufferSource, { name: 'HKDF' }, false, ['deriveBits'])
        .then((key) =>
            subtle.deriveBits(
                {
                    name: 'HKDF',
                    hash: webAlgo,
                    salt: toBytes(salt) as BufferSource,
                    info: toBytes(info) as BufferSource,
                },
                key,
                keylen * 8,
            ),
        )
        .then((derived) => callback(null, derived))
        .catch((err) => callback(err as Error, new ArrayBuffer(0)));
}

/** Synchronous HKDF — throws ENOTSUP_SYNC_KDF in browser builds. */
export function hkdfSync(
    _digest: string,
    _ikm: string | Buffer | Uint8Array,
    _salt: string | Buffer | Uint8Array,
    _info: string | Buffer | Uint8Array,
    _keylen: number,
): ArrayBuffer {
    const err: NodeJS.ErrnoException = new Error(
        'Synchronous hkdfSync is not supported in browser builds. Use hkdf() with a callback, ' +
            'or await crypto.subtle.deriveBits({name:"HKDF", …}) directly.',
    );
    err.code = 'ENOTSUP_SYNC_KDF';
    throw err;
}

/** Scrypt is not in WebCrypto. */
export function scrypt(
    _password: string | Buffer | Uint8Array,
    _salt: string | Buffer | Uint8Array,
    _keylen: number,
    _optionsOrCallback: unknown,
    callback?: (err: Error | null, derivedKey: Buffer) => void,
): void {
    const err: NodeJS.ErrnoException = new Error(
        'scrypt is not supported in browser builds — WebCrypto does not provide a scrypt primitive.',
    );
    err.code = 'ENOTSUP_NO_WEBCRYPTO_PRIMITIVE';
    const cb = (typeof _optionsOrCallback === 'function' ? _optionsOrCallback : callback) as
        | ((err: Error | null, derivedKey: Buffer) => void)
        | undefined;
    if (cb) {
        cb(err, Buffer.alloc(0));
        return;
    }
    throw err;
}

export function scryptSync(
    _password: string | Buffer | Uint8Array,
    _salt: string | Buffer | Uint8Array,
    _keylen: number,
    _options?: unknown,
): Buffer {
    const err: NodeJS.ErrnoException = new Error(
        'scryptSync is not supported in browser builds — WebCrypto does not provide a scrypt primitive.',
    );
    err.code = 'ENOTSUP_NO_WEBCRYPTO_PRIMITIVE';
    throw err;
}
