#!/usr/bin/env node
// Install the gjsify git hooks by pointing `core.hooksPath` at `.githooks/`.
//
// A plain script rather than husky/lefthook: a Node devDep to set one git config
// key is the wrong trade for a project migrating AWAY from third-party tooling.
// `git config core.hooksPath .githooks` is ESM-pure, works inside the
// gjsify-installed workspace, and re-applies cleanly on every install — so this is
// safe to call repeatedly from `gjsify install`.
//
// Usage:
//   node scripts/install-git-hooks.mjs            # install
//   node scripts/install-git-hooks.mjs --uninstall # restore git's default (.git/hooks)
//   node scripts/install-git-hooks.mjs --quiet     # no stdout on success
//
// Honours:
//   SKIP_GJSIFY_HOOKS=1   → exits 0 without touching git config

import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const HOOKS_DIR_RELATIVE = '.githooks';
const HOOKS_DIR_ABS = resolve(ROOT, HOOKS_DIR_RELATIVE);

// Enumerated, not globbed: a hook that silently fails to ship is exactly the
// class this repo keeps getting bitten by, so the expected set is declared and
// a missing member is a hard error below. Add new hooks here.
const EXPECTED_HOOKS = ['pre-commit'];

const args = new Set(process.argv.slice(2));
const QUIET = args.has('--quiet') || args.has('-q');
const UNINSTALL = args.has('--uninstall');

function log(msg) {
    if (!QUIET) console.log(`[gjsify install-git-hooks] ${msg}`);
}

function warn(msg) {
    console.warn(`[gjsify install-git-hooks] WARNING: ${msg}`);
}

if (process.env.SKIP_GJSIFY_HOOKS === '1') {
    log('SKIP_GJSIFY_HOOKS=1 — exiting without touching git config.');
    process.exit(0);
}

// Skip silently when this isn't a git checkout (e.g. extracted npm tarball
// install). `gjsify install` should never explode just because the consumer
// did not clone the repo.
if (!existsSync(resolve(ROOT, '.git'))) {
    log('no .git in workspace root — nothing to do (extracted tarball install?)');
    process.exit(0);
}

function gitConfig(args) {
    try {
        return execFileSync('git', ['config', ...args], { cwd: ROOT, encoding: 'utf-8' }).trim();
    } catch (err) {
        // `git config --get` exits 1 when the key is unset. That's not a hard
        // failure — return null and let the caller decide.
        if (err.status === 1) return null;
        throw err;
    }
}

function gitConfigUnset(key) {
    try {
        execFileSync('git', ['config', '--unset', key], { cwd: ROOT, encoding: 'utf-8' });
    } catch (err) {
        if (err.status === 5) return; // unset of a non-existent key — fine
        throw err;
    }
}

if (UNINSTALL) {
    const current = gitConfig(['--get', 'core.hooksPath']);
    if (current === null) {
        log('core.hooksPath already at git default — nothing to uninstall.');
        process.exit(0);
    }
    gitConfigUnset('core.hooksPath');
    log(`unset core.hooksPath (was ${current}) — git will use .git/hooks/ again.`);
    process.exit(0);
}

if (!existsSync(HOOKS_DIR_ABS) || !statSync(HOOKS_DIR_ABS).isDirectory()) {
    warn(`hooks directory ${HOOKS_DIR_ABS} not found — refusing to wire core.hooksPath at a non-existent path.`);
    process.exit(1);
}

const missingHooks = EXPECTED_HOOKS.filter((h) => !existsSync(resolve(HOOKS_DIR_ABS, h)));
if (missingHooks.length > 0) {
    warn(
        `expected hook(s) ${missingHooks.map((h) => `${HOOKS_DIR_RELATIVE}/${h}`).join(', ')} not found — ` +
            'the workspace tree is incomplete.',
    );
    process.exit(1);
}

// Apply each config key on its own and KEEP GOING. An early `process.exit(0)`
// here on a matching `core.hooksPath` makes everything below unreachable on the
// clones that need it most — an existing clone has the key set, so a later config
// key would only ever land on FRESH clones, invisibly. Idempotency is a property
// of each individual write, not a licence to abandon the rest of the script.
const current = gitConfig(['--get', 'core.hooksPath']);
if (current === HOOKS_DIR_RELATIVE) {
    log(`core.hooksPath already set to ${HOOKS_DIR_RELATIVE}.`);
} else {
    execFileSync('git', ['config', 'core.hooksPath', HOOKS_DIR_RELATIVE], { cwd: ROOT });
    log(`core.hooksPath = ${HOOKS_DIR_RELATIVE} (was ${current ?? 'unset / .git/hooks'})`);
}

log(`active hooks: ${EXPECTED_HOOKS.join(', ')}`);
log(`bypass with: 'git commit --no-verify' or SKIP_GJSIFY_HOOKS=1`);
