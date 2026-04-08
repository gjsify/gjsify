// Side-effect module: registers DOMParser on globalThis.
// Import via `@gjsify/domparser/register` or list `DOMParser` in --globals.

import { DOMParser } from './index.js';

if (typeof (globalThis as any).DOMParser === 'undefined') {
    (globalThis as any).DOMParser = DOMParser;
}
