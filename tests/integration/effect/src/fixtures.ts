// Resolves ./fixtures/ relative to the BUNDLE, not to this source file.
//
// THE FIXTURE IS COMMITTED, which the convention in `tests/AGENTS.md` says it
// should not be — there, `fixtures/` is gitignored and a `copy-fixtures.mjs`
// prebuild pulls it out of the npm devDep. That is not available here: upstream's
// `text.txt` lives in `packages/effect/test/fixtures/` in the REPOSITORY, and the
// published tarball ships no tests. So the file is authored here, byte-identical
// to upstream's (`lorem ipsum dolar sit amet\n`, upstream's spelling of "dolar"
// included, because two ported cases assert on it), and it is 27 bytes.
//
// `import.meta.url` points at src/fixtures.ts while type-checking and at
// dist/test.{node,gjs}.mjs after bundling; `fixtures/` sits one directory up from
// the bundle in both cases, which is why the `../` is not an error. Both gjsify
// build targets preserve `import.meta.url`, so the same expression resolves on
// Node and on GJS.

import { fileURLToPath } from 'node:url';

export const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/', import.meta.url)).replace(/\/$/, '');
