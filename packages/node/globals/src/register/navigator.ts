// Registers: navigator, Navigator — Node ≥21's globals, see ../navigator.ts.

import { Navigator, navigator } from '../navigator.js';

if (typeof globalThis.navigator === 'undefined') {
    Object.defineProperty(globalThis, 'navigator', {
        value: navigator,
        enumerable: true,
        writable: true,
        configurable: true,
    });
}

if (typeof (globalThis as { Navigator?: unknown }).Navigator === 'undefined') {
    Object.defineProperty(globalThis, 'Navigator', {
        value: Navigator,
        enumerable: false,
        writable: true,
        configurable: true,
    });
}
