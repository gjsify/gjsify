// Registers: ByteLengthQueuingStrategy, CountQueuingStrategy

import { ByteLengthQueuingStrategy, CountQueuingStrategy } from '../index.js';

if (typeof globalThis.ByteLengthQueuingStrategy === 'undefined') {
  (globalThis as any).ByteLengthQueuingStrategy = ByteLengthQueuingStrategy;
}
if (typeof globalThis.CountQueuingStrategy === 'undefined') {
  (globalThis as any).CountQueuingStrategy = CountQueuingStrategy;
}
