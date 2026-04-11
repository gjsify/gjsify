/** Unconditionally expose a DOM class on `globalThis` (writable + configurable). */
export function defineGlobal(name: string, value: unknown): void {
    Object.defineProperty(globalThis, name, {
        value,
        writable: true,
        configurable: true,
    });
}

/** Only set the global if it hasn't already been defined. */
export function defineGlobalIfMissing(name: string, value: unknown): void {
    if (typeof (globalThis as any)[name] === 'undefined') {
        defineGlobal(name, value);
    }
}
