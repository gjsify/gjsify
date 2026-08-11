#!/usr/bin/env node
/**
 * CLI entry: fail when the TRACKED `gjsify-lock.json` does not carry the data
 * the current lockfile format promises.
 *
 * `applyPlatformFilter()` is entirely DATA-DRIVEN — it reads `os`/`cpu`/`libc`/
 * `optional` off each lockfile entry — and a `lockfileVersion: 2` entry carries
 * none of them, so every checkout installed every platform's prebuilds (4935 MB
 * where 1268 MB is usable, 183 foreign-platform packages on linux-x64). The
 * filter had shipped with e2e coverage and was dead here for one reason: the
 * tracked lockfile was never regenerated. Nothing complained, because
 * `install --immutable` deliberately accepts old versions
 * (`READABLE_LOCKFILE_VERSIONS`) so an older commit still clones and installs.
 *
 * So the check is on the DATA, not just the version number:
 *
 *   1. the tracked `lockfileVersion` equals what the installer writes today, and
 *   2. every entry whose NAME encodes a platform triple actually carries the
 *      matching `os` (and `cpu`, when the name encodes an arch).
 *
 * (2) is what makes it more than a version assertion: a regeneration that bumped
 * the number while dropping the fields — or a hand-edit, or a merge taking one
 * side of a conflicted lockfile — passes (1) and fails (2). The file names the
 * packages that MUST be platform-scoped, so there is no threshold to tune.
 *
 * What it does NOT prove: that the filter's verdicts are correct — that is the
 * `install-platform-filter` e2e suite's job.
 *
 * Usage: node scripts/check-lockfile-current.mjs
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = join(__dirname, '..');
const LOCKFILE_WRITER = join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'src', 'utils', 'install-backend-native.ts');
const LOCKFILE = join(MONOREPO_ROOT, 'gjsify-lock.json');

/**
 * The `lockfileVersion` a fresh resolve writes, READ FROM THE WRITER — never
 * restated, so a format bump needs no sweep of call sites. A parse failure
 * THROWS rather than guessing: a checker falling back to a literal would pass
 * forever after the declaration moved. Exported for `tests/e2e/helpers.mjs`.
 */
export function readLockfileVersion() {
    const src = readFileSync(LOCKFILE_WRITER, 'utf-8');
    const match = src.match(/^const LOCKFILE_VERSION = (\d+);$/m);
    if (!match) {
        throw new Error(
            `could not read LOCKFILE_VERSION from ${LOCKFILE_WRITER}. ` +
                `The declaration moved or changed shape — update this reader; do NOT hardcode the version.`,
        );
    }
    return Number(match[1]);
}

/**
 * A package name ending in a platform triple, e.g. `@gjsify/webgl-linux-x64`,
 * `…-darwin-arm64`, `…-linux-arm64-musl` — esbuild's convention, adopted by
 * ADR 0017 and followed by every platform-scoped package in the tree.
 */
const PLATFORM_NAME =
    /-(?<os>linux|darwin|win32|android|freebsd|openbsd|sunos)-(?<cpu>x64|arm64|arm|ia32|ppc64|s390x)(?<libc>-musl|-glibc)?$/;

function main() {
    const expected = readLockfileVersion();

    let lock;
    try {
        lock = JSON.parse(readFileSync(LOCKFILE, 'utf-8'));
    } catch (err) {
        console.error(`::error::cannot read ${LOCKFILE}: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
    }

    const problems = [];

    if (lock.lockfileVersion !== expected) {
        problems.push(
            `gjsify-lock.json is lockfileVersion ${lock.lockfileVersion}, but the installer writes ${expected}.\n` +
                `  Every field the newer format added is MISSING from this file, so anything that reads it\n` +
                `  (the platform filter above all) runs on empty inputs and silently does nothing.`,
        );
    }

    // Runs even on a version mismatch: WHICH fields are absent is more
    // actionable than the version number alone.
    const packages = lock.packages ?? {};
    const stripped = [];
    for (const [path, entry] of Object.entries(packages)) {
        const name = path.split('node_modules/').pop() ?? path;
        if (!PLATFORM_NAME.test(name)) continue;
        const missing = [];
        if (!entry.os?.length) missing.push('os');
        if (!entry.cpu?.length) missing.push('cpu');
        if (missing.length) stripped.push(`${name} (no ${missing.join(', ')})`);
    }

    if (stripped.length) {
        problems.push(
            `${stripped.length} package(s) whose NAME encodes a platform carry no platform fields:\n` +
                stripped
                    .slice(0, 10)
                    .map((s) => `    ${s}`)
                    .join('\n') +
                (stripped.length > 10 ? `\n    … and ${stripped.length - 10} more` : ''),
        );
    }

    if (problems.length) {
        console.error('::error::gjsify-lock.json is not carrying current platform data.\n');
        for (const p of problems) console.error(`  • ${p}\n`);
        console.error(
            `  Fix: run \`gjsify install\` (WITHOUT --immutable, which by design accepts old\n` +
                `  formats) and commit the regenerated gjsify-lock.json. It is a FORMAT migration:\n` +
                `  the resolve seeds from the existing pins, so no dependency version should change.\n` +
                `  Verify that before committing — a version bump hiding in a format migration is\n` +
                `  the one thing this file must never smuggle in.`,
        );
        process.exit(1);
    }

    const platformScoped = Object.keys(packages).filter((p) => PLATFORM_NAME.test(p.split('node_modules/').pop() ?? p));
    console.log(
        `gjsify-lock.json: v${lock.lockfileVersion} (current), ${Object.keys(packages).length} entries, ` +
            `${platformScoped.length} platform-scoped and all carrying os+cpu.`,
    );
}

// CLI-only, because `tests/e2e/helpers.mjs` imports `readLockfileVersion()` and
// must not trigger the check (or its `process.exit`) on import.
//
// `pathToFileURL`, not a `file://` template: on Windows the interpolated form
// yields `file://C:\…` against an `import.meta.url` of `file:///C:/…`, so the
// guard never matches and this check exits 0 having asserted NOTHING — and
// audit-runtimes.yml runs it on windows-latest as well as ubuntu.
//
// The `argv[1]` guard is not padding: under `node -e`/`--eval`/the REPL there is
// no script path, and `pathToFileURL(undefined)` THROWS `ERR_INVALID_ARG_TYPE`.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
