// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Extracted from packages/node/querystring/src/index.ts during the
// per-concern split. Sources upstream:
//   - https://github.com/denoland/deno_std/blob/main/node/querystring.ts
//   - Node.js `lib/querystring.js` (`qsEscape` / `encodeStr`)
//
// URL percent-encoding for query strings. Owns:
//   - `ERR_INVALID_URI` (the only error class the encoder can throw)
//   - `encodeStr` (the low-level UTF-8 → percent-encoding loop)
//   - `qsEscape` (the public `querystring.escape` value coerces + delegates)
//
// Pure leaf — depends only on `./tables` and `../error`.

import { NodeURIError } from '../error.js';
import { hexTable, noEscape } from './tables.js';

export class ERR_INVALID_URI extends NodeURIError {
    constructor() {
        super('ERR_INVALID_URI', `URI malformed`);
    }
}

/**
 * Lower-level percent-encode: walks `str` byte by byte, emitting either
 * the character (when `noEscapeTable[c] === 1`) or `hexTable[c]` for
 * each ASCII / multi-byte UTF-8 unit. Surrogate pairs are encoded as a
 * single 4-byte UTF-8 sequence. Throws `ERR_INVALID_URI` on a lone
 * high surrogate.
 *
 * @param str The string to encode.
 * @param noEscapeTable Table of characters that need not be encoded.
 * @param hexTable Pre-computed `'%xx'` percent-encoded byte table.
 */
export function encodeStr(str: string, noEscapeTable: Int8Array, hexTable: string[]): string {
    const len = str.length;
    if (len === 0) return '';

    let out = '';
    let lastPos = 0;

    for (let i = 0; i < len; i++) {
        let c = str.charCodeAt(i);
        // ASCII
        if (c < 0x80) {
            if (noEscapeTable[c] === 1) continue;
            if (lastPos < i) out += str.slice(lastPos, i);
            lastPos = i + 1;
            out += hexTable[c];
            continue;
        }

        if (lastPos < i) out += str.slice(lastPos, i);

        // Multi-byte characters ...
        if (c < 0x800) {
            lastPos = i + 1;
            out += hexTable[0xc0 | (c >> 6)] + hexTable[0x80 | (c & 0x3f)];
            continue;
        }
        if (c < 0xd800 || c >= 0xe000) {
            lastPos = i + 1;
            out += hexTable[0xe0 | (c >> 12)] + hexTable[0x80 | ((c >> 6) & 0x3f)] + hexTable[0x80 | (c & 0x3f)];
            continue;
        }
        // Surrogate pair
        ++i;

        // This branch should never happen because all URLSearchParams entries
        // should already be converted to USVString. But, included for
        // completion's sake anyway.
        if (i >= len) throw new ERR_INVALID_URI();

        const c2 = str.charCodeAt(i) & 0x3ff;

        lastPos = i + 1;
        c = 0x10000 + (((c & 0x3ff) << 10) | c2);
        out +=
            hexTable[0xf0 | (c >> 18)] +
            hexTable[0x80 | ((c >> 12) & 0x3f)] +
            hexTable[0x80 | ((c >> 6) & 0x3f)] +
            hexTable[0x80 | (c & 0x3f)];
    }
    if (lastPos === 0) return str;
    if (lastPos < len) return out + str.slice(lastPos);
    return out;
}

/**
 * Replaces `encodeURIComponent()`.
 * @see https://www.ecma-international.org/ecma-262/5.1/#sec-15.1.3.4
 */
export function qsEscape(str: unknown): string {
    if (typeof str !== 'string') {
        if (typeof str === 'object') {
            str = String(str);
        } else {
            str += '';
        }
    }
    return encodeStr(str as string, noEscape, hexTable);
}
