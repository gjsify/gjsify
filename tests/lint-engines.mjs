// Lint: ensure all published packages have valid engines fields.
// Catches outdated engines (e.g. "node": "16") that cause EBADENGINE warnings
// when users install @gjsify/cli via npx.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = join(__dirname, '..');
const MIN_NODE_MAJOR = 22;

// Get all non-private workspaces (same set that gets published)
function getPublishedWorkspaces() {
  const output = execFileSync('yarn', ['workspaces', 'list', '--json'], {
    cwd: MONOREPO_ROOT,
    encoding: 'utf8',
  });
  return output
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
    .filter((ws) => ws.location !== '.')
    .map((ws) => {
      const pkgPath = join(MONOREPO_ROOT, ws.location, 'package.json');
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      return { name: ws.name, location: ws.location, pkg };
    })
    .filter((ws) => !ws.pkg.private);
}

describe('published package engines', () => {
  const workspaces = getPublishedWorkspaces();

  it('no package requires node < ' + MIN_NODE_MAJOR, () => {
    const bad = [];
    for (const ws of workspaces) {
      const engines = ws.pkg.engines;
      if (!engines?.node) continue;

      // Parse the minimum node version from the engines field
      const match = engines.node.match(/(\d+)/);
      if (match && parseInt(match[1], 10) < MIN_NODE_MAJOR) {
        bad.push(`${ws.name}: engines.node = "${engines.node}" (in ${ws.location}/package.json)`);
      }
    }
    assert.equal(bad.length, 0,
      `Found packages with outdated engines.node:\n  ${bad.join('\n  ')}`
    );
  });

  it('no package has non-standard engines keys', () => {
    const VALID_KEYS = new Set(['node', 'npm', 'yarn', 'pnpm', 'vscode']);
    const bad = [];
    for (const ws of workspaces) {
      const engines = ws.pkg.engines;
      if (!engines) continue;
      for (const key of Object.keys(engines)) {
        if (!VALID_KEYS.has(key)) {
          bad.push(`${ws.name}: engines.${key} = "${engines[key]}" (in ${ws.location}/package.json)`);
        }
      }
    }
    assert.equal(bad.length, 0,
      `Found packages with non-standard engines keys (e.g. "gjs" is not recognized by npm):\n  ${bad.join('\n  ')}`
    );
  });
});
