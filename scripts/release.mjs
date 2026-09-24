#!/usr/bin/env node
// `node scripts/release.mjs [release-it args…]` — local entry to release-it with a
// GitHub token, taken from `GITHUB_TOKEN` or else from `gh auth token`.
//
// The root `release*` scripts used to spell that as
// `GITHUB_TOKEN=${GITHUB_TOKEN:-$(gh auth token)} release-it …`: a prefix, a
// default expansion and a command substitution, none of which cmd.exe has. The
// release is cut from CI (`release-cut.yml`, which calls release-it directly), so
// this is the maintainer's local path only.
//
// release-it is launched through its JS entry on `process.execPath`, not as
// `release-it`, which on Windows is a `.cmd` shim a bare spawn cannot run.

import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

function githubToken() {
    if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
    try {
        return execFileSync('gh', ['auth', 'token'], { encoding: 'utf-8' }).trim();
    } catch (err) {
        console.error(`release: GITHUB_TOKEN is unset and \`gh auth token\` failed (${err.message}).`);
        process.exit(1);
    }
}

const require = createRequire(import.meta.url);
const pkgPath = require.resolve('release-it/package.json');
const bin = join(dirname(pkgPath), require(pkgPath).bin['release-it']);
const r = spawnSync(process.execPath, [bin, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, GITHUB_TOKEN: githubToken() },
});
if (r.error) throw r.error;
process.exit(r.status ?? 1);
