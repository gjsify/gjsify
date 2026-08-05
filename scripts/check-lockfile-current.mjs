#!/usr/bin/env node
/**
 * CLI entry: fail when the TRACKED `gjsify-lock.json` does not carry the data
 * the current lockfile format promises.
 *
 * Why this exists — the bug it would have caught:
 *
 * `applyPlatformFilter()` decides per package whether this host can use it, and
 * marks the misses `inert` so they are never downloaded. It is entirely
 * DATA-DRIVEN: it reads `os` / `cpu` / `libc` / `optional` off each lockfile
 * entry. A `lockfileVersion: 2` entry carries none of those fields, so the
 * filter had nothing to filter on and every checkout installed every platform's
 * prebuilds — 4935 MB where 1268 MB is usable, 183 foreign-platform packages on
 * a linux-x64 host. The feature had shipped, with e2e coverage, and was dead in
 * this repo for one reason: the tracked lockfile was never regenerated.
 *
 * Nothing complained. That is the point. `install --immutable` deliberately
 * ACCEPTS old versions (`READABLE_LOCKFILE_VERSIONS`) so a fresh clone of an
 * older commit still installs, and every install therefore succeeded — quietly,
 * at 4× the size. A silent 3.7 GB is exactly the shape of defect that no test
 * asserting "the filter works" can see, because the filter did work; it was
 * handed empty inputs.
 *
 * So the check is on the DATA, not just the version number:
 *
 *   1. the tracked `lockfileVersion` equals what the installer writes today, and
 *   2. every entry whose NAME encodes a platform triple actually carries the
 *      matching `os` (and `cpu`, when the name encodes an arch).
 *
 * (2) is what makes this more than a version assertion: a regeneration that
 * bumped the number while dropping the fields — or a hand-edit, or a merge that
 * took one side of a conflicted lockfile — passes (1) and fails (2). It is a
 * real invariant rather than a count: the file itself names the packages that
 * MUST be platform-scoped, so there is no threshold to tune and nothing to keep
 * in sync as dependencies come and go.
 *
 * What it does NOT prove: that the filter's verdicts are correct. That is the
 * `install-platform-filter` e2e suite's job. This only guarantees the verdicts
 * are computed from real inputs.
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
 * The `lockfileVersion` a fresh resolve writes, READ FROM THE WRITER.
 *
 * Never restate the number: a version the writer records and its checkers read
 * cannot disagree, so the next format bump needs no sweep of call sites. A parse
 * failure THROWS rather than guessing — a checker that silently fell back to a
 * literal would pass forever after the declaration moved.
 *
 * Exported because `tests/e2e/helpers.mjs` reads it too, and two readers of one
 * declaration is the duplication this function exists to prevent.
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
 * A package name that ends in a platform triple, e.g. `@gjsify/webgl-linux-x64`,
 * `…-darwin-arm64`, `…-linux-arm64-musl`. Matches the naming convention every
 * platform-scoped package in this workspace and its dependency tree follows
 * (esbuild's, which ADR 0017 adopted) — the same shape the prebuild packages are
 * published under.
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

    // The data check. Runs even on a version mismatch: knowing WHICH fields are
    // absent is more actionable than the version number alone.
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

// Run only when invoked as the CLI, because `tests/e2e/helpers.mjs` imports this
// module for `readLockfileVersion()` and must not trigger the check (or its
// `process.exit`) on import.
//
// `pathToFileURL`, not a `file://` template: on Windows the interpolated form
// yields `file://C:\…` against an `import.meta.url` of `file:///C:/…`, so the
// guard would never match and this check would exit 0 having asserted NOTHING.
// audit-runtimes.yml runs it on windows-latest as well as ubuntu, which is
// exactly where a silently-skipped check does its damage.
//
// The `argv[1]` guard is not padding: under `node -e` / `--eval` / the REPL there
// is no script path, and `pathToFileURL(undefined)` THROWS `ERR_INVALID_ARG_TYPE`
// — so importing this module from an eval'd script would crash on the guard
// itself. (The `file://` template form hid that by producing the harmless
// non-match `file://undefined`, which is the same silent-skip trap in reverse.)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
