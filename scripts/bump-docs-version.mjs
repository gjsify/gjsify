#!/usr/bin/env node
// Bump the "current version" string in docs during `release-it`.
//
// Invoked from `.release-it.json` as:
//   node scripts/bump-docs-version.mjs ${latestVersion} ${version}
//
// ANCHORED, not blunt. Each TARGETS entry bumps ONLY the version string that
// immediately follows a distinctive anchor phrase (a known "current version"
// spot). A blunt whole-file version replace is a footgun: it rewrites EVERY
// past `vX` reference, corrupting historical prose. That is exactly what the
// old version of this script did during the v0.7.3 release — it silently
// rewrote 34 historical `v0.7.2` entries in the then-hand-written STATUS.md
// and ~7 in AGENTS.md to `v0.7.3`, making the changelog claim things shipped
// in a version they predate.
//
// RULES (keep this script trustworthy):
//   - NEVER list CHANGELOG.md here — it is a point-in-time log; its version
//     mentions are history, never "current version". (STATUS.md is generated
//     and untracked, so it cannot be listed at all.)
//   - NEVER blunt-replace across a prose doc that carries version-tagged
//     history (AGENTS.md). Anchor on a phrase that ONLY ever precedes the
//     CURRENT version (e.g. the monorepo header `monorepo, v`).
//   - Safe to re-run: if the anchored version is already current, no change.

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , latestVersion, nextVersion] = process.argv;

if (!latestVersion || !nextVersion) {
    console.error('usage: bump-docs-version.mjs <latestVersion> <nextVersion>');
    process.exit(1);
}

if (latestVersion === nextVersion) {
    console.log(`[bump-docs-version] latest === next (${nextVersion}), nothing to do`);
    process.exit(0);
}

// Each entry bumps the version that IMMEDIATELY follows `anchor` (the anchor
// ends in the `v` of `vX.Y.Z`). The anchor must be unique to the current-version
// mention — never a phrase that also precedes a historical version.
const TARGETS = [
    // AGENTS.md monorepo header: "...npm-workspaces monorepo, v0.7.3, ESM-only..."
    { file: 'AGENTS.md', anchor: 'monorepo, v' },
    // The package-convention line used to carry a second copy ("`@gjsify/<name>`,
    // v0.7.3, ...") and was listed here. #885 replaced it with "ONE workspace
    // version (release train, ADR 0008)", which is both more informative and one
    // fewer copy to keep in sync — so there is deliberately no entry for it. Do
    // not re-add a version literal there just to give this script a second target.
];

const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..');

/** file -> { content, changed } | null (missing) */
const byFile = new Map();

/** Targets that bumped nothing for a reason that is not "already current". */
let deadTargets = 0;

for (const { file, anchor } of TARGETS) {
    if (!byFile.has(file)) {
        try {
            byFile.set(file, { content: await readFile(resolve(repoRoot, file), 'utf8'), changed: false });
        } catch (err) {
            if (err.code === 'ENOENT') {
                console.warn(`[bump-docs-version] skip (missing): ${file}`);
                byFile.set(file, null);
                continue;
            }
            throw err;
        }
    }
    const entry = byFile.get(file);
    if (!entry) continue;

    const from = `${anchor}${latestVersion}`;
    const to = `${anchor}${nextVersion}`;
    if (entry.content.includes(from)) {
        entry.content = entry.content.split(from).join(to);
        entry.changed = true;
        continue;
    }

    // A miss used to print one warning covering three different states, so a DEAD
    // entry — the anchored prose was rewritten and the version literal is simply
    // gone — read exactly like a harmless re-run. That is how the package-convention
    // entry above kept warning after #885 removed its version, silently bumping
    // nothing. Separate them: absent anchor is a defect in THIS file, an anchor
    // carrying an unexpected version means the docs and the release disagree, and
    // only "already at nextVersion" is benign.
    if (!entry.content.includes(anchor)) {
        console.error(
            `[bump-docs-version] dead target: anchor "${anchor}" no longer occurs in ${file}. ` +
                `Either the prose moved (re-anchor it) or the version mention was removed on ` +
                `purpose (delete the TARGETS entry). It is bumping nothing as it stands.`,
        );
        deadTargets += 1;
    } else if (entry.content.includes(to)) {
        console.log(`[bump-docs-version] ${file}: "${anchor}" already at ${nextVersion}, nothing to do`);
    } else {
        console.error(
            `[bump-docs-version] version drift: "${anchor}" in ${file} follows neither ` +
                `${latestVersion} nor ${nextVersion}. The docs disagree with the release.`,
        );
        deadTargets += 1;
    }
}

let changedFiles = 0;
for (const [file, entry] of byFile) {
    if (!entry || !entry.changed) continue;
    await writeFile(resolve(repoRoot, file), entry.content);
    changedFiles += 1;
    console.log(`[bump-docs-version] ${file}: anchored current-version ${latestVersion} -> ${nextVersion}`);
}

console.log(
    changedFiles === 0
        ? `[bump-docs-version] no anchored current-version mentions referenced ${latestVersion}`
        : `[bump-docs-version] updated ${changedFiles} file(s)`,
);

// Fail the cut rather than ship docs that quietly stopped tracking the version.
// This runs in release-it's `after:bump`, so the cost of being wrong here is a
// re-run; the cost of staying silent is a doc that claims the wrong version for
// as long as nobody reads the log.
if (deadTargets > 0) {
    console.error(`[bump-docs-version] ${deadTargets} target(s) bumped nothing — see above.`);
    process.exit(1);
}
