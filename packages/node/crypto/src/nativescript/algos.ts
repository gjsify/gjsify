// SPDX-License-Identifier: MIT
// Shared algorithm lookup for the @gjsify NativeScript crypto backend.
// Both hash.ts and hmac.ts resolve a Node digest name to a @noble/hashes
// hasher through this module — keep the mapping in one place.
//
// @noble/hashes: Copyright (c) 2022 Paul Miller (https://paulmillr.com), MIT.

import { sha256, sha224, sha384, sha512, sha512_256 } from '@noble/hashes/sha2';
import { sha1, md5 } from '@noble/hashes/legacy';
import { type CHash } from '@noble/hashes/utils';

/** The digest algorithms the NativeScript backend supports, in Node naming. */
export const SUPPORTED_HASHES = ['md5', 'sha1', 'sha224', 'sha256', 'sha384', 'sha512', 'sha512-256'] as const;

/** Normalise an algorithm name to lowercase without hyphens: "SHA-256" → "sha256". */
export function normalizeAlgorithm(algorithm: string): string {
    return algorithm.toLowerCase().replace(/-/g, '');
}

const NOBLE_ALGOS: Record<string, CHash> = {
    sha1,
    sha224,
    sha256,
    sha384,
    sha512,
    sha512256: sha512_256,
    md5,
};

/** Resolve a Node digest name to a @noble/hashes hasher, or throw like Node. */
export function getNobleHash(algorithm: string): CHash {
    const fn = NOBLE_ALGOS[normalizeAlgorithm(algorithm)];
    if (!fn) {
        const err: NodeJS.ErrnoException = new Error(`Unknown message digest: ${algorithm}`);
        err.code = 'ERR_CRYPTO_HASH_UNKNOWN';
        throw err;
    }
    return fn;
}
