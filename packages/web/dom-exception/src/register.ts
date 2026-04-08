// Side-effect module: registers DOMException as a global on GJS.
// On Node.js 17+ and modern browsers, DOMException is native — this module
// is aliased to @gjsify/empty for Node builds.

import { DOMException } from './index.js';

if (typeof globalThis.DOMException === 'undefined') {
  (globalThis as any).DOMException = DOMException;
}
