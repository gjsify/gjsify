// Resolves the absolute path to ./fixtures/ relative to the bundle.
// `import.meta.url` of this source file points at src/fixtures.ts at build
// time, but after bundling the bundle lives at dist/test.{node,gjs}.mjs —
// fixtures/ sits one directory up from there in both cases.
//
// Both gjsify build targets preserve `import.meta.url`. We resolve via
// new URL(...) so the path follows the bundle, not the source layout.

import { fileURLToPath } from 'node:url';

export const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/', import.meta.url));
