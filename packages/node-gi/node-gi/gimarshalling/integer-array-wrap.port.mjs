// SPDX-License-Identifier: MIT
// IN-array integer elements wrap like GJS (refs/gjs/gi/arg.cpp:543
// js_value_to_c_strict: ToInt32/ToUint32 truncation, 64-bit modulo 2^64).
// Expectations measured on gjs 1.88.1. The C side g_asserts the wrapped
// values, so a saturated or refused element aborts the process.
// Run via `npm run test:gimarshalling`.
import { existsSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { requireGi } from '../gi.js';
import { prependSearchPath } from '../index.js';
import { describe, expect, it } from './jasmine-shim.mjs';

const libDir = fileURLToPath(new URL('../.gi-tests/lib', import.meta.url));
if (!existsSync(join(libDir, 'GIMarshallingTests-1.0.typelib'))) {
    throw new Error('GIMarshallingTests typelib missing — run `npm run test:gimarshalling`');
}
if (
    !(process.env.LD_LIBRARY_PATH ?? '')
        .split(delimiter)
        .map((p) => resolve(p))
        .includes(resolve(libDir))
) {
    throw new Error('LD_LIBRARY_PATH lacks .gi-tests/lib — run via `npm run test:gimarshalling`');
}
prependSearchPath(libDir);

const T = requireGi('GIMarshallingTests', '1.0');

describe('IN array integer elements wrap like GJS', () => {
    it('int64: BigInt 2^64-1 wraps to -1', () => {
        expect(() => T.array_int64_in([2n ** 64n - 1n, 0, 1, 2])).not.toThrow();
    });
    it('uint64: Number -1 and BigInt 2^65-1 wrap to 2^64-1', () => {
        expect(() => T.array_uint64_in([-1, 0, 1, 2])).not.toThrow();
        expect(() => T.array_uint64_in([2n ** 65n - 1n, 0, 1, 2])).not.toThrow();
    });
    it('int16: 2^32-1 wraps to -1', () => {
        expect(() => T.array_fixed_short_in([2 ** 32 - 1, 0, 1, 2])).not.toThrow();
    });
    it('int32: 2^32-1 wraps to -1', () => {
        expect(() => T.array_fixed_int_in([2 ** 32 - 1, 0, 1, 2])).not.toThrow();
    });
});

// GList / GHashTable nodes are CHECKED, not wrapped (arg.cpp gjs_value_to_basic_gi_argument
// -> gjs_arg_set_from_js_value): out of range is a plain Error, display name "List element"
// or "Hash element". Texts measured on gjs 1.88.1.
const message = (call) => {
    try {
        call();
    } catch (e) {
        return e.message;
    }
    return 'no throw';
};

describe('GList / GHashTable integer elements are refused out of range like GJS', () => {
    it('uint32 list accepts the full range', () => {
        expect(() => T.glist_uint32_none_in([0, 2 ** 32 - 1])).not.toThrow();
    });
    it('uint32 list refuses -1 and 2^32', () => {
        expect(message(() => T.glist_uint32_none_in([-1, 0]))).toEqual(
            'value -1 is out of range for List element (type uint32)',
        );
        expect(message(() => T.glist_uint32_none_in([0, 2 ** 32]))).toEqual(
            'value 4.29497e+09 is out of range for List element (type uint32)',
        );
    });
    it('int64 hash value refuses 2^63, uint64 refuses -1n', () => {
        expect(message(() => T.ghashtable_int64_in({ 2: 2 ** 63 }))).toEqual(
            'value 9.22337e+18 is out of range for Hash element (type int64)',
        );
        expect(message(() => T.ghashtable_uint64_in({ 2: -1n }))).toEqual(
            'value -1n (modulo 2^64) is out of range for Hash element (type uint64)',
        );
    });
});
