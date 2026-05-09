// Resolves absolute paths to the fixture tree relative to the bundle.
// `import.meta.url` of this source file points at src/fixtures.ts at
// build time, but after bundling the bundle lives at
// dist/test.{node,gjs}.mjs — fixtures/ sits one directory up from there
// in both cases. We resolve via new URL(...) so the path follows the
// bundle, not the source layout.

import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/', import.meta.url));

export const project = (name: string) => join(FIXTURES_DIR, name);
