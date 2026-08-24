export { strict as default, strict } from '../index.js';
export {
    AssertionError,
    ok,
    fail,
    ifError,
    match,
    doesNotMatch,
    throws,
    doesNotThrow,
    rejects,
    doesNotReject,
    strictEqual,
    notStrictEqual,
    deepStrictEqual,
    notDeepStrictEqual,
    strictEqual as equal,
    notStrictEqual as notEqual,
    deepStrictEqual as deepEqual,
    notDeepStrictEqual as notDeepEqual,
} from '../index.js';

// The same CJS-interop as `../index.ts`, for `require('assert/strict')` — Node's
// `module.exports` there is the strict callable. This subpath has no `require`
// condition at all, so the string-export is the only path.
export { strict as 'module.exports' } from '../index.js';
