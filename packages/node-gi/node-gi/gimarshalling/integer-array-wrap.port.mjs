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
