#!/usr/bin/env node
/**
 * Print whether this host can create a symbolic link.
 *
 * WHY A SCRIPT AND NOT A `node -e` ONE-LINER
 *
 * The one-liner form has to survive cmd.exe quoting, which is the layer that
 * silently mangles `'` and `"` differently from every other shell in this
 * repository's CI. A file has no quoting layer at all.
 *
 * WHY IT IS WORTH PRINTING
 *
 * `@gjsify/fs`'s symlink specs are gated on the CAPABILITY (see
 * `packages/node/fs/src/capabilities.spec.ts`), never on the platform, because
 * Windows has symlinks and merely requires elevation or Developer Mode to make
 * one. GitHub's Windows runners are elevated, so those tests RUN there; an
 * ordinary workstation tolerates them as expected failures instead.
 *
 * Both outcomes are correct and they are not distinguishable from a green
 * check, so the run has to say which one it measured. A reader who assumes the
 * elevated result covers the unprivileged case has the wrong picture — that
 * asymmetry is precisely what ADR 0018 was written to stop happening silently.
 *
 * Never exits non-zero: this reports, it does not gate.
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
