// `GLib.Variant` as observable behaviour — ADR 0118 § 2. The SAME vectors run on real
// `gi://GLib` (the ORACLE: a vector that fails there is a wrong vector), on the core and on each
// port's `GLib` door.
//
// GJS is not uniform at the edges (`'i'` wraps, `'u'` throws, `'ai'` of a number is empty), and
// the rows copy it rather than tidy it. `holds: 'subset'` marks a REFUSAL: GJS accepts the type
// string or method, so the oracle skips the row and the subset must throw naming it.

import type { ConstructHarness } from './constructs.js';

export interface VariantLike {
    get_type_string(): string;
    print(type_annotate: boolean): string;
    unpack(): unknown;
    deepUnpack(): unknown;
    deep_unpack(): unknown;
    recursiveUnpack(): unknown;
    equal(other: unknown): boolean;
}

export interface VariantClassLike {
    new (type: string, value: unknown): VariantLike;
    readonly prototype: VariantLike;
    /** The deprecated static spelling of the constructor; GJS keeps it. */
    'new'(type: string, value: unknown): VariantLike;
}

/** The part of `GLib` the vectors read. */
export interface GLibVariantLike {
    readonly Variant: VariantClassLike;
}

export interface GLibVariantSubject {
    readonly name: string;
    /** True for real GJS: refusal vectors are the subset's own and are not run there. */
    readonly isOracle: boolean;
    readonly GLib: GLibVariantLike;
}

export const GLIB_VARIANT_ROWS = [
    'construct-basic',
    'construct-array',
    'signature',
    'refused-type',
    'unpack',
    'equal',
    'print',
    'refused-method',
] as const;

export type GLibVariantRow = (typeof GLIB_VARIANT_ROWS)[number];

export interface GLibVariantVector {
    readonly row: GLibVariantRow;
    readonly rule: string;
    readonly holds: 'oracle' | 'subset';
    readonly observe: (subject: GLibVariantSubject) => unknown;
    readonly shows: unknown;
}

/** A value, or what was thrown: constructor kind and message. */
function outcome(fn: () => unknown): unknown {
    try {
        return fn();
    } catch (error) {
        const kind = error instanceof TypeError ? 'TypeError' : 'Error';
        return { throws: kind, message: error instanceof Error ? error.message : String(error) };
    }
}

/** JSON loses NaN, ±Infinity and -0; spell them so a row can tell them apart. */
function plain(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(plain);
    if (typeof value === 'number' && (!Number.isFinite(value) || Object.is(value, -0))) {
        return Object.is(value, -0) ? '-0' : String(value);
    }
    return value;
}

function deep(subject: GLibVariantSubject, type: string, values: readonly unknown[]): unknown[] {
    return values.map((value) => outcome(() => plain(new subject.GLib.Variant(type, value).deepUnpack())));
}

function seen(subject: GLibVariantSubject, type: string, value: unknown): unknown {
    return outcome(() => {
        const v = new subject.GLib.Variant(type, value);
        return [v.get_type_string(), v.print(true), v.print(false), plain(v.deepUnpack())];
    });
}

const RANGE_U = { throws: 'Error', message: 'Argument value: value is out of range for uint32' };
const notString = (type: string) => ({
    throws: 'Error',
    message: `Expected type string for argument 'string' but got type ${type}`,
});
const notStrv = (type: string) => ({
    throws: 'Error',
    message: `Expected type utf8 for Argument 'strv' but got type '${type}'`,
});
const badSignature = (message: string) => ({ throws: 'TypeError', message: `Invalid GVariant signature ${message}` });

// CORE-ONLY: GAP — no port exports `GLib.Variant` yet; ADR 0118 step 3 adds it. Tracked in #2289.
export const GLIB_VARIANT_VECTORS: readonly GLibVariantVector[] = [
    {
        row: 'construct-basic',
        rule: "'b' is the value's truthiness",
        holds: 'oracle',
        observe: (s) => deep(s, 'b', [true, false, 0, 1, 'x', '', null, undefined, {}, []]),
        shows: [true, false, false, true, true, false, false, false, true, true],
    },
    {
        row: 'construct-basic',
        rule: "'i' converts like ToInt32: truncates, wraps out of range, never throws",
        holds: 'oracle',
        observe: (s) =>
            deep(s, 'i', [
                1.5,
                -1.5,
                '7',
                'x',
                true,
                null,
                undefined,
                {},
                [],
                [5],
                '0x10',
                2147483648,
                -2147483649,
                1e10,
                NaN,
                Infinity,
                -Infinity,
            ]),
        shows: [1, -1, 7, 0, 1, 0, 0, 0, 0, 5, 16, -2147483648, 2147483647, 1410065408, 0, 0, 0],
    },
    {
        row: 'construct-basic',
        rule: "'u' truncates a value in range; a non-finite number and null/undefined are 0",
        holds: 'oracle',
        observe: (s) =>
            deep(s, 'u', [1.9, '3', '3.5', NaN, Infinity, -Infinity, null, undefined, '', true, [7], 4294967295]),
        shows: [1, 3, 3, 0, 0, 0, 0, 0, 0, 1, 7, 4294967295],
    },
    {
        row: 'construct-basic',
        rule: "'u' throws 'out of range for uint32' below 0, above 2^32-1 and for what does not convert",
        holds: 'oracle',
        observe: (s) => deep(s, 'u', [-1, -0.5, 4294967296, 4294967295.5, 'x', {}, ['x'], [1, 2]]),
        shows: [RANGE_U, RANGE_U, RANGE_U, RANGE_U, RANGE_U, RANGE_U, RANGE_U, RANGE_U],
    },
    {
        row: 'construct-basic',
        rule: "'d' converts like Number()",
        holds: 'oracle',
        observe: (s) => deep(s, 'd', [1.5, '1.5', 'x', undefined, null, true, -0, Infinity]),
        shows: [1.5, 1.5, 'NaN', 'NaN', 0, 1, '-0', 'Infinity'],
    },
    {
        row: 'construct-basic',
        rule: "'s' takes only a string, cut at the first NUL; anything else throws naming its type",
        holds: 'oracle',
        observe: (s) => deep(s, 's', ['', 'ä€😀', 'a\u0000b', 3, true, undefined, {}, [], null]),
        shows: [
            '',
            'ä€😀',
            'a',
            notString('number'),
            notString('boolean'),
            notString('undefined'),
            notString('Object'),
            notString('Array'),
            { throws: 'Error', message: 'Argument string may not be null' },
        ],
    },
    {
        row: 'construct-array',
        rule: "'ab' 'ai' 'au' 'ad' convert per element as their element type",
        holds: 'oracle',
        observe: (s) => [
            seen(s, 'ab', [1, 0, 'x']),
            seen(s, 'ai', [1.5, 'x', 2147483648]),
            seen(s, 'au', [1, '2']),
            seen(s, 'ad', [1, '2', NaN]),
            seen(s, 'au', [-1]),
        ],
        shows: [
            ['ab', '[true, false, true]', '[true, false, true]', [true, false, true]],
            ['ai', '[1, 0, -2147483648]', '[1, 0, -2147483648]', [1, 0, -2147483648]],
            ['au', '[uint32 1, 2]', '[1, 2]', [1, 2]],
            ['ad', '[1.0, 2.0, nan]', '[1.0, 2.0, nan]', [1, 2, 'NaN']],
            RANGE_U,
        ],
    },
    {
        row: 'construct-array',
        rule: 'a non-string array type reads `length` and indexes: a number is empty, a string or {length} is array-like, null throws',
        holds: 'oracle',
        observe: (s) => [
            seen(s, 'ai', 3),
            seen(s, 'ai', 'ab'),
            seen(s, 'ai', { length: 2 }),
            seen(s, 'ai', [undefined]),
            seen(s, 'ab', { length: 1 }),
            seen(s, 'ai', null),
            seen(s, 'ab', undefined),
        ],
        shows: [
            ['ai', '@ai []', '[]', []],
            ['ai', '[0, 0]', '[0, 0]', [0, 0]],
            ['ai', '[0, 0]', '[0, 0]', [0, 0]],
            ['ai', '[0]', '[0]', [0]],
            ['ab', '[false]', '[false]', [false]],
            { throws: 'TypeError', message: 'can\'t access property "length", value is null' },
            { throws: 'TypeError', message: 'can\'t access property "length", value is undefined' },
        ],
    },
    {
        row: 'construct-array',
        rule: "'as' takes an array of strings; a string, a non-array or a non-string element throws",
        holds: 'oracle',
        observe: (s) => [
            seen(s, 'as', ['a', "b'c"]),
            seen(s, 'as', []),
            seen(s, 'as', ['a', 3]),
            seen(s, 'as', { length: 1 }),
            seen(s, 'as', 'ab'),
            seen(s, 'as', null),
            seen(s, 'as', undefined),
            seen(s, 'as', 3),
            seen(s, 'as', {}),
        ],
        shows: [
            ['as', "['a', \"b'c\"]", "['a', \"b'c\"]", ['a', "b'c"]],
            ['as', '@as []', '[]', []],
            { throws: 'Error', message: 'Invalid element in string array' },
            { throws: 'Error', message: 'Invalid element in string array' },
            { throws: 'Error', message: "Cannot convert string to array of 'utf8'" },
            notStrv('null'),
            notStrv('undefined'),
            notStrv('number'),
            notStrv('Object'),
        ],
    },
    {
        row: 'signature',
        rule: 'an invalid signature throws a TypeError naming what is wrong',
        holds: 'oracle',
        observe: (s) =>
            ['', 'z', ')', 'a', 'az', 'ii', 'ai i', 'ab(', '(i'].map((sig) =>
                outcome(() => new s.GLib.Variant(sig, [1])),
            ),
        shows: [
            { throws: 'TypeError', message: 'GVariant signature cannot be empty' },
            badSignature('(unexpected character z)'),
            badSignature('(unexpected character ))'),
            badSignature('(undefined is not a valid type)'),
            badSignature('(z is not a valid type)'),
            badSignature('(more than one single complete type)'),
            badSignature('(more than one single complete type)'),
            badSignature('(more than one single complete type)'),
            badSignature('for type TUPLE (expected ")")'),
        ],
    },
    {
        row: 'refused-type',
        rule: 'a valid type string outside b i u d s and their arrays throws, naming the type string',
        holds: 'subset',
        observe: (s) =>
            ['y', 'n', 'q', 'x', 't', 'h', 'o', 'g', 'v', 'mi', 'aai', '(i)', 'a{sv}', '{si}'].map((sig) => {
                const thrown = outcome(() => new s.GLib.Variant(sig, 1)) as { message?: string };
                return (thrown.message ?? '').includes(`'${sig}'`);
            }),
        shows: [true, true, true, true, true, true, true, true, true, true, true, true, true, true],
    },
    {
        row: 'unpack',
        rule: 'unpack() of a basic type is its value; of an array, an array of GLib.Variant of the element type',
        holds: 'oracle',
        observe: (s) => {
            const items = new s.GLib.Variant('au', [1, 2]).unpack() as VariantLike[];
            return [
                new s.GLib.Variant('i', 3).unpack(),
                new s.GLib.Variant('s', 'a').unpack(),
                typeof new s.GLib.Variant('b', 1).unpack(),
                items.length,
                items.every((item) => item instanceof s.GLib.Variant),
                items.map((item) => item.print(true)),
            ];
        },
        shows: [3, 'a', 'boolean', 2, true, ['uint32 1', 'uint32 2']],
    },
    {
        row: 'unpack',
        rule: 'deepUnpack() and recursiveUnpack() return plain values; deep_unpack is the same function',
        holds: 'oracle',
        observe: (s) => [
            new s.GLib.Variant('ai', [1, 2]).deepUnpack(),
            new s.GLib.Variant('as', ['a']).recursiveUnpack(),
            new s.GLib.Variant('ab', [true]).deep_unpack(),
            s.GLib.Variant.prototype.deep_unpack === s.GLib.Variant.prototype.deepUnpack,
        ],
        shows: [[1, 2], ['a'], [true], true],
    },
    {
        row: 'unpack',
        rule: 'get_type_string, toString, instanceof and the deprecated Variant.new',
        holds: 'oracle',
        observe: (s) => {
            const v = s.GLib.Variant.new('ai', [1]) as VariantLike;
            return [v.get_type_string(), String(v), v instanceof s.GLib.Variant, v.print(true)];
        },
        shows: ['ai', '[object variant of type "ai"]', true, '[1]'],
    },
    {
        row: 'equal',
        rule: 'equal() needs the same type string and value; NaN equals NaN, 0 not -0; a non-Variant throws',
        holds: 'oracle',
        observe: (s) => {
            const V = (type: string, value: unknown) => new s.GLib.Variant(type, value);
            return [
                V('ai', [1]).equal(V('ai', [1])),
                V('ai', [1]).equal(V('au', [1])),
                V('ai', []).equal(V('au', [])),
                V('i', 1).equal(V('i', 2)),
                V('d', NaN).equal(V('d', NaN)),
                V('d', 0).equal(V('d', -0)),
                V('as', ['a']).equal(V('as', ['a'])),
                outcome(() => V('i', 1).equal(1)),
            ];
        },
        shows: [
            true,
            false,
            false,
            false,
            true,
            false,
            true,
            { throws: 'Error', message: "Expected an object of type GVariant for argument 'two' but got type number" },
        ],
    },
    {
        row: 'print',
        rule: "print() writes GLib's text format: 'u' annotated, the first array element annotated, an empty array as @type []",
        holds: 'oracle',
        observe: (s) => {
            const V = (type: string, value: unknown) => new s.GLib.Variant(type, value);
            return [
                [V('b', true).print(true), V('i', -5).print(true), V('u', 5).print(true), V('u', 5).print(false)],
                [V('au', [1, 2]).print(true), V('au', [1, 2]).print(false), V('ai', [1, 2]).print(true)],
                ['ab', 'ai', 'au', 'ad', 'as'].map((type) => [V(type, []).print(true), V(type, []).print(false)]),
            ];
        },
        shows: [
            ['true', '-5', 'uint32 5', '5'],
            ['[uint32 1, 2]', '[1, 2]', '[1, 2]'],
            [
                ['@ab []', '[]'],
                ['@ai []', '[]'],
                ['@au []', '[]'],
                ['@ad []', '[]'],
                ['@as []', '[]'],
            ],
        ],
    },
    {
        row: 'print',
        rule: "a double prints as %.17g, with '.0' added when it reads as an integer",
        holds: 'oracle',
        observe: (s) =>
            [
                1,
                1.5,
                -0,
                0,
                1e21,
                1e-7,
                123456789.123,
                0.1,
                NaN,
                Infinity,
                -Infinity,
                1 / 3,
                1e16,
                1e17,
                5e-5,
                1e-4,
                1e-5,
                2.5e-300,
            ].map((d) => new s.GLib.Variant('d', d).print(false)),
        shows: [
            '1.0',
            '1.5',
            '-0.0',
            '0.0',
            '1e+21',
            '9.9999999999999995e-08',
            '123456789.123',
            '0.10000000000000001',
            'nan',
            'inf',
            '-inf',
            '0.33333333333333331',
            '10000000000000000.0',
            '1e+17',
            '5.0000000000000002e-05',
            '0.0001',
            '1.0000000000000001e-05',
            '2.5e-300',
        ],
    },
    {
        row: 'print',
        rule: "a string is single-quoted unless it holds ' ; the quote and \\ are escaped, a non-printing character as \\a…\\v, \\uXXXX or \\UXXXXXXXX",
        holds: 'oracle',
        observe: (s) =>
            [
                "a'b",
                'a"b',
                'a\'"b',
                'a\\b',
                'tab\tnl\n',
                '\u0007\u0008\u000b\u000c\r',
                '\u0001\u007f\u001b',
                'ä€😀',
                '\u00a0\u2028',
                '\u00ad\u200b\u0085',
                '\u{10ffff}',
            ].map((text) => new s.GLib.Variant('s', text).print(false)),
        shows: [
            '"a\'b"',
            "'a\"b'",
            '"a\'\\"b"',
            "'a\\\\b'",
            "'tab\\tnl\\n'",
            "'\\a\\b\\v\\f\\r'",
            "'\\u0001\\u007f\\u001b'",
            "'ä€😀'",
            "'\u00a0\u2028'",
            "'\\u00ad\\u200b\\u0085'",
            "'\\U0010ffff'",
        ],
    },
    {
        row: 'refused-method',
        rule: 'the typed getters, child access, parse, new_* and the serialisation methods throw, naming themselves',
        holds: 'subset',
        observe: (s) => {
            const v = new s.GLib.Variant('ai', [1]) as unknown as Record<string, () => unknown>;
            const statics_ = s.GLib.Variant as unknown as Record<string, () => unknown>;
            const methods = [
                'get_boolean',
                'get_int32',
                'get_uint32',
                'get_double',
                'get_string',
                'get_strv',
                'n_children',
                'get_child_value',
                'get_data_as_bytes',
                'byteswap',
                'hash',
                'compare',
            ];
            const statics = ['parse', 'new_int32', 'new_string', 'new_strv', 'new_array'];
            const names = (fn: () => unknown, name: string) =>
                ((outcome(fn) as { message?: string }).message ?? '').includes(name);
            return [
                ...methods.map((name) => names(() => v[name](), name)),
                ...statics.map((name) => names(() => statics_[name](), name)),
            ];
        },
        shows: [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true],
    },
];

export async function driveGLibVariantVectors(
    subject: GLibVariantSubject,
    harness: ConstructHarness,
    vectors: readonly GLibVariantVector[] = GLIB_VARIANT_VECTORS,
): Promise<void> {
    const { describe, it, expect } = harness;
    await describe(`${subject.name}: GLib.Variant subset (ADR 0118)`, async () => {
        for (const vector of vectors) {
            if (vector.holds === 'subset' && subject.isOracle) continue;
            await it(`${vector.row}: ${vector.rule}`, () => {
                expect(JSON.stringify(vector.observe(subject))).toBe(JSON.stringify(vector.shows));
            });
        }
    });
}
