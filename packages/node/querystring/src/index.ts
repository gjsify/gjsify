// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// https://github.com/denoland/deno_std/blob/main/node/querystring.ts
//
// Public entry. The original 1165-LoC monolith has been split into
// per-concern modules under `./internal/`:
//   - `internal/tables.ts`    — pre-computed lookup tables (data-only)
//   - `internal/encode.ts`    — `encodeStr`, `qsEscape`, `ERR_INVALID_URI`
//   - `internal/decode.ts`    — `unescapeBuffer`, `qsUnescape`
//   - `internal/parse.ts`     — `parse`, `ParseOptions`
//   - `internal/stringify.ts` — `stringify`, `StringifyOptions`
//
// This module is the public surface — it imports + re-exports the
// symbols that make up `node:querystring`'s API, sets up the legacy
// aliases (`encode`/`decode`), and exports a default object that
// matches `module.exports` shape in CJS consumers.

import type { ParsedUrlQuery } from 'node:querystring';

import { qsEscape } from './internal/encode.js';
import { qsUnescape, unescapeBuffer } from './internal/decode.js';
import { parse } from './internal/parse.js';
import { stringify } from './internal/stringify.js';

export type { ParsedUrlQuery };
export { ERR_INVALID_URI } from './internal/encode.js';
export { unescapeBuffer } from './internal/decode.js';
export { parse } from './internal/parse.js';
export { stringify } from './internal/stringify.js';

/**
 * Alias of querystring.parse()
 * @legacy
 */
export const decode = parse;

/**
 * Alias of querystring.stringify()
 * @legacy
 */
export const encode = stringify;

/**
 * Performs URL percent-encoding on the given `str` in a manner that is optimized for the specific requirements of URL query strings.
 * Used by `querystring.stringify()` and is generally not expected to be used directly.
 * It is exported primarily to allow application code to provide a replacement percent-encoding implementation if necessary by assigning `querystring.escape` to an alternative function.
 * @legacy
 * @see Tested in `test-querystring-escape.js`
 */
export const escape = qsEscape;

/**
 * Performs decoding of URL percent-encoded characters on the given `str`.
 * Used by `querystring.parse()` and is generally not expected to be used directly.
 * It is exported primarily to allow application code to provide a replacement decoding implementation if necessary by assigning `querystring.unescape` to an alternative function.
 * @legacy
 * @see Tested in `test-querystring-escape.js`
 */
export const unescape = qsUnescape;

export default {
    parse,
    stringify,
    decode,
    encode,
    unescape,
    escape,
    unescapeBuffer,
};

// Touch for the task-#75 selective-build proof run (temporary demo branch).
