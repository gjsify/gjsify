// SPDX-License-Identifier: MIT
// @gjsify/napi — P0.1 GATE (env + value model + scopes).
//
// Runs as a legacy GJS script:
//
//   cd packages/napi/napi
//   GI_TYPELIB_PATH=build LD_LIBRARY_PATH=build timeout 30 gjs test/p01-gate.js
//
// Asserts create<->extract round-trips byte-exact for every P0.1 value kind,
// Node's exact truncation semantics, the coercions, a napi_typeof sweep,
// escapable handle scopes, the loud-stub surface, and the module file name.
// Loads BOTH test addons (two envs — the teardown probe reports both).

'use strict';

const GjsifyNapi = imports.gi.GjsifyNapi;
if (!GjsifyNapi.init()) throw new Error('GjsifyNapi.init() failed');
const loadAddon = globalThis.__gjsifyNapiLoadAddon;
delete globalThis.__gjsifyNapiLoadAddon;

let failures = 0;
function check(name, actual, expected) {
    const pass = Object.is(actual, expected);
    if (!pass) {
        failures++;
        printerr(`FAIL ${name}: got ${String(actual)}, expected ${String(expected)}`);
    }
}
function checkThrows(name, fn) {
    try {
        fn();
        failures++;
        printerr(`FAIL ${name}: expected a throw`);
    } catch (_err) {
        // expected
    }
}

const v = loadAddon('test/values-addon/build/Release/values.node');
const hello = loadAddon('test/hello-addon/build/Release/hello.node');

// ---- doubles (Object.is: NaN and -0 exact) ----
check('rtDouble(3.14)', v.rtDouble(3.14), 3.14);
check('rtDouble(-0)', v.rtDouble(-0), -0);
check('rtDouble(NaN)', v.rtDouble(NaN), NaN);
check('rtDouble(Infinity)', v.rtDouble(Infinity), Infinity);
check('rtDouble(-Infinity)', v.rtDouble(-Infinity), -Infinity);
// napi_number_expected is a STATUS, not a JS throw: the addon returns NULL
// with no pending exception, so the trampoline yields undefined.
check('rtDouble("x") -> undefined (status, no throw)', v.rtDouble('x'), undefined);

// ---- int32: ECMA ToInt32 (modulo 2^32, NaN/Inf -> 0) ----
check('int32Of(42)', v.int32Of(42), 42);
check('int32Of(2^31)', v.int32Of(2147483648), -2147483648);
check('int32Of(4.7)', v.int32Of(4.7), 4);
check('int32Of(-4.7)', v.int32Of(-4.7), -4);
check('int32Of(NaN)', v.int32Of(NaN), 0);
check('int32Of(Infinity)', v.int32Of(Infinity), 0);

// ---- uint32: ECMA ToUint32 ----
check('uint32Of(-1)', v.uint32Of(-1), 4294967295);
check('uint32Of(2^32+5)', v.uint32Of(4294967301), 5);
check('uint32Of(3.9)', v.uint32Of(3.9), 3);

// ---- int64: truncate toward zero, SATURATE at int64 range, NaN/Inf -> 0 ----
check('int64Of(2^53)', v.int64Of(9007199254740992), 9007199254740992);
check('int64Of(-2^53)', v.int64Of(-9007199254740992), -9007199254740992);
check('int64Of(4.7)', v.int64Of(4.7), 4);
check('int64Of(NaN)', v.int64Of(NaN), 0);
check('int64Of(Infinity)', v.int64Of(Infinity), 0);
check('int64Of(-Infinity)', v.int64Of(-Infinity), 0);
// 2^63 saturates to INT64_MAX; create_int64 renders it as double -> 2^63.
check('int64Of(1e300) saturates', v.int64Of(1e300), 9223372036854775808);
check('int64Of(-1e300) saturates', v.int64Of(-1e300), -9223372036854775808);

// ---- bool ----
check('rtBool(true)', v.rtBool(true), true);
check('rtBool(false)', v.rtBool(false), false);

// ---- bigint int64 ----
check('rtBigint(123n)', v.rtBigint(123n), 123n);
check('rtBigint(-1n)', v.rtBigint(-1n), -1n);
check('rtBigint(INT64_MAX)', v.rtBigint(9223372036854775807n), 9223372036854775807n);
check('rtBigint(INT64_MIN)', v.rtBigint(-9223372036854775808n), -9223372036854775808n);
// 2^64+5 truncates two's-complement to 5; lossless=false.
check('rtBigint(2^64+5)', v.rtBigint(18446744073709551621n), 5n);
check('bigintLossless(5n)', v.bigintLossless(5n), true);
check('bigintLossless(2^64+5)', v.bigintLossless(18446744073709551621n), false);

// ---- strings ----
check('rtUtf8 ascii', v.rtUtf8('hello'), 'hello');
check('rtUtf8 umlauts', v.rtUtf8('héllo wörld'), 'héllo wörld');
check('rtUtf8 astral', v.rtUtf8('clef: \u{1D11E}'), 'clef: \u{1D11E}');
check('rtUtf8 empty', v.rtUtf8(''), '');
check('rtUtf16 astral', v.rtUtf16('\u{1D11E}clef'), '\u{1D11E}clef');
check('rtUtf16 empty', v.rtUtf16(''), '');
// Latin1: byte-preserving <= 0xFF; UTF-16 units truncated to the low byte.
check('latin1Of latin1', v.latin1Of('Aéÿ'), 'Aéÿ');
check('latin1Of truncates 0x141', v.latin1Of('ŁB'), 'AB');
check('latin1Of truncates 0x100', v.latin1Of('ĀB'), '\u0000B');
// utf8 byte lengths (excluding NUL): 'héllo' = 6 bytes, astral pair = 4.
check('utf8Len ascii', v.utf8Len('hello'), 5);
check('utf8Len umlaut', v.utf8Len('héllo'), 6);
check('utf8Len astral', v.utf8Len('\u{1D11E}'), 4);
check('utf16Len astral', v.utf16Len('\u{1D11E}x'), 3);
// 3-byte buffer = 2 payload bytes: 'h'+'é' would split the 2-byte 'é' -> 'h'.
check('utf8Truncated boundary', v.utf8Truncated('héllo'), 'h');
check('utf8Truncated ascii', v.utf8Truncated('hello'), 'he');

// ---- singletons ----
const s = v.singletons();
check('singletons undef', s.undef, undefined);
check('singletons null', s.nul, null);
check('singletons true', s.t, true);
check('singletons false', s.f, false);
check('singletons global', s.glob, globalThis);

// ---- coercions ----
check('coerceBool(0)', v.coerceBool(0), false);
check('coerceBool("")', v.coerceBool(''), false);
check('coerceBool("x")', v.coerceBool('x'), true);
check('coerceBool(null)', v.coerceBool(null), false);
check('coerceNumber("42")', v.coerceNumber('42'), 42);
check('coerceNumber("")', v.coerceNumber(''), 0);
check('coerceNumber(true)', v.coerceNumber(true), 1);
check('coerceNumber(null)', v.coerceNumber(null), 0);
check('coerceNumber(undefined)', v.coerceNumber(undefined), NaN);
check('coerceNumber(valueOf)', v.coerceNumber({ valueOf: () => 7 }), 7);
check('coerceString(42)', v.coerceString(42), '42');
check('coerceString(null)', v.coerceString(null), 'null');
check('coerceString([1,2])', v.coerceString([1, 2]), '1,2');
check('coerceObject(42) boxes', typeof v.coerceObject(42), 'object');
check('coerceObject(42) valueOf', v.coerceObject(42).valueOf(), 42);
// ToNumber(Symbol) / ToObject(null) throw TypeErrors that must propagate.
checkThrows('coerceNumber(Symbol()) throws', () => v.coerceNumber(Symbol('x')));
checkThrows('coerceObject(null) throws', () => v.coerceObject(null));
checkThrows('coerceObject(undefined) throws', () => v.coerceObject(undefined));
// A throwing valueOf propagates the user exception.
checkThrows('coerceNumber(throwing valueOf) throws', () =>
    v.coerceNumber({ valueOf: () => { throw new Error('boom'); } }));

// ---- typeof sweep ----
check('typeof undefined', v.typeofName(undefined), 'undefined');
check('typeof null', v.typeofName(null), 'null');
check('typeof boolean', v.typeofName(true), 'boolean');
check('typeof number', v.typeofName(1.5), 'number');
check('typeof string', v.typeofName('s'), 'string');
check('typeof symbol', v.typeofName(Symbol('s')), 'symbol');
check('typeof object', v.typeofName({}), 'object');
check('typeof function', v.typeofName(() => 0), 'function');
check('typeof bigint', v.typeofName(1n), 'bigint');

// ---- napi_create_symbol ----
const sym = v.makeSymbol('desc');
check('makeSymbol typeof', typeof sym, 'symbol');
check('makeSymbol description', sym.description, 'desc');

// ---- escapable scopes ----
check('escapeTest', v.escapeTest(), 'escaped');
check('scopeMismatchDetected', v.scopeMismatchDetected(), true);

// ---- loud stubs + last_error ----
check('stubCheck (napi_create_array -> generic failure + message)', v.stubCheck(), true);

// ---- module surface ----
check('version()', v.version(), 10);
const file = v.fileName();
check('fileName file:// prefix', file.startsWith('file://'), true);
check('fileName suffix', file.endsWith('/values.node'), true);

// ---- P0.0 surface stays green (second env in the same process) ----
check('hello() still works', hello.hello(), 'hi');

// GC stress across the whole surface: everything above survives a full GC.
imports.system.gc();
check('rtUtf8 after GC', v.rtUtf8('post-gc'), 'post-gc');
check('escapeTest after GC', v.escapeTest(), 'escaped');
check('hello after GC', hello.hello(), 'hi');

if (failures > 0) throw new Error(`${failures} check(s) failed`);
print('P0.1 GATE: PASS');
