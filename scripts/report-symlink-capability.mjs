#!/usr/bin/env node
/**
 * Print whether this host can create a symbolic link. Reports only — never exits
 * non-zero.
 *
 * A file rather than a `node -e` one-liner because the one-liner has to survive
 * cmd.exe quoting, which mangles `'` and `"` differently from every other shell in
 * this repo's CI.
 *
 * Worth printing because `@gjsify/fs`'s symlink specs gate on the CAPABILITY
 * (`packages/node/fs/src/capabilities.spec.ts`), never the platform: Windows has
 * symlinks and merely wants elevation or Developer Mode. GitHub's Windows runners are
 * elevated so those tests RUN there, while an ordinary workstation tolerates them as
 * expected failures. Both outcomes are correct and indistinguishable from a green
 * check, so the run must say which it measured — assuming the elevated result covers
 * the unprivileged case is the asymmetry ADR 0018 exists to surface.
 */

import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

let dir;
let verdict;
try {
    dir = mkdtempSync(join(tmpdir(), 'gjsify-symlink-probe-'));
    const target = join(dir, 'target.txt');
    writeFileSync(target, 'probe');
    symlinkSync(target, join(dir, 'link.txt'));
    verdict =
        "CAN_SYMLINK=true — this host may create symlinks, so @gjsify/fs's 19 symlink specs RUN and must pass here.";
} catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? err.code : 'unknown';
    verdict =
        `CAN_SYMLINK=false (${code}) — @gjsify/fs's 19 symlink specs are tolerated as expected failures on this host. ` +
        'On Windows that means the process is neither elevated nor running with Developer Mode.';
} finally {
    if (dir) {
        try {
            rmSync(dir, { recursive: true, force: true });
        } catch {
            // A reporter must not fail the run over its own cleanup.
        }
    }
}

console.log(`host: ${process.platform}-${process.arch}, node ${process.versions.node}`);
console.log(verdict);
