#!/usr/bin/env node
// Bump hard-coded version strings in docs during `release-it`.
//
// Invoked from `.release-it.json` as:
//   node scripts/bump-docs-version.mjs ${latestVersion} ${version}
//
// Replaces every occurrence of `v<latest>` and `<latest>` with the new
// version across the configured docs list. Safe to re-run: if the version
// is already current the file is left untouched (no timestamp churn).

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

// Files to scan. Globs intentionally NOT used — we want the list to be explicit
// so a renamed file can't be silently skipped.
const FILES = [
    'AGENTS.md',
    'STATUS.md',
    'README.md',
    'website/src/content/docs/packages/overview.md',
    'website/src/content/docs/packages/node.md',
    'website/src/content/docs/packages/web.md',
    'website/src/content/docs/packages/dom.md',
];

const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..');

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Match `v1.2.3` OR bare `1.2.3` only when it's a standalone token (not a
// substring of `0.1.150` etc.). Lookbehind/lookahead keep us off unrelated
// numerics.
const escaped = escapeRegex(latestVersion);
const versionPattern = new RegExp(
    `(?<=^|[^\\w.-])(v?)${escaped}(?=[^\\w.-]|$)`,
    'gm',
);

let changedCount = 0;

for (const relPath of FILES) {
    const absPath = resolve(repoRoot, relPath);
    let content;
    try {
        content = await readFile(absPath, 'utf8');
    } catch (err) {
        if (err.code === 'ENOENT') {
            console.warn(`[bump-docs-version] skip (missing): ${relPath}`);
            continue;
        }
        throw err;
    }

    const next = content.replace(versionPattern, (_m, prefix) => `${prefix}${nextVersion}`);
    if (next === content) continue;

    await writeFile(absPath, next);
    const hits = (content.match(versionPattern) ?? []).length;
    console.log(`[bump-docs-version] ${relPath}: ${hits} occurrence(s) ${latestVersion} -> ${nextVersion}`);
    changedCount += 1;
}

console.log(
    changedCount === 0
        ? `[bump-docs-version] no docs referenced ${latestVersion}`
        : `[bump-docs-version] updated ${changedCount} file(s)`,
);
