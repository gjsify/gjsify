// Side-effect module: registers XMLHttpRequest, URL.createObjectURL and
// URL.revokeObjectURL as globals on GJS.
// On Node.js the alias layer routes this subpath to @gjsify/empty — the native
// implementations are already present there.

import { XMLHttpRequest, installObjectURLSupport } from './index.js';

interface _XhrGlobals { XMLHttpRequest?: typeof XMLHttpRequest }
const g = globalThis as unknown as _XhrGlobals;

if (typeof g.XMLHttpRequest === 'undefined') {
    g.XMLHttpRequest = XMLHttpRequest;
}

// Patch URL.createObjectURL / revokeObjectURL
// URL is expected to be on globalThis already (via @gjsify/node-globals or @gjsify/url).
installObjectURLSupport();
