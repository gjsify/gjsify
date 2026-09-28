#!/usr/bin/env node
// The `test:e2e` npm script — runs the full local e2e suite: the discovered parallel
// batch (`node --test --test-concurrency=4`), then each serial suite alone, stopping at
// the first failure. Same shape the hand-maintained script literal held before
// `scripts/e2e-suites.mjs` replaced it with directory discovery.
//
// CI does not run this file — `scripts/e2e-shard.mjs` splits the same discovered set
// across shards instead. This is the local/full-run path only.

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LINT_ENGINES_SUITE, listE2eSuites } from './e2e-suites.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const abs = (p) => join(ROOT, p);

function runNodeTest(args) {
    const r = spawnSync('node', ['--test', ...args], { cwd: ROOT, stdio: 'inherit' });
    return r.status ?? 1;
}

const { parallel, serial } = listE2eSuites({ root: ROOT });
const batch = [...parallel, LINT_ENGINES_SUITE].sort().map(abs);

let status = runNodeTest(['--test-concurrency=4', ...batch]);
for (const suite of serial) {
    if (status !== 0) break;
    status = runNodeTest([abs(suite)]);
}
process.exit(status);
