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
    // AGENTS.md package convention: "...`@gjsify/<name>`, v0.7.3, `\"type\":\"module\"`..."
    { file: 'AGENTS.md', anchor: '@gjsify/<name>`, v' },
];

const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..');

/** file -> { content, changed } | null (missing) */
const byFile = new Map();

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
    } else {
        console.warn(`[bump-docs-version] anchor not found in ${file}: "${from}" (already current, or anchor drifted)`);
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
