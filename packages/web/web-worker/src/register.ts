// Side-effect module: registers `Worker` as a global where the host has none.
// Browsers already have one; GJS and Node do not, and the alias map in
// @gjsify/resolve-npm routes `gjsify build --globals auto` here when a bundle
// references `Worker` as a free identifier — see globals-map.mjs.
//
// Usage:
//   import '@gjsify/web-worker/register';

import { Worker } from './index.js';

if (typeof (globalThis as { Worker?: unknown }).Worker === 'undefined') {
    (globalThis as { Worker: unknown }).Worker = Worker;
}
