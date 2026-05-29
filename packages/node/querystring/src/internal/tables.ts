// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Extracted from packages/node/querystring/src/index.ts during the
// per-concern split. Sources upstream:
//   - https://github.com/denoland/deno_std/blob/main/node/querystring.ts
//   - Node.js `lib/querystring.js` (`hexTable`, `isHexTable`, `noEscape`,
//     `unhexTable` static lookup tables)
//
// Pure-data leaf module. Holds the four pre-computed `Int8Array` /
// `string[]` lookup tables used by the encode/decode paths. Lives on its
// own so the heavier parse/stringify/encode/decode modules can stay focused
// on logic; tables are referenced via direct named imports — no runtime
// side-effects. Tables compacted to 16-entry-per-line rows for legibility
// (one row per ASCII code block); values are byte-identical to the
// pre-split monolith and the upstream deno_std + Node sources.

/**
 * Pre-computed hex table: `hexTable[c]` is the percent-encoded form
 * of byte `c` (e.g. `hexTable[0x20] === '%20'`).
 */
export const hexTable: string[] = Array.from<string>({ length: 256 });
for (let i = 0; i < 256; ++i) {
    hexTable[i] = '%' + ((i < 16 ? '0' : '') + i.toString(16)).toUpperCase();
}

/**
 * Hex-character lookup table: `isHexTable[c]` is `1` iff `c` is the
 * ASCII code of a `[0-9A-Fa-f]` character; `0` otherwise.
 *
 * Used by `parse()` to detect percent-encoded bytes without invoking
 * the decoder.
 */
// prettier-ignore
export const isHexTable = new Int8Array([
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, //   0 -  15
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, //  16 -  31
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, //  32 -  47
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, //  48 -  63 ('0'-'9')
    0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, //  64 -  79 ('A'-'F')
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, //  80 -  95
    0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, //  96 - 111 ('a'-'f')
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 112 - 127
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 128 - 143
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 144 - 159
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 160 - 175
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 176 - 191
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 192 - 207
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 208 - 223
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 224 - 239
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 240 - 255
]);

/**
 * No-escape table for `qsEscape()`: `noEscape[c]` is `1` iff byte `c`
 * does NOT need percent-encoding when generating a query string.
 *
 * These characters do not need escaping when generating query strings:
 * `!` `-` `.` `_` `~` `'` `(` `)` `*` digits alpha (upper + lower).
 */
// prettier-ignore
export const noEscape = new Int8Array([
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, //   0 -  15
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, //  16 -  31
    0, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 1, 1, 0, //  32 -  47 (' !"#$%&\'()*+,-./')
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, //  48 -  63 ('0-9:;<=>?')
    0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, //  64 -  79 ('@A-O')
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1, //  80 -  95 ('P-Z[\\]^_')
    0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, //  96 - 111 ('`a-o')
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 0, // 112 - 127 ('p-z{|}~DEL')
]);

/**
 * Hex-decode lookup table: `unhexTable[c]` is the integer value of byte
 * `c` interpreted as a hex digit (`0..15`), or `-1` if `c` is not a hex
 * character.
 */
// prettier-ignore
export const unhexTable = new Int8Array([
    -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, //   0 -  15
    -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, //  16 -  31
    -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, //  32 -  47
    +0, +1, +2, +3, +4, +5, +6, +7, +8, +9, -1, -1, -1, -1, -1, -1, //  48 -  63 ('0'-'9')
    -1, 10, 11, 12, 13, 14, 15, -1, -1, -1, -1, -1, -1, -1, -1, -1, //  64 -  79 ('A'-'F')
    -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, //  80 -  95
    -1, 10, 11, 12, 13, 14, 15, -1, -1, -1, -1, -1, -1, -1, -1, -1, //  96 - 111 ('a'-'f')
    -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, // 112 - 127
    -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, // 128 - 143
    -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, // 144 - 159
    -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, // 160 - 175
    -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, // 176 - 191
    -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, // 192 - 207
    -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, // 208 - 223
    -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, // 224 - 239
    -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, // 240 - 255
]);
