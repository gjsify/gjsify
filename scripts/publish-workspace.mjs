#!/usr/bin/env node
// Wrapper around `npm publish` for a single workspace.
//
// Rewrites `workspace:^` / `workspace:~` / `workspace:*` deps in the workspace's
// package.json to resolved npm version ranges (read from the sibling workspaces'
// own package.json `version` fields), runs `npm publish` with the passed flags,
// then restores the original package.json.
//
// `npm publish` from inside a workspace directory does NOT auto-rewrite the
// workspace protocol — only yarn does, or npm when invoked with
// `--workspace <name>` from the monorepo root. `gjsify foreach --exec --
// npm publish` runs npm in the workspace cwd and has no knowledge of the
// monorepo, so the tarball goes out with `workspace:^` strings unchanged,
// which consumers can't resolve. This wrapper closes that gap until
// `gjsify publish` lands as a first-class command.
//
// Usage: invoked from `gjsify foreach --exec -- node <repoRoot>/scripts/publish-workspace.mjs <npm-publish-flags...>`
// Reads cwd's package.json. Walks up to the monorepo root to discover
// sibling workspaces and their versions.

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';

const npmPublishArgs = process.argv.slice(2);
const cwd = process.cwd();
const pkgPath = join(cwd, 'package.json');

if (!existsSync(pkgPath)) {
  console.error(`publish-workspace: no package.json at ${cwd}`);
  process.exit(1);
}

const originalSource = readFileSync(pkgPath, 'utf-8');
const pkg = JSON.parse(originalSource);

if (pkg.private === true) {
  console.log(`publish-workspace: ${pkg.name} is private — skipping`);
  process.exit(0);
}

const root = findMonorepoRoot(cwd);
if (!root) {
  console.error(`publish-workspace: no monorepo root with pkg.workspaces found above ${cwd}`);
  process.exit(1);
}

const versionsByName = new Map();
for (const ws of discoverSiblings(root)) {
  if (ws.name) versionsByName.set(ws.name, ws.version);
}

let rewrites = 0;
for (const block of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
  const deps = pkg[block];
  if (!deps) continue;
  for (const [name, range] of Object.entries(deps)) {
    if (typeof range !== 'string') continue;
    if (!range.startsWith('workspace:')) continue;
    const wsVer = versionsByName.get(name);
    if (!wsVer) {
      console.error(`publish-workspace: ${pkg.name} declares workspace:^ dep on ${name} but no sibling workspace with that name found`);
      process.exit(1);
    }
    const operator = range.slice('workspace:'.length);
    let resolved;
    if (operator === '*' || operator === '') {
      resolved = wsVer;
    } else if (operator === '^' || operator === '~') {
      resolved = `${operator}${wsVer}`;
    } else {
      // workspace:<custom-range> — pass through as-is (rare)
      resolved = operator;
    }
    deps[name] = resolved;
    rewrites++;
  }
}

if (rewrites > 0) {
  console.log(`publish-workspace: ${pkg.name} — rewrote ${rewrites} workspace:* dep(s)`);
}

let exitCode = 0;
try {
  // Preserve indentation of original source for the rewritten copy
  const indentMatch = originalSource.match(/\n([ \t]+)"/);
  const indent = indentMatch ? indentMatch[1] : '  ';
  writeFileSync(pkgPath, JSON.stringify(pkg, null, indent) + '\n');
  const result = spawnSync('npm', ['publish', ...npmPublishArgs], {
    cwd, stdio: 'inherit', env: process.env,
  });
  exitCode = result.status ?? 1;
} finally {
  // Always restore the original package.json so the working tree stays clean.
  // Restore happens BEFORE process.exit — `process.exit()` from inside try
  // skips finally in Node, leaving package.json with workspace:^ rewritten.
  writeFileSync(pkgPath, originalSource);
}
process.exit(exitCode);

function findMonorepoRoot(start) {
  let dir = start;
  for (let i = 0; i < 12; i++) {
    const p = join(dir, 'package.json');
    if (existsSync(p)) {
      try {
        const m = JSON.parse(readFileSync(p, 'utf-8'));
        if (m.workspaces) return dir;
      } catch { /* keep walking */ }
    }
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function discoverSiblings(monorepoRoot) {
  const out = [];
  const rootPkg = JSON.parse(readFileSync(join(monorepoRoot, 'package.json'), 'utf-8'));
  const patterns = Array.isArray(rootPkg.workspaces)
    ? rootPkg.workspaces
    : (rootPkg.workspaces?.packages ?? []);
  for (const pattern of patterns) {
    if (pattern.endsWith('/*')) {
      const parentDir = join(monorepoRoot, pattern.slice(0, -2));
      let entries;
      try { entries = readdirSync(parentDir, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        readWorkspaceManifest(join(parentDir, e.name), out);
      }
    } else {
      readWorkspaceManifest(join(monorepoRoot, pattern), out);
    }
  }
  return out;
}

function readWorkspaceManifest(dir, out) {
  const p = join(dir, 'package.json');
  if (!existsSync(p)) return;
  try {
    const m = JSON.parse(readFileSync(p, 'utf-8'));
    if (m.name && m.version) out.push({ name: m.name, version: m.version });
  } catch { /* skip */ }
}
