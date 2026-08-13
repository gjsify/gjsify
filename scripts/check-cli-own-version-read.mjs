#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// The CLI must read its OWN version through one resolver, never at a fixed depth.
//
// WHAT THIS PROTECTS
//
// `@gjsify/cli` is a DUAL-ENTRY package: `npm install` runs the tsc output under
// `lib/`, while a globally installed `gjsify` runs the bundle at
// `dist/cli.gjs.mjs`. A relative manifest read is therefore depth-dependent —
// `new URL('../../package.json', import.meta.url)` resolves correctly from
// `lib/commands/` and lands one directory ABOVE the package from `dist/`, where
// there is no manifest at all. The read is inside a `try`, so it does not throw;
// it quietly answers "no version".
//
// That is not cosmetic, because the version is load-bearing. `showcase` PINS the
// showcase package to the CLI's own version; unpinned, the spec degrades to the
// bare package name and `dlx` serves whatever it cached for that name once.
// Measured on 2026-08-13 with 0.38.0 installed: `gjsify showcase
// adwaita-storybook` — the first tab of the project's own home page — ran a
// cached 0.37.0 bundle and died on `ImportError: Unsupported URI scheme for
// importing: node`, a defect 0.38.0 had already fixed. The same commit under
// `npx`/`bunx` printed `[gjsify 0.38.0]` and worked, which is precisely why no
// CI leg saw it: every runtime CI exercises uses the `lib/` entry, and the one
// entry that is broken is the one a user installs.
//
// `cliVersion()` in `utils/publish-headers.ts` is the resolver: a compile-time
// define for the bundle, an upward manifest walk for `lib/`. It is depth-
// independent, so it cannot acquire this bug. Its own doc comment already said
// "deliberately NOT a fixed `../../package.json` read" — and a fourth copy grew
// beside it anyway. Prose does not fail a PR.
//
// FAILURE POLICY: hard. This reads first-party source that is always present;
// if the scan finds nothing to scan, that is itself an error, because a check
// that cannot find what it checks has stopped checking.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI_SRC = join(REPO_ROOT, 'packages/infra/cli/src');
const RESOLVER = 'utils/publish-headers.ts';

// `new URL(<anything ending in package.json>, import.meta.url)` — the shape that
// hard-codes a directory distance to the package root. Matched irrespective of
// how many `../` it walks, since the count is the part that is wrong.
const FIXED_DEPTH_READ = /new URL\(\s*(['"`])[^'"`]*package\.json\1\s*,\s*import\.meta\.url\s*\)/;

function walk(dir) {
    const out = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) out.push(...walk(full));
        else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) out.push(full);
    }
    return out;
}

let files;
try {
    files = walk(CLI_SRC);
} catch (err) {
    console.error(`check-cli-own-version-read: cannot scan ${CLI_SRC}: ${err.message}`);
    process.exit(1);
}

if (files.length === 0) {
    console.error(`check-cli-own-version-read: no sources under ${CLI_SRC} — the scan found nothing to check.`);
    process.exit(1);
}

// Blank out comment bodies while preserving line numbering: the rule this check
// enforces is precisely the kind a comment needs to QUOTE in order to explain
// itself, and a guard that fires on its own rationale trains people to delete
// the rationale.
function stripComments(text) {
    return text
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
        .replace(/(^|[^:])\/\/[^\n]*/g, (m, lead) => lead + ' '.repeat(m.length - lead.length));
}

const offenders = [];
for (const file of files) {
    const rel = relative(CLI_SRC, file);
    if (rel === RESOLVER) continue; // the resolver is the one allowed to know about layouts
    const text = stripComments(readFileSync(file, 'utf8'));
    text.split('\n').forEach((line, i) => {
        if (FIXED_DEPTH_READ.test(line)) {
            offenders.push(`packages/infra/cli/src/${rel}:${i + 1}: ${line.trim()}`);
        }
    });
}

if (offenders.length > 0) {
    console.error('check-cli-own-version-read: fixed-depth manifest read(s) in @gjsify/cli source:\n');
    for (const o of offenders) console.error(`  ${o}`);
    console.error(
        '\nThis resolves from `lib/` and misses from `dist/cli.gjs.mjs`, so a globally\n' +
            'installed gjsify reads no version — and `showcase` then leaves its dlx spec\n' +
            'unpinned, serving a cached older showcase.\n\n' +
            'Use the shared resolver instead:\n' +
            "  import { cliVersion } from '../utils/publish-headers.js';\n",
    );
    process.exit(1);
}

console.log(`check-cli-own-version-read: OK — ${files.length} CLI sources, no fixed-depth manifest reads.`);
