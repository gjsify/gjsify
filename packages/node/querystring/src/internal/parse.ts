// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Extracted from packages/node/querystring/src/index.ts during the
// per-concern split. Sources upstream:
//   - https://github.com/denoland/deno_std/blob/main/node/querystring.ts
//   - Node.js `lib/querystring.js` (`parse`)
//
// Query-string → object parsing. Owns:
//   - `ParseOptions` (options bag for `parse`)
//   - `parse` (the public `querystring.parse` / `querystring.decode`)
//   - file-local helpers `charCodes` + `addKeyVal`
//
// Pure leaf — depends only on `./tables` (for `isHexTable`) and
// `./decode` (for the default `qsUnescape` decoder).

import type { ParsedUrlQuery } from 'node:querystring';

import { qsUnescape } from './decode.js';
import { isHexTable } from './tables.js';

export interface ParseOptions {
    /** The function to use when decoding percent-encoded characters in the query string. */
    decodeURIComponent?: (string: string) => string;
    /** Specifies the maximum number of keys to parse. */
    maxKeys?: number;
}

/** Build an array of character codes for the separator/eq matchers. */
function charCodes(str: string): number[] {
    const ret = Array.from<number>({ length: str.length });
    for (let i = 0; i < str.length; ++i) {
        ret[i] = str.charCodeAt(i);
    }
    return ret;
}

/**
 * Insert a `(key, value)` pair into the result object — decoding lazily
 * when an encoded byte was actually detected during the scan.
 *
 * If a key already exists, the value is promoted to an array (or
 * appended to an existing array). Matches Node's `qs.parse` semantics:
 * arrays grow in insertion order, no `[]` suffix is required.
 */
function addKeyVal(
    obj: ParsedUrlQuery,
    key: string,
    value: string,
    keyEncoded: boolean,
    valEncoded: boolean,
    decode: (encodedURIComponent: string) => string,
) {
    if (key.length > 0 && keyEncoded) {
        try {
            key = decode(key);
        } catch {
            // If decode throws, use the raw key as-is
        }
    }
    if (value.length > 0 && valEncoded) {
        try {
            value = decode(value);
        } catch {
            // If decode throws, use the raw value as-is
        }
    }

    if (obj[key] === undefined) {
        obj[key] = value;
    } else {
        const curValue = obj[key];
        // A simple Array-specific property check is enough here to
        // distinguish from a string value and is faster and still safe
        // since we are generating all of the values being assigned.
        if ((curValue as string[]).pop) {
            (curValue as string[])[curValue!.length] = value;
        } else {
            obj[key] = [curValue as string, value];
        }
    }
}

/**
 * Parses a URL query string into a collection of key and value pairs.
 * @param str The URL query string to parse
 * @param sep The substring used to delimit key and value pairs in the query string. Default: '&'.
 * @param eq The substring used to delimit keys and values in the query string. Default: '='.
 * @param options The parse options
 * @param options.decodeURIComponent The function to use when decoding percent-encoded characters in the query string. Default: `querystring.unescape()`.
 * @param options.maxKeys Specifies the maximum number of keys to parse. Specify `0` to remove key counting limitations. Default: `1000`.
 * @legacy
 * @see Tested in test-querystring.js
 */
export function parse(
    str: string,
    sep = '&',
    eq = '=',
    { decodeURIComponent = qsUnescape, maxKeys = 1000 }: ParseOptions = {},
): ParsedUrlQuery {
    const obj: ParsedUrlQuery = Object.create(null);

    if (typeof str !== 'string' || str.length === 0) {
        return obj;
    }

    const sepCodes = !sep ? [38] /* & */ : charCodes(String(sep));
    const eqCodes = !eq ? [61] /* = */ : charCodes(String(eq));
    const sepLen = sepCodes.length;
    const eqLen = eqCodes.length;

    let pairs = 1000;
    if (typeof maxKeys === 'number') {
        // -1 is used in place of a value like Infinity for meaning
        // "unlimited pairs" because of additional checks V8 (at least as of v5.4)
        // has to do when using variables that contain values like Infinity. Since
        // `pairs` is always decremented and checked explicitly for 0, -1 works
        // effectively the same as Infinity, while providing a significant
        // performance boost.
        pairs = maxKeys > 0 ? maxKeys : -1;
    }

    let decode = qsUnescape;
    if (decodeURIComponent) {
        decode = decodeURIComponent;
    }
    const customDecode = decode !== qsUnescape;

    let lastPos = 0;
    let sepIdx = 0;
    let eqIdx = 0;
    let key = '';
    let value = '';
    let keyEncoded = customDecode;
    let valEncoded = customDecode;
    const plusChar = customDecode ? '%20' : ' ';
    let encodeCheck = 0;
    for (let i = 0; i < str.length; ++i) {
        const code = str.charCodeAt(i);

        // Try matching key/value pair separator (e.g. '&')
        if (code === sepCodes[sepIdx]) {
            if (++sepIdx === sepLen) {
                // Key/value pair separator match!
                const end = i - sepIdx + 1;
                if (eqIdx < eqLen) {
                    // We didn't find the (entire) key/value separator
                    if (lastPos < end) {
                        // Treat the substring as part of the key instead of the value
                        key += str.slice(lastPos, end);
                    } else if (key.length === 0) {
                        // We saw an empty substring between separators
                        if (--pairs === 0) {
                            return obj;
                        }
                        lastPos = i + 1;
                        sepIdx = eqIdx = 0;
                        continue;
                    }
                } else if (lastPos < end) {
                    value += str.slice(lastPos, end);
                }

                addKeyVal(obj, key, value, keyEncoded, valEncoded, decode);

                if (--pairs === 0) {
                    return obj;
                }
                key = value = '';
                encodeCheck = 0;
                lastPos = i + 1;
                sepIdx = eqIdx = 0;
            }
        } else {
            sepIdx = 0;
            // Try matching key/value separator (e.g. '=') if we haven't already
            if (eqIdx < eqLen) {
                if (code === eqCodes[eqIdx]) {
                    if (++eqIdx === eqLen) {
                        // Key/value separator match!
                        const end = i - eqIdx + 1;
                        if (lastPos < end) {
                            key += str.slice(lastPos, end);
                        }
                        encodeCheck = 0;
                        lastPos = i + 1;
                    }
                    continue;
                } else {
                    eqIdx = 0;
                    if (!keyEncoded) {
                        // Try to match an (valid) encoded byte once to minimize unnecessary
                        // calls to string decoding functions
                        if (code === 37 /* % */) {
                            encodeCheck = 1;
                            continue;
                        } else if (encodeCheck > 0) {
                            if (isHexTable[code] === 1) {
                                if (++encodeCheck === 3) {
                                    keyEncoded = true;
                                }
                                continue;
                            } else {
                                encodeCheck = 0;
                            }
                        }
                    }
                }
                if (code === 43 /* + */) {
                    if (lastPos < i) {
                        key += str.slice(lastPos, i);
                    }
                    key += plusChar;
                    lastPos = i + 1;
                    continue;
                }
            }
            if (code === 43 /* + */) {
                if (lastPos < i) {
                    value += str.slice(lastPos, i);
                }
                value += plusChar;
                lastPos = i + 1;
            } else if (!valEncoded) {
                // Try to match an (valid) encoded byte (once) to minimize unnecessary
                // calls to string decoding functions
                if (code === 37 /* % */) {
                    encodeCheck = 1;
                } else if (encodeCheck > 0) {
                    if (isHexTable[code] === 1) {
                        if (++encodeCheck === 3) {
                            valEncoded = true;
                        }
                    } else {
                        encodeCheck = 0;
                    }
                }
            }
        }
    }

    // Deal with any leftover key or value data
    if (lastPos < str.length) {
        if (eqIdx < eqLen) {
            key += str.slice(lastPos);
        } else if (sepIdx < sepLen) {
            value += str.slice(lastPos);
        }
    } else if (eqIdx === 0 && key.length === 0) {
        // We ended on an empty substring
        return obj;
    }

    addKeyVal(obj, key, value, keyEncoded, valEncoded, decode);

    return obj;
}
