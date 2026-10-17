// An authored value as GtkBuilder hands it to a property the APPLICATION declared: through
// `gtk_builder_value_from_string`, by the ParamSpec's type. A `.blp` that says `copyable: true;`
// on a class registered with `GObject.ParamSpec.boolean('copyable', …)` reaches its setter as
// `true`, never as the string the attribute door carries.
//
// Pure, and no `@nativescript/core` import: the builder imports it, and so may a pure spec.

import { registeredClassOf, type ParamSpec } from '@gjsify/adwaita-core';
import { propertyOf } from '@gjsify/adwaita-core/tags';

/**
 * The ParamSpec a class registered through the GObject subset declares for the camel-case
 * property `prop` on `target`, nearest class first, or `undefined` when no registered class
 * of its chain declares one — every widget of this port, which keeps the attribute door.
 */
export function registeredParamSpec(target: object, prop: string): ParamSpec | undefined {
    for (let each: unknown = target.constructor; typeof each === 'function'; each = Object.getPrototypeOf(each)) {
        const spec = registeredClassOf(each)?.properties.find((candidate) => propertyOf(candidate.name) === prop);
        if (spec !== undefined) return spec;
    }
    return undefined;
}

// `g_ascii_strtoll` / `g_ascii_strtoull` with base 0: leading space, a sign, `0x` hex, a leading
// `0` octal. Like them, the longest prefix is read and the rest ignored; only no digits at all fails.
const INTEGER = /^\s*([+-]?)(?:0[xX]([0-9a-fA-F]+)|(0[0-7]*)|([1-9][0-9]*))/;
// `g_ascii_strtod`: a decimal with optional exponent, or `inf` / `infinity` / `nan`.
const DOUBLE = /^\s*([+-]?)(?:(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|(inf(?:inity)?)|(nan))/i;

/** `_gtk_builder_boolean_from_string`: one of `1 y t 0 n f` alone, or true/yes/false/no, any case. */
function parseBoolean(text: string): boolean | undefined {
    if (text.length === 1) {
        if ('1yYtT'.includes(text)) return true;
        if ('0nNfF'.includes(text)) return false;
        return undefined;
    }
    const lower = text.toLowerCase();
    if (lower === 'true' || lower === 'yes') return true;
    if (lower === 'false' || lower === 'no') return false;
    return undefined;
}

function parseInteger(text: string): number | undefined {
    const match = INTEGER.exec(text);
    if (match === null) return undefined;
    const [, sign, hex, octal, decimal] = match;
    const magnitude =
        hex !== undefined ? parseInt(hex, 16) : octal !== undefined ? parseInt(octal, 8) : parseInt(decimal!, 10);
    return sign === '-' ? -magnitude : magnitude;
}

function parseDouble(text: string): number | undefined {
    const match = DOUBLE.exec(text);
    if (match === null) return undefined;
    const [, sign, digits, infinity] = match;
    const magnitude = digits !== undefined ? Number(digits) : infinity !== undefined ? Infinity : NaN;
    return sign === '-' ? -magnitude : magnitude;
}

/**
 * The authored text converted for `spec`, or `undefined` when GtkBuilder could not parse it
 * (`GTK_BUILDER_ERROR_INVALID_VALUE`). A negative unsigned integer, which `g_ascii_strtoull`
 * wraps around, is refused instead: a subset may refuse what GTK accepts, never invent a value.
 */
export function valueFromString(spec: ParamSpec, text: string): string | number | boolean | undefined {
    switch (spec.kind) {
        case 'string':
            return text;
        case 'boolean':
            return parseBoolean(text);
        case 'int':
            return parseInteger(text);
        case 'uint': {
            const parsed = parseInteger(text);
            return parsed === undefined || parsed < 0 || Object.is(parsed, -0) ? undefined : parsed;
        }
        case 'double':
            return parseDouble(text);
    }
}

const KIND_NAMES: Readonly<Record<ParamSpec['kind'], string>> = {
    boolean: 'boolean',
    string: 'string',
    int: 'integer',
    uint: 'unsigned integer',
    double: 'double',
};

/**
 * The value an authored property takes on `target`: converted by its registered ParamSpec when
 * a class of the chain declares one, else `null` — the caller keeps its own door. `where` names
 * the element and attribute for GtkBuilder's "Could not parse" refusal.
 */
export function authoredParamValue(
    target: object,
    prop: string,
    value: string | number | boolean,
    where: string,
): { value: string | number | boolean } | null {
    const spec = registeredParamSpec(target, prop);
    if (spec === undefined) return null;
    const text = String(value);
    const converted = valueFromString(spec, text);
    if (converted === undefined) {
        throw new Error(
            `${where}: Could not parse ${KIND_NAMES[spec.kind]} '${text}' for the property '${spec.name}', ` +
                `which ${target.constructor.name} registers as a ${spec.kind} ParamSpec.`,
        );
    }
    return { value: converted };
}
