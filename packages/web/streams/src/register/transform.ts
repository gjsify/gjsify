// Registers: TransformStream

import { TransformStream } from '../index.js';

/**
 * Typed view of the GJS global slot we may overwrite. Keeps the install
 * branch free of `as any` while still tolerating the property being
 * absent in the GJS bootstrap state.
 */
interface _TransformStreamGlobals {
    TransformStream?: typeof TransformStream;
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

if (!isNativeStreamUsable(globalThis.TransformStream, 'readable')) {
    const g = globalThis as unknown as _TransformStreamGlobals;
    g.TransformStream = TransformStream;
}
