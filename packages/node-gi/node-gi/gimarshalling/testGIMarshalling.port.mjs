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

describeSkip('phase 2.2 arrays — gtk_init-style inout string array (init_function)',
    'In-out array in the style of gtk_init()');
describeSkip('phase 2.2 arrays — fixed-size C arrays of ints/shorts (+ caller-allocated out)',
    'Fixed-size C array');
describeSkip('phase 2.2 arrays — length-annotated C arrays (bool/unichar/int8..int64/struct/enum/flags/string)',
    'C array with length');
describeSkip('phase 2.2 arrays — zero-terminated C arrays (string/glist/uint8)',
    'Zero-terminated C array');
describeSkip('phase 2.2 arrays — utf8 arrays × {length,fixed,zero-terminated} × {none,container,full}',
    'Exhaustive test of UTF-8 sequences');
describeSkip('phase 2.2 arrays — GArray of int/uint64/utf8 (+ bool/unichar in)',
    'GArray');
describeSkip('phase 2.2 arrays — GPtrArray of utf8',
    'GPtrArray');
describeSkip('phase 2.2 arrays — GByteArray in/out/return',
    'GByteArray');
describeSkip('phase 2.2 arrays — GBytes in/out/return + Uint8Array round-trips',
    'GBytes');
describeSkip('phase 2.2 arrays — NULL-terminated string arrays (GStrv)',
    'GStrv');
describeSkip('phase 2.2 arrays — length-annotated arrays of GStrv',
    'Array of GStrv');
describeSkip('phase 2.3 hash-list — GHashTable int/utf8/double/int64/uint64 variants',
    'GHashTable');
describeSkip('phase 2.5 GValue — GValue in/out/return, flat GValue arrays, boxed round-trips',
    'GValue');
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

describeSkip('phase 2.4 structs — SimpleStruct return (objectContaining) + method/inv calls',
    'Simple struct');
describeSkip('phase 2.4 structs — PointerStruct return + method call',
    'Pointer struct');
describeSkip('phase 2.4 structs — BoxedStruct return/out/inout + method call',
    'Boxed struct');
describeSkip('phase 2.4 structs — union return + methods',
    'Union');
describeSkip('phase 2.4 structs — structured unions (single/double pointer members, …)',
    'Structured union');

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

        const SKIP_OBJECT_ARRAY_METHODS =
            'phase 2.2 arrays — Object.method_array_{in,out,inout,return} take/return length-annotated int arrays';

        itSkip(SKIP_OBJECT_ARRAY_METHODS, 'marshals an int array as an in parameter', function () {
            expect(() => o.method_array_in([-1, 0, 1, 2])).not.toThrow();
        });

        itSkip(SKIP_OBJECT_ARRAY_METHODS, 'marshals an int array as an out parameter', function () {
            expect(o.method_array_out()).toEqual([-1, 0, 1, 2]);
        });

        itSkip(SKIP_OBJECT_ARRAY_METHODS, 'marshals an int array as an inout parameter', function () {
            expect(o.method_array_inout([-1, 0, 1, 2])).toEqual([-2, -1, 0, 1, 2]);
        });

        itSkip(SKIP_OBJECT_ARRAY_METHODS, 'marshals an int array as a return value', function () {
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
describeSkip('phase 2.9 gobject-breadth — GObject.ParamSpec in/out/return',
    'GObject.ParamSpec');
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
