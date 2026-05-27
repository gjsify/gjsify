// Legacy `util.isXxx` predicates. Deprecated upstream but still widely
// used; kept here for compatibility.
//
// Reference: Node.js lib/util.js — `util.isBoolean` family. The modern
// `util.types.isXxx` namespace lives in `./types.ts` and is exposed via
// the `types` export on the public surface.
// Original: see index.ts pre-split.

export function isBoolean(value: unknown): value is boolean {
    return typeof value === 'boolean';
}

export function isNull(value: unknown): value is null {
    return value === null;
}

export function isNullOrUndefined(value: unknown): value is null | undefined {
    return value == null;
}

export function isNumber(value: unknown): value is number {
    return typeof value === 'number';
}

export function isString(value: unknown): value is string {
    return typeof value === 'string';
}

export function isSymbol(value: unknown): value is symbol {
    return typeof value === 'symbol';
}

export function isUndefined(value: unknown): value is undefined {
    return value === undefined;
}

export function isObject(value: unknown): value is object {
    return value !== null && typeof value === 'object';
}

export function isError(value: unknown): value is Error {
    return value instanceof Error;
}

export function isFunction(value: unknown): value is Function {
    return typeof value === 'function';
}

export function isRegExp(value: unknown): value is RegExp {
    return value instanceof RegExp;
}

export function isArray(value: unknown): value is unknown[] {
    return Array.isArray(value);
}

export function isPrimitive(value: unknown): boolean {
    return value === null || (typeof value !== 'object' && typeof value !== 'function');
}

export function isDate(value: unknown): value is Date {
    return value instanceof Date;
}

export function isBuffer(value: unknown): boolean {
    return (
        value instanceof Uint8Array &&
        (value as unknown as { constructor?: { name?: string } }).constructor?.name === 'Buffer'
    );
}
