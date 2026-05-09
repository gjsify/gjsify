#!/usr/bin/env node
// Builds a small predictable directory tree under ./fixtures/ for the
// fast-glob integration suite. The published fast-glob tarball excludes
// its own test fixtures (see "files" filter in fast-glob/package.json),
// so we set up our own deterministic layout here.
//
// Layout produced:
//   fixtures/
//     a.ts
//     b.js
//     c.md
//     excluded.ts
//     .dotfile
//     sub/
//       c.ts
//       d.js
//       .dotsub/
//         hidden.ts
//       deeper/
//         e.ts
//     symlink-to-a.ts        -> a.ts                (file symlink)
//     symlink-to-sub         -> sub                 (dir symlink)
//     dangling-symlink.ts    -> ./does-not-exist.ts (broken)

import { mkdir, rm, writeFile, symlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dest = join(__dirname, '..', 'fixtures');

await rm(dest, { recursive: true, force: true });
await mkdir(dest, { recursive: true });

// Top-level files
await writeFile(join(dest, 'a.ts'), 'export const a = 1;\n');
await writeFile(join(dest, 'b.js'), 'export const b = 2;\n');
await writeFile(join(dest, 'c.md'), '# c\n');
await writeFile(join(dest, 'excluded.ts'), 'export const excluded = true;\n');
await writeFile(join(dest, '.dotfile'), 'hidden\n');

// Nested
await mkdir(join(dest, 'sub'), { recursive: true });
await writeFile(join(dest, 'sub', 'c.ts'), 'export const c = 3;\n');
await writeFile(join(dest, 'sub', 'd.js'), 'export const d = 4;\n');

await mkdir(join(dest, 'sub', '.dotsub'), { recursive: true });
await writeFile(join(dest, 'sub', '.dotsub', 'hidden.ts'), 'export const h = 1;\n');

await mkdir(join(dest, 'sub', 'deeper'), { recursive: true });
await writeFile(join(dest, 'sub', 'deeper', 'e.ts'), 'export const e = 5;\n');

// Symlinks (best-effort — non-POSIX may fail; we surface that as an error
// because the symlinks suite requires them and on Linux we always have them).
try {
  await symlink('a.ts', join(dest, 'symlink-to-a.ts'));
  await symlink('sub', join(dest, 'symlink-to-sub'), 'dir');
  await symlink('./does-not-exist.ts', join(dest, 'dangling-symlink.ts'));
} catch (err) {
  console.warn(`[setup-fixtures] symlink creation failed: ${err.message}`);
}

if (!existsSync(join(dest, 'a.ts'))) {
  console.error(`[setup-fixtures] expected ${dest}/a.ts to exist`);
  process.exit(1);
}

console.log(`[setup-fixtures] wrote tree → ${dest}`);
