/** Deep merge objects (replaces lodash.merge) */
export function merge<T extends Record<string, unknown>>(target: T, ...sources: Record<string, unknown>[]): T {
    for (const source of sources) {
        if (!source) continue;
        for (const key of Object.keys(source)) {
            const targetVal = (target as Record<string, unknown>)[key];
            const sourceVal = source[key];
            if (sourceVal !== undefined) {
                if (isPlainObject(targetVal) && isPlainObject(sourceVal)) {
                    merge(targetVal, sourceVal);
                } else {
                    (target as Record<string, unknown>)[key] = sourceVal;
                }
            }
        }
    }
    return target;
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
    return (
        typeof val === 'object' &&
        val !== null &&
        !Array.isArray(val) &&
        Object.getPrototypeOf(val) === Object.prototype
    );
}
