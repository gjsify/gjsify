#!/usr/bin/env node
// Builds a deterministic config-file tree under ./fixtures/ for the
// cosmiconfig integration suite. The published cosmiconfig tarball does
// NOT ship its own test fixtures (`files: ["dist", …]` strips test/),
// and the suite tests application-level loader behaviour, so we lay out
// our own predictable tree here.
//
// Layout produced (module name = "foo"):
//   fixtures/
//     projectA/                           # JSON rc-file
//       .foorc.json
//     projectB/                           # JS config-file (.config.js)
//       foo.config.js
//     projectC/                           # package.json field
//       package.json
//     projectD/                           # ESM .mjs config (dynamic import())
//       foo.config.mjs
//     projectE/                           # CJS .cjs config (default export)
//       .foorc.cjs
//     projectF/                           # YAML rc-file
//       .foorc.yaml
//     projectG/                           # search-up: nested dir, config at top
//       .foorc.json
//       deep/inner/                       # search starts here, walks up
//     projectH/                           # .config/foo subdir convention
//       .config/
//         foorc.json
//     projectI/                           # transform target
//       .foorc.json
//     projectJ/                           # cache target — same file, two reads
//       .foorc.json

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dest = join(__dirname, '..', 'fixtures');

await rm(dest, { recursive: true, force: true });
await mkdir(dest, { recursive: true });

// projectA — JSON rc
await mkdir(join(dest, 'projectA'), { recursive: true });
await writeFile(
  join(dest, 'projectA', '.foorc.json'),
  JSON.stringify({ source: 'json-rc', value: 1 }, null, 2) + '\n',
);

// projectB — JS config-file (ESM .js with package.json type=module)
await mkdir(join(dest, 'projectB'), { recursive: true });
// Mark this tree as ESM so .js files resolve as ESM under both Node and
// our GJS dynamic-import path.
await writeFile(
  join(dest, 'projectB', 'package.json'),
  JSON.stringify({ name: 'projectB', type: 'module' }) + '\n',
);
await writeFile(
  join(dest, 'projectB', 'foo.config.js'),
  "export default { source: 'js-config', value: 2 };\n",
);

// projectC — package.json field
await mkdir(join(dest, 'projectC'), { recursive: true });
await writeFile(
  join(dest, 'projectC', 'package.json'),
  JSON.stringify({ name: 'projectC', foo: { source: 'pkg-field', value: 3 } }, null, 2) + '\n',
);

// projectD — pure ESM .mjs (dynamic import())
await mkdir(join(dest, 'projectD'), { recursive: true });
await writeFile(
  join(dest, 'projectD', 'foo.config.mjs'),
  "export default { source: 'mjs-config', value: 4 };\n",
);

// projectE — CJS .cjs with module.exports
await mkdir(join(dest, 'projectE'), { recursive: true });
await writeFile(
  join(dest, 'projectE', '.foorc.cjs'),
  "module.exports = { source: 'cjs-rc', value: 5 };\n",
);

// projectF — YAML rc
await mkdir(join(dest, 'projectF'), { recursive: true });
await writeFile(
  join(dest, 'projectF', '.foorc.yaml'),
  'source: yaml-rc\nvalue: 6\n',
);

// projectG — search walks UP from deep/inner to find .foorc.json at the
// top. searchStrategy:'project' stops at the dir containing package.json
// or .git, so we mark projectG as the project root with a package.json.
await mkdir(join(dest, 'projectG', 'deep', 'inner'), { recursive: true });
await writeFile(
  join(dest, 'projectG', 'package.json'),
  JSON.stringify({ name: 'projectG' }) + '\n',
);
await writeFile(
  join(dest, 'projectG', '.foorc.json'),
  JSON.stringify({ source: 'walk-up', value: 7 }) + '\n',
);

// projectH — .config/<name>rc subdir convention
await mkdir(join(dest, 'projectH', '.config'), { recursive: true });
await writeFile(
  join(dest, 'projectH', '.config', 'foorc.json'),
  JSON.stringify({ source: 'dotconfig-subdir', value: 8 }) + '\n',
);

// projectI — transform target
await mkdir(join(dest, 'projectI'), { recursive: true });
await writeFile(
  join(dest, 'projectI', '.foorc.json'),
  JSON.stringify({ source: 'transform-input', value: 9 }) + '\n',
);

// projectJ — cache hit/miss target
await mkdir(join(dest, 'projectJ'), { recursive: true });
await writeFile(
  join(dest, 'projectJ', '.foorc.json'),
  JSON.stringify({ source: 'cache-target', value: 10 }) + '\n',
);

if (!existsSync(join(dest, 'projectA', '.foorc.json'))) {
  console.error(`[setup-fixtures] expected ${dest}/projectA/.foorc.json to exist`);
  process.exit(1);
}

console.log(`[setup-fixtures] wrote tree → ${dest}`);
