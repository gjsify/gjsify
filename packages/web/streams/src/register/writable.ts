// Registers: WritableStream

import { WritableStream } from '../index.js';

/**
 * Typed view of the GJS global slot we may overwrite. Keeps the install
 * branch free of `as any` while still tolerating the property being
 * absent in the GJS bootstrap state.
 */
interface _WritableStreamGlobals {
    WritableStream?: typeof WritableStream;
}

function isNativeStreamUsable(Ctor: unknown, method: string): boolean {
    try {
        if (typeof Ctor !== 'function') return false;
        const proto = (Ctor as { prototype?: Record<string, unknown> }).prototype;
        return typeof proto?.[method] === 'function';
    } catch {
        return false;
    }
}

if (!isNativeStreamUsable(globalThis.WritableStream, 'getWriter')) {
    const g = globalThis as unknown as _WritableStreamGlobals;
    g.WritableStream = WritableStream;
}
