// Side-effect module: registers DOMParser on globalThis.
// Import via `@gjsify/domparser/register` or list `DOMParser` in --globals.

import { DOMParser } from './index.js';

interface _DomParserGlobals { DOMParser?: typeof DOMParser }
const g = globalThis as unknown as _DomParserGlobals;

if (typeof g.DOMParser === 'undefined') {
    g.DOMParser = DOMParser;
}
