#!/usr/bin/env node
// Packs all non-private @gjsify/* workspace packages into tarballs using a
// single `yarn workspaces foreach pack` invocation. Outputs a JSON map of
// { packageName: tarballFilename } to stdout; diagnostic output goes to stderr.
//
// Usage: node pack.mjs <tarballsDir>

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = resolve(__dirname, '..', '..');

const [tarballsDir] = process.argv.slice(2);
if (!tarballsDir) {
  console.error('Usage: pack.mjs <tarballsDir>');
  process.exit(1);
}

mkdirSync(tarballsDir, { recursive: true });

const workspaces = execFileSync('yarn', ['workspaces', 'list', '--json'], {
  cwd: MONOREPO_ROOT,
  encoding: 'utf8',
  maxBuffer: 50 * 1024 * 1024,
})
  .trim()
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line))
  .filter((w) => w.location !== '.');

function readPkg(location) {
  return JSON.parse(readFileSync(join(MONOREPO_ROOT, location, 'package.json'), 'utf8'));
}

// Skip templates (consumed via scaffolding, not installed as deps) and private
// packages (yarn pack --no-private would refuse them anyway). Examples stay in
// because @gjsify/cli depends on @gjsify/example-* showcases.
const selected = workspaces.filter((w) => {
  if (w.name.startsWith('@gjsify/template-')) return false;
  const pkg = readPkg(w.location);
  return !pkg.private;
});

if (selected.length === 0) {
  process.stdout.write('{}\n');
  process.exit(0);
}

// Yarn expands %s to the package ident: @gjsify/foo → @gjsify-foo.tgz
const includeFlags = selected.flatMap((w) => ['--include', w.name]);
execFileSync(
  'yarn',
  ['workspaces', 'foreach', '-A', '--no-private', ...includeFlags, 'pack', '-o', `${tarballsDir}/%s.tgz`],
  { cwd: MONOREPO_ROOT, stdio: ['pipe', 'pipe', 'inherit'], maxBuffer: 50 * 1024 * 1024 },
);

const tarballMap = {};
for (const w of selected) {
  tarballMap[w.name] = `${w.name.replace('/', '-')}.tgz`;
}
process.stdout.write(`${JSON.stringify(tarballMap, null, 2)}\n`);
