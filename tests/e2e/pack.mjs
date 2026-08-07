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
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { resolveGjsifySpawn } from '../../scripts/resolve-gjsify.mjs';
import { MONOREPO_ROOT, packableWorkspaces } from './workspaces.mjs';

const [tarballsDir] = process.argv.slice(2);
if (!tarballsDir) {
    console.error('Usage: pack.mjs <tarballsDir>');
    process.exit(1);
}

mkdirSync(tarballsDir, { recursive: true });

const selected = packableWorkspaces();

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
    //
    // Resolved rather than spawned by bare name. On Windows `gjsify` on PATH is
    // a `.cmd` shim and `CreateProcess` appends only `.exe` when it searches for
    // a bare name, so this was `spawnSync gjsify ENOENT` — in the ONE helper
    // that `createTestEnvironment` / `packWorkspaces` funnel through. 34 e2e
    // suites died here, before reaching their first assertion.
    const spec = resolveGjsifySpawn(MONOREPO_ROOT, ['pack', '--pack-destination', resolve(tarballsDir), '--json']);
    if (!spec) {
        console.error('pack.mjs: no gjsify CLI found (node_modules/.bin, PATH, or the committed bundle).');
        process.exit(1);
    }
    const stdout = execFileSync(spec.cmd, spec.args, {
        cwd: join(MONOREPO_ROOT, w.location),
        stdio: ['pipe', 'pipe', 'inherit'],
        encoding: 'utf8',
        maxBuffer: 50 * 1024 * 1024,
        windowsVerbatimArguments: spec.windowsVerbatimArguments,
    });
    const result = JSON.parse(stdout);
    const filename = result[0]?.filename;
    if (!filename) {
        console.error(`pack.mjs: ${w.name} — gjsify pack returned no filename`);
        process.exit(1);
    }
    tarballMap[w.name] = filename;
}
process.stdout.write(`${JSON.stringify(tarballMap, null, 2)}\n`);
