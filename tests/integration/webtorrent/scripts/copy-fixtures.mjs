#!/usr/bin/env node
// Copies webtorrent-fixtures data into ./fixtures/ for the tests to read.
// The npm package ships binary .torrent files + sample content under its
// own `fixtures/` directory. We resolve its package.json, walk up to its
// root, and copy the whole `fixtures/` dir next to this script's package.

import { createRequire } from 'node:module';
import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const destDir = join(__dirname, '..', 'fixtures');

const require = createRequire(import.meta.url);
const fixturesPkgPath = require.resolve('webtorrent-fixtures/package.json');
const fixturesRoot = dirname(fixturesPkgPath);
const srcDir = join(fixturesRoot, 'fixtures');

if (!existsSync(srcDir)) {
  console.error(`[copy-fixtures] Source not found: ${srcDir}`);
  process.exit(1);
}

await rm(destDir, { recursive: true, force: true });
await mkdir(destDir, { recursive: true });
await cp(srcDir, destDir, { recursive: true });

console.log(`[copy-fixtures] ${srcDir} → ${destDir}`);
