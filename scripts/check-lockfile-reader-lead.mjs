#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// The READER must ship one release BEFORE the WRITER.
//
// WHAT THIS PROTECTS
//
// With no committed CLI bundle (ADR 0002), a Node-less GJS host bootstraps a
// fresh clone through `install.mjs`: it downloads the newest PUBLISHED
// `cli.gjs.mjs` from the GitHub release and runs `gjsify install --immutable`
// against this repo's `gjsify-lock.json`. That only works while the published
// CLI can READ the lockfile format `main` uses.
//
// It is not a hypothetical. `LOCKFILE_VERSION` moved twice in four releases —
// v0.26.1 wrote 2 and hard-rejected anything else (`if (parsed.lockfileVersion
// !== LOCKFILE_VERSION) return null;`), v0.27/0.28 moved to 3, v0.29/0.30 to 4
// — because a v2 entry carries no `os`/`cpu`/`optional` and the platform filter
// had nothing to filter on (measured: 4935 MB → 1268 MB installed). The format
// HAD to move. What must not happen is the writer moving first: for the whole
// window between "main writes N+1" and "a release ships a CLI that reads N+1",
// the documented Node-less bootstrap is dead, and it fails with a message about
// a lockfile that plainly exists.
//
// So the rule is an ORDERING, and this is the mechanism that holds it: bump
// `READABLE_LOCKFILE_VERSIONS` to include N+1, cut a release, and only then
// start writing N+1. ADR 0002 leaves this as prose ("the installer must be
// same-commit"); prose does not fail a PR.
//
// WHY IT PARSES THE PUBLISHED TARBALL RATHER THAN TRUSTING A LEDGER
//
// A tracked "the last release reads {2,3,4}" file is a second copy of a fact
// that lives in someone else's artifact, and it would be updated by the same
// commit that breaks the property. The npm tarball is the artifact a user
// actually gets, so it is the only honest source.
//
// FAILURE POLICY, DELIBERATELY ASYMMETRIC
//
//   - contract unreadable (file moved, constants renamed) → HARD ERROR. A check
//     that cannot find what it checks has stopped checking; passing would be a
//     lie of exactly the kind this repo keeps paying for.
//   - registry/network unreachable → WARN, exit 0. This runs on every PR with
//     no `paths:` filter; an npm outage must not block the queue, and it cannot
//     produce a false GREEN because the next reachable run re-checks.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONTRACT_SOURCE = 'packages/infra/cli/src/utils/install-backend-native.ts';
const CONTRACT_IN_TARBALL = 'package/lib/utils/install-backend-native.js';
const PKG = '@gjsify/cli';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name) => {
    const i = args.indexOf(`--${name}`);
    return i === -1 ? undefined : args[i + 1];
};

const registry = value('registry') ?? 'https://registry.npmjs.org';
const asJson = flag('json');

/**
 * `{ writes, reads }` from either the TypeScript source or its `tsc` output —
 * the two constants survive compilation verbatim, so ONE parser serves both.
 * That matters: a separate parser per side could disagree about the very thing
 * being compared.
 *
 * `new Set([2, 3, LOCKFILE_VERSION])` keeps the identifier after compilation,
 * so the numeric constant is resolved first and substituted.
 */
export function parseLockfileContract(text) {
    const writesMatch = text.match(/(?:const|let|var)\s+LOCKFILE_VERSION\s*=\s*(\d+)/);
    if (!writesMatch) return null;
    const writes = Number(writesMatch[1]);
    const readsMatch = text.match(/READABLE_LOCKFILE_VERSIONS\s*=\s*new Set\(\s*\[([^\]]*)\]/);
    // No readable set is not an unparseable file — it is the PRE-v0.27 contract,
    // whose reader was `if (parsed.lockfileVersion !== LOCKFILE_VERSION) return
    // null`, i.e. exactly one accepted version. Reporting that as "cannot read
    // the contract" would raise a tooling alarm for what is really the strictest
    // possible answer, and the strictest answer is the one worth checking against.
    if (!readsMatch) return { writes, reads: [writes] };
    const reads = readsMatch[1]
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
        .map((t) => (t === 'LOCKFILE_VERSION' ? writes : Number(t)))
        .filter((n) => Number.isInteger(n));
    if (!Number.isInteger(writes) || reads.length === 0) return null;
    return { writes, reads };
}

function fail(msg) {
    console.error(`::error::${msg}`);
    process.exitCode = 1;
}

function warn(msg) {
    console.warn(`::warning::${msg}`);
}

async function newestPublishedVersion() {
    const res = await fetch(`${registry}/${encodeURIComponent(PKG).replace('%40', '@')}`, {
        headers: { accept: 'application/vnd.npm.install-v1+json' },
    });
    if (!res.ok) throw new Error(`packument ${res.status} ${res.statusText}`);
    const body = await res.json();
    const latest = body['dist-tags']?.latest;
    if (!latest) throw new Error('packument carries no dist-tags.latest');
    return { version: latest, tarball: body.versions?.[latest]?.dist?.tarball };
}

/** The contract file out of the published tarball, without unpacking the rest. */
async function publishedContract(tarballUrl) {
    const res = await fetch(tarballUrl);
    if (!res.ok) throw new Error(`tarball ${res.status} ${res.statusText}`);
    const dir = mkdtempSync(join(tmpdir(), 'gjsify-readerlead-'));
    try {
        const tgz = join(dir, 'cli.tgz');
        writeFileSync(tgz, Buffer.from(await res.arrayBuffer()));
        // `-O` streams the one member to stdout; nothing is written to disk.
        return execFileSync('tar', ['-xzOf', tgz, CONTRACT_IN_TARBALL], {
            encoding: 'utf8',
            maxBuffer: 64 * 1024 * 1024,
        });
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

async function main() {
    const local = parseLockfileContract(readFileSync(join(REPO_ROOT, CONTRACT_SOURCE), 'utf8'));
    if (!local) {
        fail(
            `check-lockfile-reader-lead: cannot read LOCKFILE_VERSION / READABLE_LOCKFILE_VERSIONS from ${CONTRACT_SOURCE}.\n` +
                'The check is blind, which is not the same as passing. Fix the parser or the constants.',
        );
        return;
    }

    const lockPath = join(REPO_ROOT, 'gjsify-lock.json');
    const committed = JSON.parse(readFileSync(lockPath, 'utf8')).lockfileVersion;

    let published;
    try {
        const { version, tarball } = await newestPublishedVersion();
        if (!tarball) throw new Error(`no dist.tarball for ${PKG}@${version}`);
        const contract = parseLockfileContract(await publishedContract(tarball));
        if (!contract) {
            fail(
                `check-lockfile-reader-lead: ${PKG}@${version} ships no parseable lockfile contract at ${CONTRACT_IN_TARBALL}.\n` +
                    'Either the file moved or the constants were renamed — update this script in the same change.',
            );
            return;
        }
        published = { version, ...contract };
    } catch (err) {
        // Fail-open, and say so loudly enough that a permanently broken fetch
        // cannot masquerade as a passing check.
        warn(
            `check-lockfile-reader-lead: could not reach the registry (${err.message}). ` +
                'Skipping the reader-lead assertion for this run — it is NOT a pass.',
        );
        if (asJson) console.log(JSON.stringify({ skipped: true, reason: err.message, local, committed }, null, 2));
        return;
    }

    if (asJson) console.log(JSON.stringify({ local, committed, published }, null, 2));

    const readable = new Set(published.reads);
    const advice =
        `  The Node-less bootstrap runs: gjs -m install.mjs → the published CLI → gjsify install --immutable.\n` +
        `  Ship the READER first: add the new version to READABLE_LOCKFILE_VERSIONS, cut a release,\n` +
        `  and only then raise LOCKFILE_VERSION. See docs/adr/0002-bootstrap-bundle-minimization.md.`;

    // 1. The live property: what is COMMITTED must be readable today.
    if (!readable.has(committed)) {
        fail(
            `gjsify-lock.json is lockfileVersion ${committed}, but the newest published ${PKG}@${published.version} ` +
                `reads only {${published.reads.join(', ')}}.\n` +
                `  A fresh clone on a host without Node cannot bootstrap this commit.\n${advice}`,
        );
    }

    // 2. The next-write property: any non-immutable install rewrites the lockfile
    //    at LOCKFILE_VERSION, so a writer ahead of the published reader breaks the
    //    bootstrap the moment anyone runs `gjsify install` without --immutable.
    if (!readable.has(local.writes)) {
        fail(
            `LOCKFILE_VERSION is ${local.writes}, but the newest published ${PKG}@${published.version} ` +
                `reads only {${published.reads.join(', ')}}.\n` +
                `  The first non-immutable install would rewrite gjsify-lock.json into a format the\n` +
                `  documented bootstrap cannot read.\n${advice}`,
        );
    }

    if (process.exitCode !== 1) {
        console.log(
            `lockfile reader-lead OK — committed v${committed}, source writes v${local.writes}, ` +
                `published ${PKG}@${published.version} reads {${published.reads.join(', ')}}.`,
        );
    }
}

// Same guard, and for the same measured reason, as `check-lockfile-current.mjs`:
// under `node -e` / the REPL there is no `argv[1]`, and `pathToFileURL(undefined)`
// THROWS — so importing this module (which the e2e suite does, to exercise
// `parseLockfileContract` without the network) would crash on the guard itself.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
