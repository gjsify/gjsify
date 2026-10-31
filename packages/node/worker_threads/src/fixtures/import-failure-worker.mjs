// SPDX-License-Identifier: MIT
// The worker script fails while loading: the parent must get one `error` and
// then `exit` 1, on Node and on GJS alike. Raw .mjs, no bundling.

await import('./this-module-does-not-exist.mjs');
