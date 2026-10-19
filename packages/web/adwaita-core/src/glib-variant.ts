// `GLib.Variant`, a subset — ADR 0118 § 2: the basic types `b i u d s` and arrays of them, which is
// what `Gio.Settings` stores. Construction copies GJS's override (`_packVariant`) and the coercions
// of GJS's argument marshalling, edge for edge: `'i'` wraps, `'u'` throws out of range, `'ai'` of a
// number is empty. A valid type string outside the subset, and every method not listed in § 2,
// throws naming itself.
//
// `print()` writes GLib's text format byte for byte for these types, and `parseVariant` reads it
// back; `@gjsify/app-settings` stores array keys as that text.
//
// Reference: glib glib/gvariant.c (g_variant_print_string), glib/gvariant-parser.c,
// gjs modules/core/overrides/GLib.js (_readSingleType, _packVariant, _unpackVariant)
// Copyright (c) GNOME contributors (GLib, GJS). LGPLv2.1+, MIT OR LGPLv2+.

import { UnsupportedGObjectError } from './gobject.js';

type BasicType = 'b' | 'i' | 'u' | 'd' | 's';
export type VariantTypeString = BasicType | 'ab' | 'ai' | 'au' | 'ad' | 'as';
export type VariantBasicValue = boolean | number | string;
export type VariantValue = VariantBasicValue | VariantBasicValue[];

const BASIC = new Set<string>(['b', 'i', 'u', 'd', 's']);
const SIMPLE = new Set<string>(['b', 'y', 'n', 'q', 'i', 'u', 'x', 't', 'h', 'd', 's', 'o', 'g']);
const UINT32_MAX = 4294967295;

function refuse(feature: string): UnsupportedGObjectError {
    return new UnsupportedGObjectError(feature, `${feature} is outside the GLib.Variant subset (ADR 0118 § 2).`);
}

function invalid(detail: string): TypeError {
    return new TypeError(`Invalid GVariant signature ${detail}`);
}

/**
 * The index after one complete type at `at`. `top` is `_packVariant`'s reading ("unexpected
 * character"), the rest `_readSingleType`'s ("is not a valid type"), so the messages match GJS's.
 */
function readType(sig: string, at: number, top: boolean, forceSimple = false): number {
    const char = sig[at];
    const simple = char !== undefined && SIMPLE.has(char);
    if (!top && forceSimple && !simple) throw invalid('(a simple type was expected)');
    if (simple || char === 'v') return at + 1;
    if (char === 'a') return readType(sig, at + 1, false);
    if (char === 'm') return readType(sig, at + 1, top);
    if (char === '{') {
        const key = readType(sig, at + 1, top, true);
        const end = readType(sig, key, top);
        if (sig[end] !== '}')
            throw invalid(top ? 'for type DICT_ENTRY (expected "}")' : 'for type DICT_ENTRY (expected "}"');
        return end + 1;
    }
    if (char === '(') {
        let next = at + 1;
        for (;;) {
            if (next >= sig.length) throw invalid('for type TUPLE (expected ")")');
            if (sig[next] === ')') return next + 1;
            next = readType(sig, next, top);
        }
    }
    throw invalid(top ? `(unexpected character ${char})` : `(${char} is not a valid type)`);
}

function typeOf(sig: unknown): VariantTypeString {
    const text = typeof sig === 'string' ? sig : '';
    if (text === '') throw new TypeError('GVariant signature cannot be empty');
    if (readType(text, 0, true) !== text.length) throw invalid('(more than one single complete type)');
    if (BASIC.has(text) || (text.length === 2 && text[0] === 'a' && BASIC.has(text[1]))) {
        return text as VariantTypeString;
    }
    throw refuse(`new GLib.Variant('${text}')`);
}

function typeName(value: unknown): string {
    if (value === null) return 'null';
    if (typeof value !== 'object') return typeof value;
    return (value as { constructor?: { name?: string } }).constructor?.name || 'Object';
}

function cutAtNul(text: string): string {
    const nul = text.indexOf('\u0000');
    return nul === -1 ? text : text.slice(0, nul);
}

function toUint32(value: unknown): number {
    if (value === null || value === undefined) return 0;
    if (typeof value === 'number' && !Number.isFinite(value)) return 0;
    const n = Number(value);
    if (Number.isNaN(n) || n < 0 || n > UINT32_MAX) {
        throw new Error('Argument value: value is out of range for uint32');
    }
    return Math.trunc(n) || 0;
}

function toBasic(type: BasicType, value: unknown): VariantBasicValue {
    switch (type) {
        case 'b':
            return Boolean(value);
        case 'i':
            return Number(value) | 0;
        case 'u':
            return toUint32(value);
        case 'd':
            return Number(value);
        case 's':
            if (typeof value === 'string') return cutAtNul(value);
            if (value === null) throw new Error('Argument string may not be null');
            throw new Error(`Expected type string for argument 'string' but got type ${typeName(value)}`);
    }
}

type ArrayLikeValue = { readonly length?: unknown; readonly [index: number]: unknown };

function toArray(type: BasicType, value: unknown): VariantBasicValue[] {
    if (type === 's') {
        if (typeof value === 'string') throw new Error("Cannot convert string to array of 'utf8'");
        if (typeof value !== 'object' || value === null || !('length' in value)) {
            throw new Error(`Expected type utf8 for Argument 'strv' but got type '${typeName(value)}'`);
        }
    } else if (value === null || value === undefined) {
        throw new TypeError(`can't access property "length", value is ${value}`);
    }
    const items = value as ArrayLikeValue;
    const length = Number(items.length);
    const out: VariantBasicValue[] = [];
    for (let i = 0; i < length; i++) {
        const item = items[i];
        if (type === 's' && typeof item !== 'string') throw new Error('Invalid element in string array');
        out.push(toBasic(type, item));
    }
    return out;
}

// --- print ---

const NAMED_ESCAPES: Readonly<Record<string, string>> = {
    '\u0007': '\\a',
    '\b': '\\b',
    '\t': '\\t',
    '\n': '\\n',
    '\v': '\\v',
    '\f': '\\f',
    '\r': '\\r',
};

/** `!g_unichar_isprint`: control, format, unassigned and surrogate code points. */
const NON_PRINTING = /[\p{Cc}\p{Cf}\p{Cn}\p{Cs}]/u;

function hex(codePoint: number, width: number): string {
    return codePoint.toString(16).padStart(width, '0');
}

function printString(text: string): string {
    const quote = text.includes("'") ? '"' : "'";
    let out = quote;
    for (const char of text) {
        if (char === quote || char === '\\') out += `\\${char}`;
        else if (char in NAMED_ESCAPES) out += NAMED_ESCAPES[char];
        else if (NON_PRINTING.test(char)) {
            const codePoint = char.codePointAt(0) as number;
            out += codePoint < 0x10000 ? `\\u${hex(codePoint, 4)}` : `\\U${hex(codePoint, 8)}`;
        } else out += char;
    }
    return out + quote;
}

function stripZeros(text: string): string {
    return text.includes('.') ? text.replace(/\.?0+$/, '') : text;
}

/** C's `%.17g`, plus GLib's `.0` when the result reads as an integer. */
function printDouble(value: number): string {
    if (Number.isNaN(value)) return 'nan';
    if (!Number.isFinite(value)) return value > 0 ? 'inf' : '-inf';
    const sign = value < 0 || Object.is(value, -0) ? '-' : '';
    const magnitude = Math.abs(value);
    const [mantissa, exponentText] = magnitude.toExponential(16).split('e');
    const exponent = Number(exponentText);
    const digits =
        exponent < -4 || exponent >= 17
            ? `${stripZeros(mantissa)}e${exponent < 0 ? '-' : '+'}${String(Math.abs(exponent)).padStart(2, '0')}`
            : stripZeros(magnitude.toFixed(16 - exponent));
    const text = sign + digits;
    return /^-?\d+$/.test(text) ? `${text}.0` : text;
}

function printBasic(type: BasicType, value: VariantBasicValue, annotate: boolean): string {
    switch (type) {
        case 'b':
            return value ? 'true' : 'false';
        case 'i':
            return String(value);
        case 'u':
            return annotate ? `uint32 ${value}` : String(value);
        case 'd':
            return printDouble(value as number);
        case 's':
            return printString(value as string);
    }
}

// --- the value ---

export class Variant {
    readonly #type: VariantTypeString;
    readonly #value: VariantValue;

    constructor(sig: string, value: unknown) {
        const type = typeOf(sig);
        this.#type = type;
        this.#value = type.length === 1 ? toBasic(type as BasicType, value) : toArray(type[1] as BasicType, value);
    }

    /** Deprecated on GJS, still there. */
    static new(sig: string, value: unknown): Variant {
        return new Variant(sig, value);
    }

    get_type_string(): string {
        return this.#type;
    }

    unpack<T = unknown>(): T {
        const value = this.#value;
        if (!Array.isArray(value)) return value as T;
        const element = this.#type[1];
        return value.map((item) => new Variant(element, item)) as T;
    }

    deepUnpack<T = unknown>(): T {
        const value = this.#value;
        return (Array.isArray(value) ? value.slice() : value) as T;
    }

    /** The backwards-compatibility alias: the same function as `deepUnpack`. */
    declare deep_unpack: <T = unknown>() => T;

    /** No `v` in the subset, so there is nothing to recurse into beyond `deepUnpack`. */
    recursiveUnpack<T = unknown>(): T {
        return this.deepUnpack<T>();
    }

    equal(other: unknown): boolean {
        if (!(other instanceof Variant)) {
            throw new Error(`Expected an object of type GVariant for argument 'two' but got type ${typeName(other)}`);
        }
        if (other.#type !== this.#type) return false;
        const mine = this.#value;
        const theirs = other.#value;
        if (!Array.isArray(mine) || !Array.isArray(theirs)) return Object.is(mine, theirs);
        return mine.length === theirs.length && mine.every((item, i) => Object.is(item, theirs[i]));
    }

    print(type_annotate: boolean): string {
        const annotate = Boolean(type_annotate);
        const value = this.#value;
        if (!Array.isArray(value)) return printBasic(this.#type as BasicType, value, annotate);
        if (value.length === 0) return annotate ? `@${this.#type} []` : '[]';
        const element = this.#type[1] as BasicType;
        return `[${value.map((item, i) => printBasic(element, item, annotate && i === 0)).join(', ')}]`;
    }

    toString(): string {
        return `[object variant of type "${this.#type}"]`;
    }
}

Object.defineProperty(Variant.prototype, 'deep_unpack', {
    value: Variant.prototype.deepUnpack,
    writable: true,
    configurable: true,
    enumerable: false,
});

const REFUSED_METHODS = [
    'get_boolean',
    'get_byte',
    'get_int16',
    'get_uint16',
    'get_int32',
    'get_uint32',
    'get_int64',
    'get_uint64',
    'get_handle',
    'get_double',
    'get_string',
    'dup_string',
    'get_strv',
    'dup_strv',
    'get_objv',
    'get_bytestring',
    'get_variant',
    'get_maybe',
    'get_type',
    'is_of_type',
    'is_container',
    'classify',
    'n_children',
    'get_child_value',
    'lookup_value',
    'get_size',
    'get_data',
    'get_data_as_bytes',
    'store',
    'get_normal_form',
    'is_normal_form',
    'byteswap',
    'hash',
    'compare',
    'check_format_string',
    'is_floating',
    'ref',
    'ref_sink',
    'take_ref',
    'unref',
];

const REFUSED_STATICS = [
    'parse',
    'new_boolean',
    'new_byte',
    'new_int16',
    'new_uint16',
    'new_int32',
    'new_uint32',
    'new_int64',
    'new_uint64',
    'new_handle',
    'new_double',
    'new_string',
    'new_take_string',
    'new_object_path',
    'new_signature',
    'new_variant',
    'new_strv',
    'new_objv',
    'new_bytestring',
    'new_bytestring_array',
    'new_maybe',
    'new_array',
    'new_tuple',
    'new_dict_entry',
    'new_fixed_array',
    'new_from_bytes',
    'new_from_data',
    'is_object_path',
    'is_signature',
    'parse_error_quark',
    'parse_error_print_context',
];

for (const name of REFUSED_METHODS) {
    Object.defineProperty(Variant.prototype, name, {
        value: () => {
            throw refuse(`GLib.Variant.prototype.${name}()`);
        },
        writable: true,
        configurable: true,
        enumerable: false,
    });
}

for (const name of REFUSED_STATICS) {
    Object.defineProperty(Variant, name, {
        value: () => {
            throw refuse(`GLib.Variant.${name}()`);
        },
        writable: true,
        configurable: true,
        enumerable: false,
    });
}

// --- parse ---

const KEYWORDS: Readonly<Record<string, BasicType>> = {
    boolean: 'b',
    int32: 'i',
    uint32: 'u',
    double: 'd',
    string: 's',
};

const INTEGER = /^([+-]?)(?:0[xX]([0-9a-fA-F]+)|(0[0-7]*)|([1-9][0-9]*))$/;
const FLOAT = /^[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/;
const SPECIAL = /^([+-]?)(inf|nan)$/;
const IDENTIFIER = /[A-Za-z_][A-Za-z0-9_]*/y;
const NUMBER_TOKEN = /[0-9A-Za-z_.+-]+/y;

class TextReader {
    at = 0;

    constructor(
        readonly text: string,
        readonly type: VariantTypeString,
    ) {}

    fail(detail: string): Error {
        return new Error(`GLib.Variant: '${this.text}' is not a valid '${this.type}' value: ${detail}`);
    }

    skipSpace(): void {
        while (/\s/.test(this.text[this.at] ?? '')) this.at++;
    }

    peek(): string | undefined {
        this.skipSpace();
        return this.text[this.at];
    }

    match(pattern: RegExp): string | null {
        pattern.lastIndex = this.at;
        const hit = pattern.exec(this.text);
        if (!hit) return null;
        this.at += hit[0].length;
        return hit[0];
    }
}

function readInteger(reader: TextReader, token: string, type: 'i' | 'u'): number {
    const hit = INTEGER.exec(token);
    if (!hit) throw reader.fail(`'${token}' is not an integer`);
    const [, sign, hexDigits, octal, decimal] = hit;
    const magnitude =
        hexDigits !== undefined ? parseInt(hexDigits, 16) : octal !== undefined ? parseInt(octal, 8) : Number(decimal);
    const value = sign === '-' ? -magnitude : magnitude;
    const [min, max] = type === 'i' ? [-2147483648, 2147483647] : [0, UINT32_MAX];
    if (value < min || value > max) throw reader.fail(`${token} is out of range for '${type}'`);
    return value || 0;
}

function readNumber(reader: TextReader, type: 'i' | 'u' | 'd'): number {
    const token = reader.match(NUMBER_TOKEN);
    if (token === null) throw reader.fail(`expected a number at ${reader.at}`);
    if (type !== 'd') return readInteger(reader, token, type);
    // A double goes through `g_ascii_strtod`: hex is read as hex, a leading 0 is not octal.
    const hexToken = /^([+-]?)0[xX]([0-9a-fA-F]+)$/.exec(token);
    if (hexToken) return (hexToken[1] === '-' ? -1 : 1) * parseInt(hexToken[2], 16);
    const special = SPECIAL.exec(token);
    if (special) return special[2] === 'nan' ? NaN : special[1] === '-' ? -Infinity : Infinity;
    if (!FLOAT.test(token)) throw reader.fail(`'${token}' is not a number`);
    return Number(token);
}

function readString(reader: TextReader): string {
    const { text } = reader;
    const quote = text[reader.at];
    if (quote !== "'" && quote !== '"') throw reader.fail(`expected a string at ${reader.at}`);
    reader.at++;
    let out = '';
    for (;;) {
        const char = text[reader.at];
        if (char === undefined) throw reader.fail('unterminated string');
        reader.at++;
        if (char === quote) return out;
        if (char !== '\\') {
            out += char;
            continue;
        }
        const escape = text[reader.at++];
        if (escape === undefined) throw reader.fail('unterminated string');
        if (escape === 'u' || escape === 'U') {
            const width = escape === 'u' ? 4 : 8;
            const digits = text.slice(reader.at, reader.at + width);
            const codePoint = parseInt(digits, 16);
            if (!/^[0-9a-fA-F]+$/.test(digits) || digits.length !== width || codePoint > 0x10ffff) {
                throw reader.fail(`invalid \\${escape} escape`);
            }
            reader.at += width;
            out += String.fromCodePoint(codePoint);
        } else {
            const named = Object.keys(NAMED_ESCAPES).find((key) => NAMED_ESCAPES[key] === `\\${escape}`);
            out += named ?? escape;
        }
    }
}

function readBasic(reader: TextReader, type: BasicType): VariantBasicValue {
    reader.skipSpace();
    const start = reader.at;
    const word = reader.match(IDENTIFIER);
    if (word !== null && word in KEYWORDS) {
        if (KEYWORDS[word] !== type) throw reader.fail(`'${word}' is not a '${type}'`);
        reader.skipSpace();
    } else {
        reader.at = start;
    }
    if (type === 's') return readString(reader);
    if (type === 'b') {
        const literal = reader.match(IDENTIFIER);
        if (literal === 'true' || literal === 'false') return literal === 'true';
        throw reader.fail(`expected true or false at ${start}`);
    }
    return readNumber(reader, type);
}

/** GLib's text format (`g_variant_parse`) for the subset's types: the inverse of `print`. */
export function parseVariant(sig: string, text: string): Variant {
    const type = typeOf(sig);
    const reader = new TextReader(text, type);
    let value: VariantValue;
    if (type.length === 1) {
        value = readBasic(reader, type as BasicType);
    } else {
        if (reader.peek() === '@') {
            reader.at++;
            const annotation = reader.match(/[^\s[]+/y);
            if (annotation !== type) throw reader.fail(`the annotation '@${annotation}' is not '@${type}'`);
        }
        if (reader.peek() !== '[') throw reader.fail(`expected '[' at ${reader.at}`);
        reader.at++;
        const items: VariantBasicValue[] = [];
        if (reader.peek() === ']') reader.at++;
        else {
            for (;;) {
                items.push(readBasic(reader, type[1] as BasicType));
                const next = reader.peek();
                reader.at++;
                if (next === ']') break;
                if (next !== ',') throw reader.fail(`expected ',' or ']' at ${reader.at - 1}`);
            }
        }
        value = items;
    }
    if (reader.peek() !== undefined) throw reader.fail(`unexpected '${reader.text.slice(reader.at)}'`);
    return new Variant(type, value);
}
