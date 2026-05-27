// Registers: ByteLengthQueuingStrategy, CountQueuingStrategy

import { ByteLengthQueuingStrategy, CountQueuingStrategy } from '../index.js';

/**
 * Typed view of the GJS global slots this register module installs.
 * Keeps the writes free of `as any` while tolerating their absence
 * during early bootstrap.
 */
interface _QueuingStrategyGlobals {
    ByteLengthQueuingStrategy?: typeof ByteLengthQueuingStrategy;
    CountQueuingStrategy?: typeof CountQueuingStrategy;
}

const g = globalThis as unknown as _QueuingStrategyGlobals;

if (typeof globalThis.ByteLengthQueuingStrategy === 'undefined') {
    g.ByteLengthQueuingStrategy = ByteLengthQueuingStrategy;
}
if (typeof globalThis.CountQueuingStrategy === 'undefined') {
    g.CountQueuingStrategy = CountQueuingStrategy;
}
