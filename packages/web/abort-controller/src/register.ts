// Side-effect module: registers AbortController/AbortSignal as globals on GJS.
// On Node.js these are already native — the aliases in @gjsify/resolve-npm
// route this subpath to @gjsify/empty during Node builds so it becomes a no-op.
//
// Usage: `import '@gjsify/abort-controller/register'` (or the bare-specifier
// `import 'abort-controller'` which the build plugin aliases to this file on GJS).

import { AbortController, AbortSignal } from './index.js';

if (typeof globalThis.AbortController === 'undefined') {
  (globalThis as any).AbortController = AbortController;
}
if (typeof globalThis.AbortSignal === 'undefined') {
  (globalThis as any).AbortSignal = AbortSignal;
}
