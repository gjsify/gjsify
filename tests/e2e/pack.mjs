#!/usr/bin/env node
// Packs all non-private @gjsify/* workspace packages into tarballs.
// Outputs a JSON map of { packageName: tarballFilename } to stdout;
// diagnostic output goes to stderr.
//
// Usage: node pack.mjs <tarballsDir>
//
// Phase D.7d removed yarn from CI, so this script no longer shells out
// to `yarn workspaces list/foreach pack`. It now walks the root
// pkg.workspaces globs directly and invokes `npm pack` per workspace.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = resolve(__dirname, '..', '..');

const [tarballsDir] = process.argv.slice(2);
if (!tarballsDir) {
  console.error('Usage: pack.mjs <tarballsDir>');
  process.exit(1);
}

mkdirSync(tarballsDir, { recursive: true });

// Inline workspace walk — minimal-glob form (trailing `*` only) matches
// every pattern this monorepo's root pkg.workspaces uses.
function discoverWorkspaces() {
  const rootPkg = JSON.parse(readFileSync(join(MONOREPO_ROOT, 'package.json'), 'utf8'));
  const patterns = Array.isArray(rootPkg.workspaces)
    ? rootPkg.workspaces
    : (rootPkg.workspaces?.packages ?? []);
  const out = [];
  for (const pattern of patterns) {
    const dirs = pattern.endsWith('/*')
      ? readdirSync(join(MONOREPO_ROOT, pattern.slice(0, -2)), { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => join(MONOREPO_ROOT, pattern.slice(0, -2), d.name))
      : [join(MONOREPO_ROOT, pattern)];
    for (const dir of dirs) {
      const pkgPath = join(dir, 'package.json');
      if (!existsSync(pkgPath)) continue;
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
        if (!pkg.name) continue;
        out.push({ name: pkg.name, location: relative(MONOREPO_ROOT, dir), pkg });
      } catch { /* unreadable — skip */ }
    }
  }
  return out;
}

// Skip templates (consumed via scaffolding, not installed as deps) and
// private packages. Examples stay in because @gjsify/cli depends on
// @gjsify/example-* showcases.
const selected = discoverWorkspaces().filter((w) => {
  if (w.name.startsWith('@gjsify/template-')) return false;
  return !w.pkg.private;
});

if (selected.length === 0) {
  process.stdout.write('{}\n');
  process.exit(0);
}

const tarballMap = {};
for (const w of selected) {
  // `gjsify pack` writes `<scope>-<name>-<version>.tgz` (e.g.
  // `gjsify-buffer-0.4.0.tgz`) into the cwd by default. `--pack-destination`
  // redirects it to <tarballsDir> directly. Match the same --json shape as
  // npm pack: an array of {filename, …} entries.
  const stdout = execFileSync(
    'gjsify',
    ['pack', '--pack-destination', resolve(tarballsDir), '--json'],
    { cwd: join(MONOREPO_ROOT, w.location), stdio: ['pipe', 'pipe', 'inherit'], encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 },
  );
  const result = JSON.parse(stdout);
  const filename = result[0]?.filename;
  if (!filename) {
    console.error(`pack.mjs: ${w.name} — gjsify pack returned no filename`);
    process.exit(1);
  }
  tarballMap[w.name] = filename;
}
process.stdout.write(`${JSON.stringify(tarballMap, null, 2)}\n`);
