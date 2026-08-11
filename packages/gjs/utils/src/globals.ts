/**
 * Register `value` as a global only where that name is still free, so a web polyfill
 * never displaces a host implementation that is already there.
 */
export function registerGlobal(name: string, value: unknown): void {
    const g = globalThis as unknown as Record<string, unknown>;
    if (typeof g[name] === 'undefined') {
        g[name] = value;
    }
}
