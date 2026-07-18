// SPDX-License-Identifier: MIT
// Ported from refs/gjs/installed-tests/js/testGIMarshalling.js
// Original: Copyright (c) GNOME contributors, MIT/LGPLv2+.
// Rewritten for node:test via the local jasmine shim — behavior preserved.
//
// Tier-B conformance oracle: GJS's own installed-tests encode GJS's marshalling
// behavior against the purpose-built GIMarshallingTests-1.0 typelib (built at
// the pinned upstream revision by scripts/build-gi-test-typelibs.mjs). This
// port maps the WHOLE upstream surface: sections already green on node-gi are
// ported near-verbatim; everything else is a describeSkip stub carrying the
// upstream describe name + a phase reason. Later marshalling PRs un-skip their
// sections — this file is phase 2's acceptance gate. NEVER weaken an upstream
// assertion: a failing ported spec is either a known gap (phase skip) or a
// fidelity bug ('FIDELITY-BUG: …' reason, reported loudly).
//
// Run via `npm run test:gimarshalling` (scripts/gimarshalling.mjs) — the
// launcher builds the typelibs if missing and sets GI_TYPELIB_PATH +
// LD_LIBRARY_PATH before this process starts (dlopen cannot pick up late env
// changes), plus NODE_GI_NATIVE=build.
//
// Phase-2 roadmap taxonomy the skip reasons reference:
//   phase 2.1  BigInt-64-bit   — 64-bit ints as BigInt (in) + GJS unsafe-64-bit warnings
//   phase 2.2  arrays          — C arrays (fixed/length/zero-terminated), GArray,
//                                GPtrArray, GByteArray, GBytes, GStrv, arrays of enums
//   phase 2.3  hash-list       — GList/GSList/GHashTable containers
//   phase 2.4  structs         — plain/pointer/boxed structs, unions, raw pointers
//   phase 2.5  GValue          — GValue in/out/return + flat GValue arrays
//   phase 2.6  GType           — GType marshalling + GJS GObject-override constants
//   phase 2.7  callbacks       — GClosure + callbacks with out-params
//   phase 2.8  vfuncs          — virtual-function marshalling breadth
//   phase 2.9  gobject-breadth — subclassing/interfaces/properties/signals breadth
//   phase 2.10 gerror          — GError breadth
//   phase 2.11 misc-breadth    — multi-out configurations, filename encoding,
//                                invalid UTF-8, high-bit flags
//
// Documented adaptations from the upstream source (behavior preserved for
// everything that runs):
//   • gi:// imports → requireGi (the same rewrite the tier-A conformance twins
//     use); Gio/GObject/System imports are only needed by stubbed sections and
//     return with them.
//   • warn64/skip64: upstream's warn64 wraps 64-bit OUT/RETURN calls in GJS's
//     log-capture machinery (GLib.test_expect_message('Gjs', …) + g_test_assert)
//     around the "cannot be safely stored" warning; node-gi now emits that exact
//     g_warning (to stderr, non-fatal) but has no such capture harness, so warn64
//     just runs the call and checks the value. skip64 (64-bit IN/INOUT via a plain,
//     inaccurate JS Number) stays skipped for the SAME reason GJS skips it
//     (installed-tests skip64 → pending(gjs#271)); the accurate 64-bit IN path is
//     the now-live BigInt block. All 32-bit paths run verbatim.
//   • dev_t skipInOut: upstream passes `skipInOut: true`; the shim's skip
//     contract requires a reason, so the gjs#673 URL the upstream comment cites
//     is passed instead.
//   • testContainerMarshalling is omitted — only stubbed container sections use
//     it; it returns verbatim with phase 2.2/2.3.

import { existsSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { requireGi } from '../gi.js';
import { prependSearchPath } from '../index.js';
import {
    beforeEach,
    describe,
    describeSkip,
    expect,
    it,
    itSkip,
    jasmine,
    pending,
} from './jasmine-shim.mjs';

// ---- typelib wiring (launcher contract) --------------------------------------

const libDir = fileURLToPath(new URL('../.gi-tests/lib', import.meta.url));
if (!existsSync(join(libDir, 'GIMarshallingTests-1.0.typelib'))) {
    throw new Error(
        'GIMarshallingTests-1.0.typelib not built — run `npm run test:gimarshalling` ' +
            '(scripts/gimarshalling.mjs builds the pinned typelibs into .gi-tests/lib first)',
    );
}
const ldEntries = (process.env.LD_LIBRARY_PATH ?? '').split(delimiter).filter(Boolean).map((p) => resolve(p));
if (!ldEntries.includes(resolve(libDir))) {
    throw new Error(
        'LD_LIBRARY_PATH does not contain .gi-tests/lib — libgimarshallingtests.so would not dlopen. ' +
            'Run via `npm run test:gimarshalling`; the env must be set BEFORE the node process starts.',
    );
}
prependSearchPath(libDir);

const GIMarshallingTests = requireGi('GIMarshallingTests', '1.0');
const GLib = requireGi('GLib', '2.0');
const GObject = requireGi('GObject', '2.0');

// Some helpers to cut down on repetitive marshalling tests.
// - options.omit: the test doesn't exist, don't create a test case
// - options.skip: the test does exist, but doesn't pass, either unsupported or
//   a bug in GJS. Create the test case and mark it pending

function testReturnValue(root, value, {omit, skip, funcName = `${root}_return`} = {}) {
    if (omit)
        return;
    it('marshals as a return value', function () {
        if (skip)
            pending(skip);
        expect(GIMarshallingTests[funcName]()).toEqual(value);
    });
}

function testInParameter(root, value, {omit, skip, funcName = `${root}_in`} = {}) {
    if (omit)
        return;
    it('marshals as an in parameter', function () {
        if (skip)
            pending(skip);
        expect(() => GIMarshallingTests[funcName](value)).not.toThrow();
    });
}

function testOutParameter(root, value, {omit, skip, funcName = `${root}_out`} = {}) {
    if (omit)
        return;
    it('marshals as an out parameter', function () {
        if (skip)
            pending(skip);
        expect(GIMarshallingTests[funcName]()).toEqual(value);
    });
}

function testUninitializedOutParameter(root, defaultValue, {omit, skip, funcName = `${root}_out_uninitialized`} = {}) {
    if (omit)
        return;
    it("picks a reasonable default value when the function doesn't set the out parameter", function () {
        if (skip)
            pending(skip);
        const [success, defaultVal] = GIMarshallingTests[funcName]();
        expect(success).toBeFalse();
        expect(defaultVal).toEqual(defaultValue);
    });
}

function testInoutParameter(root, inValue, outValue,
    {omit, skip, funcName = `${root}_inout`} = {}) {
    if (omit)
        return;
    it('marshals as an inout parameter', function () {
        if (skip)
            pending(skip);
        expect(GIMarshallingTests[funcName](inValue)).toEqual(outValue);
    });
}

function testSimpleMarshalling(root, value, inoutValue, defaultValue, options = {}) {
    testReturnValue(root, value, options.returnv);
    testInParameter(root, value, options.in);
    testOutParameter(root, value, options.out);
    testUninitializedOutParameter(root, defaultValue, options.uninitOut);
    testInoutParameter(root, value, inoutValue, options.inout);
}

function testTransferMarshalling(root, value, inoutValue, defaultValue, options = {}) {
    describe('with transfer none', function () {
        testSimpleMarshalling(`${root}_none`, value, inoutValue, defaultValue, options.none);
    });
    describe('with transfer full', function () {
        const fullOptions = {
            inout: {
                skip: 'https://gitlab.gnome.org/GNOME/gobject-introspection/issues/192',
            },
        };
        Object.assign(fullOptions, options.full);
        testSimpleMarshalling(`${root}_full`, value, inoutValue, defaultValue, fullOptions);
    });
}

// Ported verbatim from upstream (installed-tests/js/testGIMarshalling.js): the
// container helper adds a `with transfer container` block on top of none/full.
// Container-IN + container-INOUT are the upstream gjs#44 skips (rebuilding a
// caller-owned container the callee then adopts element-by-element is unsupported
// there too); node-gi additionally defers ALL container INOUT (phase 2.5), which
// testSimpleMarshalling already routes through the per-call skip options below.
function testContainerMarshalling(root, value, inoutValue, defaultValue, options = {}) {
    testTransferMarshalling(root, value, inoutValue, defaultValue, options);
    describe('with transfer container', function () {
        const containerOptions = {
            in: {
                skip: 'https://gitlab.gnome.org/GNOME/gjs/issues/44',
            },
            inout: {
                skip: 'https://gitlab.gnome.org/GNOME/gjs/issues/44',
            },
        };
        Object.assign(containerOptions, options.container);
        testSimpleMarshalling(`${root}_container`, value, inoutValue, defaultValue, containerOptions);
    });
}

// ---- phase-2.2/2.3/2.4 skip reasons (scoped OUT of this container/compound-OUT
// PR; each cites the roadmap item that will land it). INOUT containers (2.5) are
// now LIVE (read-modify-write of a caller-built container round-trips like gjs;
// only the gjs-quirky transfer-full (#192) / transfer-container (#44) / 64-bit
// (#271) variants stay skipped, exactly as gjs skips them). struct FIELD access
// (2.6) and GLib.Variant/GParamSpec element marshalling (2.7) remain the deferred
// pieces the sections below route their sub-specs through. ----
// gjs pends this exact test with gjs#106 (a transfer-full caller-allocated GArray
// out the callee reallocates is unsupported upstream), so node-gi matches by skip.
const SKIP_GARRAY_CALLER_ALLOC =
    'https://gitlab.gnome.org/GNOME/gjs/issues/106 — transfer-full caller-allocated ' +
    'GArray out (the callee reallocates a caller-provided GArray); gjs pends it too';
// Struct FIELD get/set on a RETURNED struct/union is now LIVE (phase 2.6). The
// remaining struct skips are the adjacent capabilities field access does NOT cover:
const SKIP_STRUCT_CONSTRUCT =
    'struct construction — `new Ns.Struct({…})` / `new Ns.Struct()` + field writes to BUILD a struct ' +
    'instance or array; struct allocation is a later PR (field GET/SET on a RETURNED struct is live)';
const SKIP_STRUCT_ARRAY_BYVAL =
    'array of structs BY VALUE (GArray / sequential C array) — reading a by-value struct element needs ' +
    'container-element wrapping + copy (a container-marshalling gap); struct-POINTER arrays (zero-terminated ' +
    'C array, GPtrArray) + single-struct field access are live';
const SKIP_STRUCT_ARRAY_OUT =
    'array-of-struct OUT / caller-allocated struct-array OUT element marshalling is not yet supported ' +
    '(a container-OUT gap); field access on a RETURNED struct is live';
const SKIP_ENUM_FLAGS_ARRAY =
    'phase 2.2 arrays — enum/flags array elements are not yet marshalled (element-type gap), a later PR';
const SKIP_UNICHAR_ARRAY =
    'phase 2.2 arrays — unichar array elements (gunichar<->string) are not yet marshalled, a later PR';
const SKIP_GVARIANT_ARRAY =
    'phase 2.7 — arrays of GLib.Variant (boxed/variant elements) are not yet marshalled, a later PR';
const SKIP_GVALUE_ARRAY =
    'phase 2.5 GValue — arrays of GValue elements are not yet marshalled, a later PR';
// GValue RETURN/OUT auto-unbox is now LIVE (this PR): a GI function returning a
// GValue is unboxed to its contained JS value, exactly as GJS does. The remaining
// GValue skips are the adjacent capabilities the unbox direction does NOT cover:
const SKIP_GVALUE_IN =
    'phase 2.5 GValue IN — autoboxing a JS value INTO a GValue arg (JS 42 → a GValue ' +
    'holding an int, with GJS type inference) is a separate direction; GValue return/OUT unbox is live';
// GObject.Value construction + int/enum boxed-GValue IN are now LIVE (phase 3.2):
// `new GObject.Value()` + .init()/.set_*() build an explicit boxed GValue that can
// be passed IN and modified in place (the two specs below un-skipped). The remaining
// boxed-GValue skips need a capability node-gi does not have yet:
const SKIP_GVALUE_CTOR_GTYPE =
    'node-gi does not stamp `$gtype` on JS built-in constructors / enum objects, so ' +
    '`value.init(Number)` / `value.init(GIMarshallingTests.Flags)` cannot resolve a GType — a later ' +
    'PR; GObject.Value construction + int/enum boxed-GValue IN are live';
const SKIP_GVALUE_FLOAT =
    'GIMarshallingTests.gvalue_float rejects a boxed GValue as its interface IN-argument (distinct ' +
    'from the working gvalue_in_with_modification path) — a GValue-IN marshalling quirk, a later PR';

// Integer limits, defined without reference to GLib (because the GLib.MAXINT8
// etc. constants are also subject to marshalling)
const Limits = {
    int8: {
        min: -(2 ** 7),
        max: 2 ** 7 - 1,
        umax: 2 ** 8 - 1,
    },
    int16: {
        min: -(2 ** 15),
        max: 2 ** 15 - 1,
        umax: 2 ** 16 - 1,
    },
    int32: {
        min: -(2 ** 31),
        max: 2 ** 31 - 1,
        umax: 2 ** 32 - 1,
    },
    int64: {
        min: -(2 ** 63),
        max: 2 ** 63 - 1,
        umax: 2 ** 64 - 1,
        bit64: true,  // note: unsafe, values will not be accurate!
    },
    short: {},
    int: {},
    long: {},
    ssize: {
        utype: 'size',
    },
};
const BigIntLimits = {
    int64: {
        min: -(2n ** 63n),
        max: 2n ** 63n - 1n,
        umax: 2n ** 64n - 1n,
    },
};

Object.assign(Limits.short, Limits.int16);
Object.assign(Limits.int, Limits.int32);
// Platform dependent sizes; expand definitions as needed
if (GLib.SIZEOF_LONG === 8) {
    Object.assign(Limits.long, Limits.int64);
    BigIntLimits.long = Object.assign({}, BigIntLimits.int64);
} else {
    Object.assign(Limits.long, Limits.int32);
}
if (GLib.SIZEOF_SSIZE_T === 8) {
    Object.assign(Limits.ssize, Limits.int64);
    BigIntLimits.ssize = Object.assign({utype: 'size'}, BigIntLimits.int64);
} else {
    Object.assign(Limits.ssize, Limits.int32);
}

// Functions for dealing with tests that require or return unsafe 64-bit ints.
//
// warn64: OUT/RETURN of a 64-bit int. node-gi now returns a JS Number and emits
// the GJS-exact "cannot be safely stored" g_warning (to stderr, non-fatal), so the
// call RUNS and the value is checked — it round-trips through the same double
// rounding as the expected JS Number. Unlike upstream we do not assert the warning
// via GLib.test_expect_message (node-gi's L1 has no such capture harness); a
// warning on stderr is harmless and node:test does not fail on it.
function warn64(is64bit, func, ...args) {
    return func(...args);
}

// skip64: IN/INOUT of a 64-bit int passed as a PLAIN JS Number. A Number cannot
// represent 2^63-1 / 2^64-1 exactly, so it can never be verified against the C
// side — GJS skips these identically (installed-tests skip64 → pending(gjs#271)).
// The accurate 64-bit IN path is the BigInt block below (now live). NOT a node-gi
// gap: the same inherent Number-precision limitation GJS documents.
const SKIP_64BIT_NUMBER =
    'https://gitlab.gnome.org/GNOME/gjs/issues/271 — a 64-bit int IN/INOUT via a ' +
    'plain (inaccurate) JS Number cannot be verified against C; the accurate path is the ' +
    'now-live BigInt block. GJS skips these identically (installed-tests skip64).';

function skip64(is64bit) {
    if (is64bit)
        pending(SKIP_64BIT_NUMBER);
}

describe('Boolean', function () {
    [true, false].forEach(bool => {
        describe(`${bool}`, function () {
            testSimpleMarshalling('boolean', bool, !bool, false, {
                returnv: {
                    funcName: `boolean_return_${bool}`,
                },
                in: {
                    funcName: `boolean_in_${bool}`,
                },
                out: {
                    funcName: `boolean_out_${bool}`,
                },
                uninitOut: {
                    omit: true,
                },
                inout: {
                    funcName: `boolean_inout_${bool}_${!bool}`,
                },
            });
        });
    });

    testUninitializedOutParameter('boolean', false);
});

describe('Integer', function () {
    Object.entries(Limits).forEach(([type, {min, max, umax, bit64, utype = `u${type}`}]) => {
        describe(`${type}-typed`, function () {
            it('marshals signed value as a return value', function () {
                expect(warn64(bit64, GIMarshallingTests[`${type}_return_max`])).toEqual(max);
                expect(warn64(bit64, GIMarshallingTests[`${type}_return_min`])).toEqual(min);
            });

            it('marshals signed value as an in parameter', function () {
                skip64(bit64);
                expect(() => GIMarshallingTests[`${type}_in_max`](max)).not.toThrow();
                expect(() => GIMarshallingTests[`${type}_in_min`](min)).not.toThrow();
            });

            it('marshals signed value as an out parameter', function () {
                expect(warn64(bit64, GIMarshallingTests[`${type}_out_max`])).toEqual(max);
                expect(warn64(bit64, GIMarshallingTests[`${type}_out_min`])).toEqual(min);
            });

            testUninitializedOutParameter(type, 0);

            it('marshals as an inout parameter', function () {
                skip64(bit64);
                expect(GIMarshallingTests[`${type}_inout_max_min`](max)).toEqual(min);
                expect(GIMarshallingTests[`${type}_inout_min_max`](min)).toEqual(max);
            });

            it('marshals unsigned value as a return value', function () {
                expect(warn64(bit64, GIMarshallingTests[`${utype}_return`])).toEqual(umax);
            });

            it('marshals unsigned value as an in parameter', function () {
                skip64(bit64);
                expect(() => GIMarshallingTests[`${utype}_in`](umax)).not.toThrow();
            });

            it('marshals unsigned value as an out parameter', function () {
                expect(warn64(bit64, GIMarshallingTests[`${utype}_out`])).toEqual(umax);
            });

            testUninitializedOutParameter(utype, 0);

            it('marshals unsigned value as an inout parameter', function () {
                skip64(bit64);
                expect(GIMarshallingTests[`${utype}_inout`](umax)).toEqual(0);
            });
        });
    });
});

// node-gi now marshals a BigInt 64-bit argument LOSSLESSLY (GJS-exact:
// JS::ToBigInt64 / ToBigUint64), so these run live. Before the fix a BigInt arg
// fatally aborted the addon: the marshaller called ToNumber() on the BigInt, which
// sets a pending N-API error under NAPI_DISABLE_CPP_EXCEPTIONS, and the follow-up
// Napi::Error::New(napi_get_last_error_info) in JsToGIArgument became a process
// abort. The marshaller now branches on IsBigInt before any ToNumber().
describe('BigInt', function () {
    Object.entries(BigIntLimits).forEach(([type, {min, max, umax, utype = `u${type}`}]) => {
        describe(`${type}-typed`, function () {
            it('marshals signed value as an in parameter', function () {
                expect(() => GIMarshallingTests[`${type}_in_max`](max)).not.toThrow();
                expect(() => GIMarshallingTests[`${type}_in_min`](min)).not.toThrow();
            });

            it('marshals unsigned value as an in parameter', function () {
                expect(() => GIMarshallingTests[`${utype}_in`](umax)).not.toThrow();
            });
        });
    });
});

describe('Floating point', function () {
    const FloatLimits = {
        float: {
            min: 2 ** -126,
            max: (2 - 2 ** -23) * 2 ** 127,
        },
        double: {
            // GLib.MINDOUBLE is the minimum normal value, which is not the same
            // as the minimum denormal value Number.MIN_VALUE
            min: 2 ** -1022,
            max: Number.MAX_VALUE,
        },
    };

    Object.entries(FloatLimits).forEach(([type, {min, max}]) => {
        describe(`${type}-typed`, function () {
            it('marshals value as a return value', function () {
                expect(GIMarshallingTests[`${type}_return`]()).toBeCloseTo(max, 10);
            });

            testInParameter(type, max);

            it('marshals value as an out parameter', function () {
                expect(GIMarshallingTests[`${type}_out`]()).toBeCloseTo(max, 10);
            });

            testUninitializedOutParameter(type, 0);

            it('marshals value as an inout parameter', function () {
                expect(GIMarshallingTests[`${type}_inout`](max)).toBeCloseTo(min, 10);
            });

            it('can handle noncanonical NaN', function () {
                expect(GIMarshallingTests[`${type}_noncanonical_nan_out`]()).toBeNaN();
            });
        });
    });
});

describe('time_t', function () {
    testSimpleMarshalling('time_t', 1234567890, 0, 0);
});

describe('off_t', function () {
    testSimpleMarshalling('off_t', 1234567890, 0, 0);
});

function testUnixIntegerTypedefMarshalling(type, inValue, skipAny = {}) {
    describe(type, function () {
        const skip = GIMarshallingTests[`${type}_in`] ? false : 'Only supported on Unix';
        testSimpleMarshalling(type, inValue, 0, 0, {
            returnv: {skip: skip || skipAny.skipReturn},
            in: {skip: skip || skipAny.skipIn},
            out: {skip: skip || skipAny.skipOut},
            uninitOut: {skip: skip || skipAny.skipUninitOut},
            inout: {skip: skip || skipAny.skipInOut},
        });
    });
}

// https://gitlab.gnome.org/GNOME/gjs/-/issues/673
// ADAPTATION: upstream passes `skipInOut: true`; the shim's skip contract
// requires a reason, so the issue URL the comment above cites is passed.
testUnixIntegerTypedefMarshalling('dev_t', 1234567890, {skipInOut: 'https://gitlab.gnome.org/GNOME/gjs/-/issues/673'});
testUnixIntegerTypedefMarshalling('gid_t', 65534);
testUnixIntegerTypedefMarshalling('pid_t', 12345);
testUnixIntegerTypedefMarshalling('socklen_t', 123);
testUnixIntegerTypedefMarshalling('uid_t', 65534);

// The GObject.TYPE_* fundamental constants now EXIST in the L1 GObject overlay
// (resolved via the introspected GObject.type_from_name, like GJS's override —
// see gi.js GTYPE_CONSTANT_NAMES) and are validated byte-for-byte against gjs by
// the tier-A conformance program conformance/programs/gtype-constants.conf.mjs.
// The gimarshalling GType section still cannot run, for TWO independent reasons
// (verified against the built typelib):
//   1. GType OUT/INOUT params are not marshalled yet — gtype_out / gtype_string_out
//      / gtype_inout throw "OUT type tag 12 (GI_TYPE_TAG_GTYPE) parameters are not
//      yet supported", so testSimpleMarshalling's out/inout expansions fail.
//   2. The two "implicitly converted" specs need GJS's GObject dummy-type aliases
//      (GObject.VoidType / Int / … carrying `$gtype`) + JS-type→GType coercion
//      (String → G_TYPE_STRING). node-gi has neither, and gtype_in(GObject.VoidType)
//      passes an undefined/wrong GType → the C library g_asserts FATALLY (SIGABRT,
//      gimarshallingtests.c:1571 `gtype == G_TYPE_NONE`), which would abort the whole
//      run. Both are out of scope for the TYPE_* constants fix — keep skipped until
//      GType OUT marshalling + the JS-type→GType aliases land.
describeSkip('phase 2.6 GType — needs GType OUT-param marshalling (tag 12) + GJS GObject dummy-type aliases/JS-type→GType coercion; TYPE_* constants now exist (see gtype-constants.conf.mjs). gtype_in(GObject.VoidType) g_asserts fatally in the C lib',
    'GType');

describe('UTF-8 string', function () {
    testTransferMarshalling('utf8', 'const ♥ utf8', '', null, {
        full: {
            uninitOut: {omit: true}, // covered by utf8_dangling_out() test below
        },
    });

    // node-gi now accepts a JS STRING for a uint8/int8-element array arg,
    // encoding it to UTF-8 bytes exactly as GJS does (refs/gjs/gi/arg.cpp
    // "Allow strings as int8/uint8/int16/uint16 arrays" → gjs_string_to_intarray).
    // The rest of the array phase (2.2) stays skipped; only this string→uint8array
    // path is live. Verified: gjs -m accepts the same call without throwing.
    it('marshals value as a byte array', function () {
        expect(() => GIMarshallingTests.utf8_as_uint8array_in('const ♥ utf8')).not.toThrow();
    });

    it('makes a default out value for a broken C function', function () {
        expect(GIMarshallingTests.utf8_dangling_out()).toBeNull();
    });
});

// INOUT array in the style of gtk_init(): a caller-owned strv the callee
// reads + reallocates (transfer full, modified in place). Now LIVE (INOUT
// containers). Verified byte-for-byte against gjs 1.88.
describe('In-out array in the style of gtk_init()', function () {
    it('marshals null', function () {
        const [, newArray] = GIMarshallingTests.init_function(null);
        expect(newArray).toEqual([]);
    });

    it('marshals an inout empty array', function () {
        const [ret, newArray] = GIMarshallingTests.init_function([]);
        expect(ret).toBeTrue();
        expect(newArray).toEqual([]);
    });

    it('marshals an inout array', function () {
        const [ret, newArray] = GIMarshallingTests.init_function(['--foo', '--bar']);
        expect(ret).toBeTrue();
        expect(newArray).toEqual(['--foo']);
    });
});

describe('Fixed-size C array', function () {
    describe('of ints', function () {
        testReturnValue('array_fixed_int', [-1, 0, 1, 2]);
        testInParameter('array_fixed_int', [-1, 0, 1, 2]);
        testOutParameter('array_fixed', [-1, 0, 1, 2]);
        testUninitializedOutParameter('array_fixed', null);
        testOutParameter('array_fixed_caller_allocated', [-1, 0, 1, 2]);
        testInoutParameter('array_fixed', [-1, 0, 1, 2], [2, 1, 0, -1]);
    });

    describe('of shorts', function () {
        testReturnValue('array_fixed_short', [-1, 0, 1, 2]);
        testInParameter('array_fixed_short', [-1, 0, 1, 2]);
    });

    // array_fixed_out_struct returns a fixed array of structs BY VALUE — the array
    // element marshalling (OUT struct/union/enum elements) is a container-OUT gap,
    // distinct from the now-live single-struct field access.
    itSkip(SKIP_STRUCT_ARRAY_OUT, 'marshals a struct array as an out parameter', function () {
        expect(GIMarshallingTests.array_fixed_out_struct()).toEqual([
            jasmine.objectContaining({long_: 7, int8: 6}),
            jasmine.objectContaining({long_: 6, int8: 7}),
        ]);
    });

    it('picks a reasonable default for struct array out param when uninitialized', function () {
        expect(GIMarshallingTests.array_fixed_out_struct_uninitialized()).toEqual([false, null]);
    });

    itSkip(SKIP_STRUCT_ARRAY_OUT, 'marshals a fixed-size struct array as caller allocated out param', function () {
        expect(GIMarshallingTests.array_fixed_caller_allocated_struct_out()).toEqual([
            jasmine.objectContaining({long_: -2, int8: -1}),
            jasmine.objectContaining({long_: 1, int8: 2}),
            jasmine.objectContaining({long_: 3, int8: 4}),
            jasmine.objectContaining({long_: 5, int8: 6}),
        ]);
    });

    for (const marshal of ['return', 'out']) {
        it(`handles a ${marshal} array with odd alignment`, function () {
            const arr = GIMarshallingTests[`array_fixed_${marshal}_unaligned`]();
            expect(arr.length).toEqual(32);
            expect(Array.prototype.slice.call(arr, 0, 4)).toEqual([1, 2, 3, 4]);
            GIMarshallingTests.cleanup_unaligned_buffer();
        });
    }
});

describe('C array with length', function () {
    testSimpleMarshalling('array', [-1, 0, 1, 2], [-2, -1, 0, 1, 2], []);

    it('can be returned along with other arguments', function () {
        let [array, sum] = GIMarshallingTests.array_return_etc(9, 5);
        expect(sum).toEqual(14);
        expect(array).toEqual([9, 0, 1, 5]);
    });

    it('can be passed to a function with its length parameter before it', function () {
        expect(() => GIMarshallingTests.array_in_len_before([-1, 0, 1, 2])).not.toThrow();
    });

    it('can be passed to a function with zero terminator', function () {
        expect(() => GIMarshallingTests.array_in_len_zero_terminated([-1, 0, 1, 2])).not.toThrow();
    });

    describe('of strings', function () {
        testInParameter('array_string', ['foo', 'bar']);
    });

    it('marshals a byte array as an in parameter', function () {
        expect(() => GIMarshallingTests.array_uint8_in('abcd')).not.toThrow();
        expect(() => GIMarshallingTests.array_uint8_in([97, 98, 99, 100])).not.toThrow();
        expect(() => GIMarshallingTests.array_uint8_in(new TextEncoder().encode('abcd'))).not.toThrow();
    });

    describe('of signed 64-bit ints', function () {
        testInParameter('array_int64', [-1, 0, 1, 2]);
    });

    describe('of unsigned 64-bit ints', function () {
        testInParameter('array_uint64', [-1, 0, 1, 2]);
    });

    describe('of unichars', function () {
        itSkip(SKIP_UNICHAR_ARRAY, 'marshals as an in parameter', function () {
            expect(() => GIMarshallingTests.array_unichar_in('const ♥ utf8')).not.toThrow();
        });
        itSkip(SKIP_UNICHAR_ARRAY, 'marshals as an out parameter', function () {
            expect(GIMarshallingTests.array_unichar_out()).toEqual('const ♥ utf8');
        });
        itSkip(SKIP_UNICHAR_ARRAY, 'marshals from an array of codepoints', function () {
            const codepoints = [...'const ♥ utf8'].map(c => c.codePointAt(0));
            expect(() => GIMarshallingTests.array_unichar_in(codepoints)).not.toThrow();
        });
    });

    describe('of booleans', function () {
        testInParameter('array_bool', [true, false, true, true]);
        testOutParameter('array_bool', [true, false, true, true]);

        it('marshals from an array of numbers', function () {
            expect(() => GIMarshallingTests.array_bool_in([-1, 0, 1, 2])).not.toThrow();
        });
    });

    // Boxed/simple struct array IN builds the input with `new StructType(); struct.long_ = n`
    // — the field WRITE is live, but constructing the struct (`new StructType()`) is not.
    describeSkip(SKIP_STRUCT_CONSTRUCT, 'of boxed structs');
    describeSkip(SKIP_STRUCT_CONSTRUCT, 'of simple structs');

    itSkip(SKIP_GVALUE_ARRAY, 'marshals two arrays with the same length parameter', function () {
        // multi_array_key_value_in(length, const gchar** keys, const GValue* values)
        // — the values are a GValue array (2.5), not a plain int array.
        const keys = ['one', 'two', 'three'];
        const values = [1, 2, 3];
        expect(() => GIMarshallingTests.multi_array_key_value_in(keys, values)).not.toThrow();
    });

    itSkip(SKIP_STRUCT_CONSTRUCT, 'copies correctly on transfer full', function () {
        // array_struct_take_in takes a boxed-struct array built via `new BoxedStruct()`
        // + field writes; the field writes are live, struct construction is not.
        expect(() => {}).not.toThrow();
    });

    describe('of enums', function () {
        testInParameter('array_enum', [
            GIMarshallingTests.Enum.VALUE1,
            GIMarshallingTests.Enum.VALUE2,
            GIMarshallingTests.Enum.VALUE3,
        ], {skip: SKIP_ENUM_FLAGS_ARRAY});
    });

    describe('of flags', function () {
        testInParameter('array_flags', [
            GIMarshallingTests.Flags.VALUE1,
            GIMarshallingTests.Flags.VALUE2,
            GIMarshallingTests.Flags.VALUE3,
        ], {skip: SKIP_ENUM_FLAGS_ARRAY});
    });

    it('marshals an array with a 64-bit length parameter', function () {
        expect(() => GIMarshallingTests.array_in_guint64_len([-1, 0, 1, 2])).not.toThrow();
    });

    it('marshals an array with an 8-bit length parameter', function () {
        expect(() => GIMarshallingTests.array_in_guint8_len([-1, 0, 1, 2])).not.toThrow();
    });

    it('can be an in-out argument', function () {
        const array = GIMarshallingTests.array_inout([-1, 0, 1, 2]);
        expect(array).toEqual([-2, -1, 0, 1, 2]);
    });

    it('can be an out argument along with other arguments', function () {
        let [array, sum] = GIMarshallingTests.array_out_etc(9, 5);
        expect(sum).toEqual(14);
        expect(array).toEqual([9, 0, 1, 5]);
    });

    it('can be an in-out argument along with other arguments', function () {
        let [array, sum] = GIMarshallingTests.array_inout_etc(9, [-1, 0, 1, 2], 5);
        expect(sum).toEqual(14);
        expect(array).toEqual([9, -1, 0, 1, 5]);
    });

    it('does not interpret an unannotated integer as a length parameter', function () {
        expect(() => GIMarshallingTests.array_in_nonzero_nonlen(42, 'abcd')).not.toThrow();
    });

    for (const marshal of ['return', 'out']) {
        it(`handles a ${marshal} array with odd alignment`, function () {
            const arr = GIMarshallingTests[`array_${marshal}_unaligned`]();
            expect(arr.length).toEqual(32);
            expect(Array.prototype.slice.call(arr, 0, 4)).toEqual([1, 2, 3, 4]);
            GIMarshallingTests.cleanup_unaligned_buffer();
        });
    }

    it('supports optional inout array with length', function () {
        expect(GIMarshallingTests.length_array_utf8_optional_inout(['🅰', 'β', 'c', 'd']))
            .toEqual(['a', 'b', '¢', '🔠']);
    });
});

describe('Zero-terminated C array', function () {
    describe('of strings', function () {
        testSimpleMarshalling('array_zero_terminated', ['0', '1', '2'],
            ['-1', '0', '1', '2'], null);
    });

    it('marshals null as a zero-terminated array return value', function () {
        expect(GIMarshallingTests.array_zero_terminated_return_null()).toEqual(null);
    });

    // A zero-terminated array of struct POINTERS: field access on each element (2.6).
    it('marshals an array of structs as a return value', function () {
        let structArray = GIMarshallingTests.array_zero_terminated_return_struct();
        expect(structArray.map(e => e.long_)).toEqual([42, 43, 44]);
    });

    itSkip(SKIP_STRUCT_ARRAY_BYVAL, 'marshals an array of sequential structs as a return value', function () {
        let structArray = GIMarshallingTests.array_zero_terminated_return_sequential_struct();
        expect(structArray.map(e => e.long_)).toEqual([42, 43, 44]);
    });

    itSkip(SKIP_UNICHAR_ARRAY, 'marshals an array of unichars as a return value', function () {
        expect(GIMarshallingTests.array_zero_terminated_return_unichar()).toEqual('const ♥ utf8');
    });

    describeSkip(SKIP_GVARIANT_ARRAY, 'of GLib.Variants');
});

describe('Exhaustive test of UTF-8 sequences', function () {
    ['length', 'fixed', 'zero_terminated'].forEach(arrayKind =>
        ['none', 'container', 'full'].forEach(transfer => {
            const testFunction = returnMode => {
                const commonName = 'array_utf8';
                const funcName = [arrayKind, commonName, transfer, returnMode].join('_');
                return GIMarshallingTests[funcName];
            };

            ['out', 'return'].forEach(returnMode =>
                it(`${arrayKind} ${returnMode} transfer ${transfer}`, function () {
                    const func = testFunction(returnMode);
                    expect(func()).toEqual(['a', 'b', '¢', '🔠']);
                }));

            it(`${arrayKind} in transfer ${transfer}`, function () {
                const func = testFunction('in');
                if (transfer === 'container')
                    pending('https://gitlab.gnome.org/GNOME/gjs/-/issues/44');

                expect(() => func(['🅰', 'β', 'c', 'd'])).not.toThrow();
            });

            it(`${arrayKind} inout transfer ${transfer}`, function () {
                const func = testFunction('inout');
                if (transfer === 'container')
                    pending('https://gitlab.gnome.org/GNOME/gjs/-/issues/44');

                expect(func(['🅰', 'β', 'c', 'd'])).toEqual(['a', 'b', '¢', '🔠']);
            });
        }));
});

describe('GArray', function () {
    describe('of ints with transfer none', function () {
        testReturnValue('garray_int_none', [-1, 0, 1, 2]);
        testInParameter('garray_int_none', [-1, 0, 1, 2]);
    });

    it('marshals BigInt int64s as a transfer-none in value', function () {
        GIMarshallingTests.garray_uint64_none_in([0, BigIntLimits.int64.umax]);
    });

    it('marshals int64s as a transfer-none return value', function () {
        expect(warn64(true, GIMarshallingTests.garray_uint64_none_return))
            .toEqual([0, Limits.int64.umax]);
    });

    describe('of strings', function () {
        testContainerMarshalling('garray_utf8', ['0', '1', '2'], ['-2', '-1', '0', '1'], null);

        // caller-allocated GArray out: gjs ITSELF pends this with gjs#106 (the
        // callee reallocates a caller-provided GArray — unsupported upstream), so
        // node-gi keeps it skipped for the SAME reason (not an INOUT-container gap).
        itSkip(SKIP_GARRAY_CALLER_ALLOC, 'marshals as a transfer-full caller-allocated out parameter', function () {
            expect(GIMarshallingTests.garray_utf8_full_out_caller_allocated())
                .toEqual(['0', '1', '2']);
        });
    });

    // A GArray of structs BY VALUE — the element wrapping is a container gap.
    itSkip(SKIP_STRUCT_ARRAY_BYVAL, 'marshals boxed structs as a transfer-full return value', function () {
        expect(GIMarshallingTests.garray_boxed_struct_full_return().map(e => e.long_))
            .toEqual([42, 43, 44]);
    });

    describe('of booleans with transfer none', function () {
        testInParameter('garray_bool_none', [-1, 0, 1, 2]);
    });

    describe('of unichars', function () {
        itSkip(SKIP_UNICHAR_ARRAY, 'can be passed in with transfer none', function () {
            expect(() => GIMarshallingTests.garray_unichar_none_in('const ♥ utf8')).not.toThrow();
        });
    });
});

describe('GPtrArray', function () {
    describe('of strings', function () {
        testContainerMarshalling('gptrarray_utf8', ['0', '1', '2'], ['-2', '-1', '0', '1'], null);
    });

    describe('of structs', function () {
        // A GPtrArray of struct POINTERS: field access on each element (2.6).
        it('can be returned with transfer full', function () {
            expect(GIMarshallingTests.gptrarray_boxed_struct_full_return().map(e => e.long_))
                .toEqual([42, 43, 44]);
        });
    });
});

describe('GByteArray', function () {
    const refByteArray = Uint8Array.from([0, 49, 0xFF, 51]);

    testReturnValue('bytearray_full', refByteArray);
    testOutParameter('bytearray_full', refByteArray);
    testInoutParameter('bytearray_full', refByteArray, Uint8Array.from([104, 101, 108, 0, 0xFF]));

    it('can be passed in with transfer none', function () {
        expect(() => GIMarshallingTests.bytearray_none_in(refByteArray)).not.toThrow();
        expect(() => GIMarshallingTests.bytearray_none_in([0, 49, 0xFF, 51])).not.toThrow();
    });
});

// GBytes marshalling (phase 2.7b): `GLib.Bytes.new(array | string)` builds a GBytes,
// `.toArray()` reads it back as a Uint8Array, and a GBytes handle round-trips IN.
// The IMPLICIT Uint8Array→GBytes conversion at an IN arg stays skipped (a GBytes
// built from a JS typed array + freed after the call needs IN-arg boxed cleanup).
const SKIP_BYTES_IMPLICIT_IN =
    'implicit Uint8Array→GBytes at an IN arg — building a temporary GBytes from a JS typed array and ' +
    'freeing it after the call needs IN-arg boxed cleanup (a later PR); explicit GLib.Bytes.new + .toArray are live';
describe('GBytes', function () {
    const refByteArray = Uint8Array.from([0, 49, 0xFF, 51]);

    it('marshals as a transfer-full return value', function () {
        expect(GIMarshallingTests.gbytes_full_return().toArray()).toEqual(refByteArray);
    });

    it('can be created from an array and passed in', function () {
        let bytes = GLib.Bytes.new([0, 49, 0xFF, 51]);
        expect(() => GIMarshallingTests.gbytes_none_in(bytes)).not.toThrow();
    });

    it('can be created by returning from a function and passed in', function () {
        var bytes = GIMarshallingTests.gbytes_full_return();
        expect(() => GIMarshallingTests.gbytes_none_in(bytes)).not.toThrow();
        expect(bytes.toArray()).toEqual(refByteArray);
    });

    itSkip(SKIP_BYTES_IMPLICIT_IN, 'can be implicitly converted from a Uint8Array', function () {
        expect(() => GIMarshallingTests.gbytes_none_in(refByteArray)).not.toThrow();
    });

    it('can be created from a string and is encoded in UTF-8', function () {
        let bytes = GLib.Bytes.new('const ♥ utf8');
        expect(() => GIMarshallingTests.utf8_as_uint8array_in(bytes.toArray())).not.toThrow();
    });

    it('cannot be passed to a function expecting a byte array', function () {
        let bytes = GLib.Bytes.new([97, 98, 99, 100]);
        expect(() => GIMarshallingTests.array_uint8_in(bytes.toArray())).not.toThrow();
        expect(() => GIMarshallingTests.array_uint8_in(bytes)).toThrow();
    });
});

describe('GStrv', function () {
    testSimpleMarshalling('gstrv', ['0', '1', '2'], ['-1', '0', '1', '2'], null);
});

// Arrays whose ELEMENTS are themselves GStrv (nested container elements) are a
// nested-container case still deferred.
describeSkip('phase 2.2 arrays — length-annotated arrays of GStrv (nested container elements), a later PR',
    'Array of GStrv');

['GList', 'GSList'].forEach(listKind => {
    const list = listKind.toLowerCase();

    describe(listKind, function () {
        describe('of ints with transfer none', function () {
            testReturnValue(`${list}_int_none`, [-1, 0, 1, 2]);
            testInParameter(`${list}_int_none`, [-1, 0, 1, 2]);
        });

        if (listKind === 'GList') {
            describe('of unsigned 32-bit ints with transfer none', function () {
                testReturnValue('glist_uint32_none', [0, Limits.int32.umax]);
                testInParameter('glist_uint32_none', [0, Limits.int32.umax]);
            });
        }

        describe('of strings', function () {
            testContainerMarshalling(`${list}_utf8`, ['0', '1', '2'],
                ['-2', '-1', '0', '1'], []);
        });
    });
});

describe('GHashTable', function () {
    const numberDict = {
        '-1': -0.1,
        0: 0,
        1: 0.1,
        2: 0.2,
    };

    describe('with integer values', function () {
        const intDict = {
            '-1': 1,
            0: 0,
            1: -1,
            2: -2,
        };
        testReturnValue('ghashtable_int_none', intDict);
        testInParameter('ghashtable_int_none', intDict);
    });

    describe('with string values', function () {
        const stringDict = {
            '-1': '1',
            0: '0',
            1: '-1',
            2: '-2',
        };
        const stringDictOut = {
            '-1': '1',
            0: '0',
            1: '1',
        };
        testContainerMarshalling('ghashtable_utf8', stringDict, stringDictOut, null);
    });

    describe('with double values', function () {
        testInParameter('ghashtable_double', numberDict);
    });

    describe('with float values', function () {
        testInParameter('ghashtable_float', numberDict);
    });

    describe('with 64-bit int values', function () {
        const int64Dict = {
            '-1': -1,
            0: 0,
            1: 1,
            2: 0x100000000,
        };
        testInParameter('ghashtable_int64', int64Dict);
    });

    describe('with unsigned 64-bit int values', function () {
        const uint64Dict = {
            '-1': 0x100000000,
            0: 0,
            1: 1,
            2: 2,
        };
        testInParameter('ghashtable_uint64', uint64Dict);
    });

    it('symbol keys are ignored', function () {
        const symbolDict = {
            [Symbol('foo')]: 2,
            '-1': 1,
            0: 0,
            1: -1,
            2: -2,
        };
        expect(() => GIMarshallingTests.ghashtable_int_none_in(symbolDict)).not.toThrow();
    });
});
// GValue RETURN/OUT auto-unboxing is now LIVE — a GI function returning (or OUT-ing)
// a GValue is unboxed to its contained JS value (int/string/boolean/double/enum/
// object/null), matching GJS (marshal.cc GIArgumentToJs → GValueToJs). The upstream
// GValue block's return/OUT specs are un-skipped here; the IN direction (autoboxing a
// JS value into a GValue arg) and explicit GObject.Value construction stay deferred.
describe('GValue', function () {
    // return + OUT + uninitialized-OUT are live; IN + INOUT stay deferred.
    testSimpleMarshalling('gvalue', 42, '42', null, {
        in: {skip: SKIP_GVALUE_IN},
        inout: {skip: 'https://gitlab.gnome.org/GNOME/gobject-introspection/issues/192'},
    });

    it('can handle noncanonical float NaN', function () {
        expect(GIMarshallingTests.gvalue_noncanonical_nan_float()).toBeNaN();
    });

    it('can handle noncanonical double NaN', function () {
        expect(GIMarshallingTests.gvalue_noncanonical_nan_double()).toBeNaN();
    });

    itSkip(SKIP_GVALUE_IN, 'marshals as an int64 in parameter', function () {
        expect(() => GIMarshallingTests.gvalue_int64_in(BigIntLimits.int64.max))
            .not.toThrow();
    });

    itSkip(SKIP_GVALUE_IN, 'type objects can be converted from primitive-like types', function () {});
    itSkip(SKIP_GVALUE_IN, 'can be passed into a function and modified', function () {});
    // node-gi phase 3.2: a constructed boxed GObject.Value is passed IN and the C side
    // modifies it in place (get_int → 24) — verified vs gjs's identical body.
    it('can be passed into a function as a boxed type and modified', function () {
        const value = new GObject.Value();
        value.init(GObject.TYPE_INT);
        value.set_int(42);

        expect(() => GIMarshallingTests.gvalue_in_with_modification(value)).not.toThrow();
        expect(value.get_int()).toBe(24);
    });
    it('enum can be passed into a function as a boxed type and packed', function () {
        const value = new GObject.Value();
        // GIMarshallingTests.Enum is a native enum; pack it via the abstract G_TYPE_ENUM.
        value.init(GObject.TYPE_ENUM);
        value.set_enum(GIMarshallingTests.Enum.VALUE3);
        expect(() => GIMarshallingTests.gvalue_in_enum(value)).not.toThrow();
    });
    itSkip(SKIP_GVALUE_CTOR_GTYPE, 'flags can be passed into a function as a boxed type and packed', function () {});

    it('marshals as an int64 out parameter', function () {
        expect(warn64(true, GIMarshallingTests.gvalue_int64_out)).toEqual(
            Limits.int64.max);
    });

    it('marshals as a caller-allocated out parameter', function () {
        expect(GIMarshallingTests.gvalue_out_caller_allocates()).toEqual(42);
    });

    itSkip(SKIP_GVALUE_ARRAY, 'array can be passed into a function and packed', function () {});
    itSkip(SKIP_GVALUE_ARRAY, 'array of boxed type GValues can be passed into a function', function () {});
    itSkip(SKIP_GVALUE_ARRAY, 'array of uninitialized boxed GValues', function () {});
    itSkip(SKIP_GVALUE_ARRAY, 'array can be passed as an out argument and unpacked', function () {});
    itSkip(SKIP_GVALUE_ARRAY, 'array can be passed as an out argument and unpacked when zero-terminated',
        function () {});
    itSkip(SKIP_GVALUE_IN, 'can have its type inferred from primitive values', function () {});
    itSkip(SKIP_GVALUE_CTOR_GTYPE, 'can deal with a GValue packed in a GValue', function () {});
    itSkip(SKIP_GVALUE_FLOAT, 'separates float from double correctly', function () {});
});
// The IN-with-type inference breadth + flat-GValue-array round-trips stay a later PR.
describeSkip('phase 2.5 GValue IN — gvalue_in_with_type type inference + flat-array round-trips',
    'GValue (deferred IN breadth)');
describeSkip('phase 2.7 callbacks — GClosure in/return + callbacks with out-params + owned boxed',
    'Callback');
describeSkip('phase 2.4 structs — raw gpointer return round-trip',
    'Raw pointers');

describe('Registered enum type', function () {
    testSimpleMarshalling('genum', GIMarshallingTests.GEnum.VALUE3,
        GIMarshallingTests.GEnum.VALUE1, 0, {
            returnv: {
                funcName: 'genum_returnv',
            },
        });
});

describe('Bare enum type', function () {
    testSimpleMarshalling('enum', GIMarshallingTests.Enum.VALUE3,
        GIMarshallingTests.Enum.VALUE1, 0, {
            returnv: {
                funcName: 'enum_returnv',
            },
        });
});

describe('Registered flags type', function () {
    testSimpleMarshalling('flags', GIMarshallingTests.Flags.VALUE2,
        GIMarshallingTests.Flags.VALUE1, 0, {
            returnv: {
                funcName: 'flags_returnv',
            },
        });

    it('accepts zero', function () {
        expect(() => GIMarshallingTests.flags_in_zero(0)).not.toThrow();
    });
});

describe('Bare flags type', function () {
    testSimpleMarshalling('no_type_flags', GIMarshallingTests.NoTypeFlags.VALUE2,
        GIMarshallingTests.NoTypeFlags.VALUE1, 0, {
            returnv: {
                funcName: 'no_type_flags_returnv',
            },
        });

    it('accepts zero', function () {
        expect(() => GIMarshallingTests.no_type_flags_in_zero(0)).not.toThrow();
    });
});

// Struct/boxed/union FIELD access is now live (phase 2.6): a returned struct/union
// handle reads its fields (`.long_`/`.int8`/`.string_`/`.g_strv`) and a union field
// is settable. The sub-specs that BUILD a struct (`new Ns.Struct({…})`) stay skipped
// (struct construction is a later PR).
describe('Simple struct', function () {
    it('marshals as a return value', function () {
        expect(GIMarshallingTests.simple_struct_returnv()).toEqual(jasmine.objectContaining({
            long_: 6,
            int8: 7,
        }));
    });

    itSkip(SKIP_STRUCT_CONSTRUCT, 'marshals as the this-argument of a method', function () {
        const struct = new GIMarshallingTests.SimpleStruct({long_: 6, int8: 7});
        expect(() => struct.inv()).not.toThrow();
        expect(() => struct.method()).not.toThrow();
    });
});

describe('Pointer struct', function () {
    it('marshals as a return value', function () {
        expect(GIMarshallingTests.pointer_struct_returnv()).toEqual(jasmine.objectContaining({
            long_: 42,
        }));
    });

    itSkip(SKIP_STRUCT_CONSTRUCT, 'marshals as the this-argument of a method', function () {
        const struct = new GIMarshallingTests.PointerStruct({long_: 42});
        expect(() => struct.inv()).not.toThrow();
    });
});

describe('Boxed struct', function () {
    it('marshals as a return value', function () {
        expect(GIMarshallingTests.boxed_struct_returnv()).toEqual(jasmine.objectContaining({
            long_: 42,
            string_: 'hello',
            g_strv: ['0', '1', '2'],
        }));
    });

    itSkip(SKIP_STRUCT_CONSTRUCT, 'marshals as the this-argument of a method', function () {
        const struct = new GIMarshallingTests.BoxedStruct({long_: 42});
        expect(() => struct.inv()).not.toThrow();
    });

    it('marshals as an out parameter', function () {
        expect(GIMarshallingTests.boxed_struct_out()).toEqual(jasmine.objectContaining({
            long_: 42,
        }));
    });

    testUninitializedOutParameter('boxed_struct', null);

    itSkip(SKIP_STRUCT_CONSTRUCT, 'marshals as an inout parameter', function () {
        const struct = new GIMarshallingTests.BoxedStruct({long_: 42});
        expect(GIMarshallingTests.boxed_struct_inout(struct)).toEqual(jasmine.objectContaining({
            long_: 0,
        }));
    });
});

describe('Union', function () {
    let union;
    beforeEach(function () {
        union = GIMarshallingTests.union_returnv();
    });

    itSkip(SKIP_STRUCT_CONSTRUCT, 'can be constructed empty', function () {
        const constructedUnion = new GIMarshallingTests.Union();
        expect(constructedUnion.long_).toBe(0);
    });

    itSkip(SKIP_STRUCT_CONSTRUCT, 'can be constructed with properties', function () {
        const constructedUnion = new GIMarshallingTests.Union({long_: 55});
        expect(constructedUnion.long_).toBe(55);
    });

    itSkip(SKIP_STRUCT_CONSTRUCT, 'cannot be constructed with unknown properties', function () {
        expect(() => new GIMarshallingTests.Union({invalidProperty: 55})).toThrow();
    });

    it('marshals as a return value', function () {
        expect(union.long_).toBe(42);
    });

    it('marshals as a settable property', function () {
        union.long_ = 5555;
        expect(union.long_).toBe(5555);
    });

    it('marshals as the this-argument of a method', function () {
        expect(() => union.inv()).not.toThrow();
        expect(() => union.method()).not.toThrow();
    });

    itSkip(SKIP_STRUCT_CONSTRUCT, 'marshals as the this-argument of a method when constructed', function () {
        expect(() => new GIMarshallingTests.Union({long_: 42}).inv()).not.toThrow();
        expect(() => new GIMarshallingTests.Union({long_: 42}).method()).not.toThrow();
    });

    itSkip(SKIP_STRUCT_CONSTRUCT, 'marshals unregistered union', function () {
        const u = new GIMarshallingTests.UnregisteredUnion();
        expect(u.long_).toBe(0);
    });

    itSkip(SKIP_STRUCT_CONSTRUCT, 'marshals unregistered initialized union', function () {
        expect(new GIMarshallingTests.UnregisteredUnion({long_: 123}).long_).toBe(123);
    });
});

// Structured union builds nested members via `new Ns.StructuredUnion*()` + writes a
// nested struct field (`member.parent = …`); the field access is live but the struct
// allocation is not.
describeSkip(SKIP_STRUCT_CONSTRUCT, 'Structured union');

describe('GObject', function () {
    it('has a static method that can be called', function () {
        expect(() => GIMarshallingTests.Object.static_method()).not.toThrow();
    });

    it('has a method that can be called', function () {
        const o = new GIMarshallingTests.Object({int: 42});
        expect(() => o.method()).not.toThrow();
    });

    it('has an overridden method that can be called', function () {
        const o = new GIMarshallingTests.Object({int: 0});
        expect(() => o.overridden_method()).not.toThrow();
    });

    it('can be created from a static constructor', function () {
        const o = GIMarshallingTests.Object.new(42);
        expect(o.int).toEqual(42);
    });

    it('can have a static constructor that fails', function () {
        expect(() => GIMarshallingTests.Object.new_fail(42)).toThrow();
    });

    describe('method', function () {
        let o;
        beforeEach(function () {
            o = new GIMarshallingTests.Object();
        });

        it('marshals an int array as an in parameter', function () {
            expect(() => o.method_array_in([-1, 0, 1, 2])).not.toThrow();
        });

        it('marshals an int array as an out parameter', function () {
            expect(o.method_array_out()).toEqual([-1, 0, 1, 2]);
        });

        it('marshals an int array as an inout parameter', function () {
            expect(o.method_array_inout([-1, 0, 1, 2])).toEqual([-2, -1, 0, 1, 2]);
        });

        it('marshals an int array as a return value', function () {
            expect(o.method_array_return()).toEqual([-1, 0, 1, 2]);
        });

        it('with default implementation can be called', function () {
            o = new GIMarshallingTests.Object({int: 42});
            o.method_with_default_implementation(43);
            expect(o.int).toEqual(43);
        });
    });

    ['none', 'full'].forEach(transfer => {
        ['return', 'out'].forEach(mode => {
            it(`marshals as a ${mode} parameter with transfer ${transfer}`, function () {
                expect(GIMarshallingTests.Object[`${transfer}_${mode}`]().int).toEqual(0);
            });
        });

        it(`picks a reasonable default when uninitialized as out parameter with transfer ${transfer}`, function () {
            expect(GIMarshallingTests.Object[`${transfer}_out_uninitialized`]()).toEqual([false, null]);
        });

        it(`marshals as an inout parameter with transfer ${transfer}`, function () {
            const o = new GIMarshallingTests.Object({int: 42});
            expect(GIMarshallingTests.Object[`${transfer}_inout`](o).int).toEqual(0);
        });
    });

    it('marshals as a this value with transfer none', function () {
        const o = new GIMarshallingTests.Object({int: 42});
        expect(() => o.none_in()).not.toThrow();
    });
});

// The module-level `VFuncTester = GObject.registerClass(class VFuncTester
// extends GIMarshallingTests.Object { vfunc_* … })` registration ports together
// with the vfunc sections below (phase 2.8).
describeSkip('phase 2.8 vfuncs — VFuncTester registerClass subclass: vfunc in/out/inout/error/enum/flags/object marshalling',
    'Virtual function');
describeSkip('phase 2.8 vfuncs — invalid vfunc override shapes must error cleanly',
    'Wrong virtual functions');
describeSkip('phase 2.8 vfuncs — static vfuncs on Object/interfaces',
    'Static virtual functions');
describeSkip('phase 2.9 gobject-breadth — SubObject inheritance (overridden + parent methods)',
    'Inherited GObject');
describeSkip('phase 2.9 gobject-breadth — GInterface impls, interface methods + vfuncs',
    'Interface');
describeSkip('phase 2.11 misc-breadth — multi-out int configurations + nullable utf8/array in-args',
    'Configurations of return values');
describeSkip('phase 2.10 gerror — GError** as exception / out-param / return value',
    'GError');
describeSkip('phase 2.11 misc-breadth — filename GSList return (filename_list)',
    'Filename');
// GParamSpec wrapping (phase 2.7a): a returned/out GParamSpec is a real
// GObject.ParamSpec with .name/.nick/.blurb/.default_value/.flags/.value_type. The
// IN direction stays skipped — `GObject.ParamSpec.boolean(…)` is a registerClass
// DESCRIPTOR here, not a live GParamSpec to marshal in (a later PR).
describe('GObject.ParamSpec', function () {
    const SKIP_PSPEC_IN =
        'GParamSpec as an IN arg — GObject.ParamSpec.boolean(…) is a registerClass property descriptor here, ' +
        'not a live GParamSpec instance to marshal in (needs a real-pspec factory, a later PR)';
    const pspec = GObject.ParamSpec.boolean('mybool', 'My Bool', 'My boolean property',
        GObject.ParamFlags.READWRITE, true);
    testInParameter('param_spec', pspec, {
        funcName: 'param_spec_in_bool',
        skip: SKIP_PSPEC_IN,
    });

    const expectedProps = {
        name: 'test-param',
        nick: 'test',
        blurb: 'This is a test',
        default_value: '42',
        flags: GObject.ParamFlags.READABLE,
        value_type: GObject.TYPE_STRING,
    };
    testReturnValue('param_spec', jasmine.objectContaining(expectedProps));
    testOutParameter('param_spec', jasmine.objectContaining(expectedProps));
    testUninitializedOutParameter('param_spec', null);
});
describeSkip('phase 2.9 gobject-breadth — property get/set across all GI types',
    'GObject properties');
describeSkip('phase 2.9 gobject-breadth — camelCase/underscore/dashed property accessors',
    'GObject properties accessors');
describeSkip('phase 2.9 gobject-breadth — signal argument marshalling (boxed/arrays/…)',
    'GObject signals');
describeSkip('phase 2.10 gerror — GError through GValue + nullable GError args (pygobject extras)',
    'GError extra tests');
describeSkip('phase 2.3 hash-list — GHashTable of enums (pygobject extras)',
    'GHashTable extra tests');
describeSkip('phase 2.11 misc-breadth — filename encoding round-trips (pygobject extras)',
    'Filename tests');
describeSkip('phase 2.2 arrays — C array of enum return (pygobject extras)',
    'Array of enum extra tests');
describeSkip('phase 2.11 misc-breadth — 32-high-bit flags in-arg (pygobject extras)',
    'Flags extra tests');
describeSkip('phase 2.11 misc-breadth — invalid UTF-8 return/out must throw TypeError (pygobject extras)',
    'UTF-8 strings invalid bytes tests');
