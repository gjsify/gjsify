// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Extracted from packages/node/querystring/src/index.ts during the
// per-concern split. Sources upstream:
//   - https://github.com/denoland/deno_std/blob/main/node/querystring.ts
//   - Node.js `lib/querystring.js` (`stringify`)
//
// Object → query-string serialization. Owns:
//   - `StringifyOptions` (options bag for `stringify`)
//   - `stringify` (the public `querystring.stringify` / `querystring.encode`)
//   - file-local helpers `stringifyPrimitive`, `encodeStringified`,
//     `encodeStringifiedCustom`
//
// Pure leaf — depends only on `./encode` (for the default `qsEscape`
// encoder).

import { qsEscape } from './encode.js';

export interface StringifyOptions {
    /** The function to use when converting URL-unsafe characters to percent-encoding in the query string. */
    encodeURIComponent: (string: string) => string;
}

/** Coerce a JS primitive to a query-string fragment per Node semantics. */
function stringifyPrimitive(v: unknown): string {
    if (typeof v === 'string') {
        return v;
    }
    if (typeof v === 'number' && isFinite(v)) {
        return '' + v;
    }
    if (typeof v === 'bigint') {
        return '' + v;
    }
    if (typeof v === 'boolean') {
        return v ? 'true' : 'false';
    }
    return '';
}

/**
 * Encode helper for the `options.encodeURIComponent`-supplied path: every
 * primitive is stringified, then handed verbatim to the user encoder.
 */
function encodeStringifiedCustom(v: unknown, encode: (string: string) => string): string {
    return encode(stringifyPrimitive(v));
}

/**
 * Encode helper for the default `qsEscape` path: short-circuits the
 * percent-encoding when the value is a safe primitive (small finite
 * numbers, bigints, booleans) — these are already safe ASCII so we skip
 * the table walk.
 */
function encodeStringified(v: unknown, encode: (string: string) => string): string {
    if (typeof v === 'string') {
        return v.length ? encode(v) : '';
    }
    if (typeof v === 'number' && isFinite(v)) {
        // Values >= 1e21 automatically switch to scientific notation which requires
        // escaping due to the inclusion of a '+' in the output
        return Math.abs(v) < 1e21 ? '' + v : encode('' + v);
    }
    if (typeof v === 'bigint') {
        return '' + v;
    }
    if (typeof v === 'boolean') {
        return v ? 'true' : 'false';
    }
    return '';
}

/**
 * Produces a URL query string from a given obj by iterating through the object's "own properties".
 * @param obj The object to serialize into a URL query string.
 * @param sep The substring used to delimit key and value pairs in the query string. Default: '&'.
 * @param eq The substring used to delimit keys and values in the query string. Default: '='.
 * @param options The stringify options
 * @param options.encodeURIComponent The function to use when converting URL-unsafe characters to percent-encoding in the query string. Default: `querystring.escape()`.
 * @legacy
 * @see Tested in `test-querystring.js`
 */
export function stringify(obj: Record<string, unknown>, sep?: string, eq?: string, options?: StringifyOptions): string {
    sep ||= '&';
    eq ||= '=';
    const encode = options ? options.encodeURIComponent : qsEscape;
    const convert = options ? encodeStringifiedCustom : encodeStringified;

    if (obj !== null && typeof obj === 'object') {
        const keys = Object.keys(obj);
        const len = keys.length;
        let fields = '';
        for (let i = 0; i < len; ++i) {
            const k = keys[i];
            const v = obj[k];
            let ks = convert(k, encode);
            ks += eq;

            if (Array.isArray(v)) {
                const vlen = v.length;
                if (vlen === 0) continue;
                if (fields) {
                    fields += sep;
                }
                for (let j = 0; j < vlen; ++j) {
                    if (j) {
                        fields += sep;
                    }
                    fields += ks;
                    fields += convert(v[j], encode);
                }
            } else {
                if (fields) {
                    fields += sep;
                }
                fields += ks;
                fields += convert(v, encode);
            }
        }
        return fields;
    }
    return '';
}
