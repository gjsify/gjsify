// Side-effect module: registers DOMException as a global on GJS.
// On Node.js 17+ and modern browsers, DOMException is native — this module
// is aliased to @gjsify/empty for Node builds.

import { DOMException } from './index.js';

/** Module-local typed view of the globals this file writes. */
interface _DOMExceptionGlobals {
    DOMException?: typeof DOMException;
}

const g = globalThis as unknown as _DOMExceptionGlobals;

if (typeof globalThis.DOMException === 'undefined') {
    g.DOMException = DOMException;
}
