#!/usr/bin/env node
// Prepares an empty per-suite scratch tree for the chokidar integration suite.
// chokidar tests are I/O-driven: each spec creates its own subdirectory under
// `fixtures/` at runtime, drops files, watches, mutates, asserts, then cleans
// up. No upstream fixtures to copy (chokidar's npm tarball does not ship its
// own test/fixtures tree — `files: ["index.js", "esm", …]`).
//
// We just (re)create an empty `fixtures/` so `src/fixtures.ts` has a stable
// anchor relative to `dist/test.{node,gjs}.mjs` at run time.

import { mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dest = join(__dirname, '..', 'fixtures');

await rm(dest, { recursive: true, force: true });
await mkdir(dest, { recursive: true });

console.log(`[setup-fixtures] cleared scratch tree → ${dest}`);
