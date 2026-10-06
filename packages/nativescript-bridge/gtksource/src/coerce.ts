// XML attributes arrive as strings; these turn them into what a setter wants, and refuse
// what is not one rather than writing `NaN` or a truthy `'false'`.

export function toBoolean(value: unknown, name: string): boolean {
    if (typeof value === 'boolean') return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    throw new TypeError(`${name}: ${JSON.stringify(value)} is not a boolean`);
}

export function toNumber(value: unknown, name: string): number {
    const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    if (typeof number !== 'number' || !Number.isFinite(number)) {
        throw new TypeError(`${name}: ${JSON.stringify(value)} is not a number`);
    }
    return number;
}
