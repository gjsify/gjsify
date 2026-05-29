// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Extracted from packages/node/querystring/src/index.ts during the
// per-concern split. Sources upstream:
//   - https://github.com/denoland/deno_std/blob/main/node/querystring.ts
//   - Node.js `lib/querystring.js` (`qsUnescape` / `unescapeBuffer`)
//
// URL percent-decoding for query strings. Owns:
//   - `unescapeBuffer` (public — fast `decodeURIComponent` alternative
//     that returns a `Buffer`)
//   - `qsUnescape` (the public `querystring.unescape` value falls back
//     to `unescapeBuffer` when `decodeURIComponent` throws)
//
// Pure leaf — depends only on `./tables`.

import { Buffer } from 'node:buffer';
import { unhexTable } from './tables.js';

/**
 * A safe fast alternative to `decodeURIComponent`.
 *
 * Walks the input byte-by-byte; `%xx` triples decode to a single byte
 * (invalid hex tails are left literal — matches Node's permissive
 * semantics). `+` decodes to `' '` iff `decodeSpaces` is true.
 *
 * @param s The string to decode.
 * @param decodeSpaces Whether to decode `+` as a space character.
 */
export function unescapeBuffer(s: string, decodeSpaces = false): Buffer {
    const out = new Buffer(s.length);
    let index = 0;
    let outIndex = 0;
    let currentChar;
    let nextChar;
    let hexHigh;
    let hexLow;
    const maxLength = s.length - 2;
    // Flag to know if some hex chars have been decoded
    let hasHex = false;
    while (index < s.length) {
        currentChar = s.charCodeAt(index);
        if (currentChar === 43 /* '+' */ && decodeSpaces) {
            out[outIndex++] = 32; // ' '
            index++;
            continue;
        }
        if (currentChar === 37 /* '%' */ && index < maxLength) {
            currentChar = s.charCodeAt(++index);
            hexHigh = unhexTable[currentChar];
            if (!(hexHigh >= 0)) {
                out[outIndex++] = 37; // '%'
                continue;
            } else {
                nextChar = s.charCodeAt(++index);
                hexLow = unhexTable[nextChar];
                if (!(hexLow >= 0)) {
                    out[outIndex++] = 37; // '%'
                    index--;
                } else {
                    hasHex = true;
                    currentChar = hexHigh * 16 + hexLow;
                }
            }
        }
        out[outIndex++] = currentChar;
        index++;
    }
    return hasHex ? out.slice(0, outIndex) : out;
}

/**
 * Decodes a URL-encoded string. Tries `decodeURIComponent()` first; on
 * failure (malformed `%xx` triple), falls back to the permissive
 * `unescapeBuffer()` walker. This matches Node's `querystring.unescape`
 * which is "best-effort": invalid encodings are preserved verbatim.
 */
export function qsUnescape(s: string): string {
    try {
        return decodeURIComponent(s);
    } catch {
        return unescapeBuffer(s).toString();
    }
}
