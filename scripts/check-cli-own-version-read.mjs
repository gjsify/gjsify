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
// THE GATE ITSELF MISSED ONE, which is why it now keys on data flow rather than on
// a spelling. Its first version tested only
// `new URL('…package.json', import.meta.url)`, while `cli-app.ts` spelled the same
// defect as
//
//     const here = dirname(fileURLToPath(import.meta.url));
//     JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'))
//
// — no `new URL`, so this scan reported OK while `gjsify --version` answered
// `unknown` from every relocated bundle, the documented `GJSIFY_BOOTSTRAP` cache
// included (#1177). A guard that recognises one way of writing a defect certifies
// every other way.
//
// The rule is therefore: a manifest path built from the module's own location AND a
// LITERAL parent hop, however spelled. "Derived from `import.meta.url`" is NOT the
// rule and was measured to be wrong — `install.ts` binds `dir` from
// `import.meta.url` too and then CLIMBS until it finds a `@gjsify/cli` manifest,
// which is the depth-independent pattern this check wants people to use. What
// separates the defect from the cure is the fixed `'..'`, not the starting point.
// Flagging the derivation produced three false alarms on correct code, and a check
// with false alarms is worse than none — it gets deleted, and takes the real rule
// with it.
//
// FAILURE POLICY: hard. This reads first-party source that is always present;
// if the scan finds nothing to scan, that is itself an error, because a check
// that cannot find what it checks has stopped checking.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    TS_SOURCE_EXTENSIONS,
    sourceExtensionRe,
} from '../packages/infra/manifest-conformance/lib/source-extensions.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI_SRC = join(REPO_ROOT, 'packages/infra/cli/src');
const RESOLVER = 'utils/publish-headers.ts';

// `new URL(<anything ending in package.json>, import.meta.url)` — the shape that
// hard-codes a directory distance to the package root. Matched irrespective of
// how many `../` it walks, since the count is the part that is wrong.
const FIXED_DEPTH_READ = /new URL\(\s*(['"`])[^'"`]*package\.json\1\s*,\s*import\.meta\.url\s*\)/;

/** Anything that mentions a `package.json` path literal. */
const MANIFEST_LITERAL = /(['"`])[^'"`]*package\.json\1/;

/**
 * A LITERAL parent hop: `'..'` as its own path segment, or leading `../` inside a
 * path literal. This is the "counting directories" part — the half that breaks when
 * the same code ships from `lib/` and from `dist/`.
 */
const LITERAL_PARENT_HOP = /(['"`])\.\.\1|(['"`])(?:\.\.\/)+[^'"`]*\2/;

/**
 * `<decl> <name> = …import.meta.url…` — a binding carrying this module's own
 * location. Tracked within a short WINDOW above the read, not file-wide: names like
 * `dir` are reused across functions, and a file-wide set made three correct
 * upward-walk reads look like offenders.
 */
const BINDS_OWN_LOCATION = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=[^\n]*import\.meta\.url/;

/** How far above a manifest read a location binding still counts as feeding it. */
const BINDING_WINDOW = 4;

/**
 * Every TypeScript source under the CLI, specs aside.
 *
 * `.ts`-only was a live blind spot, not a hypothetical one: `packages/infra/cli/src/test.mts`
 * is tracked and was never opened, and the version read this check exists to hold is a
 * `.mts` file away from being unchecked.
 */
const SOURCE_RE = sourceExtensionRe(TS_SOURCE_EXTENSIONS);
const SPEC_RE = new RegExp(`\\.spec\\.(${TS_SOURCE_EXTENSIONS.join('|')})$`);

function walk(dir) {
    const out = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) out.push(...walk(full));
        else if (SOURCE_RE.test(entry) && !SPEC_RE.test(entry)) out.push(full);
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
    const lines = text.split('\n');

    /** Does a location binding sit within `BINDING_WINDOW` lines above `i`? */
    const boundNearby = (i) => {
        const names = [];
        for (let j = Math.max(0, i - BINDING_WINDOW); j < i; j++) {
            const bound = lines[j].match(BINDS_OWN_LOCATION);
            if (bound) names.push(bound[1]);
        }
        return names;
    };

    lines.forEach((line, i) => {
        if (!MANIFEST_LITERAL.test(line) && !FIXED_DEPTH_READ.test(line)) return;
        const at = `packages/infra/cli/src/${rel}:${i + 1}: ${line.trim()}`;

        // One statement, the original spelling: `new URL('…package.json',
        // import.meta.url)`. Fixed-depth even with zero `..` — a sibling read is a
        // distance too.
        if (FIXED_DEPTH_READ.test(line)) {
            offenders.push(at);
            return;
        }

        // Own location + a literal parent hop, in one statement or across two. The
        // hop is what makes it fixed; without it the code is climbing, which is the
        // pattern this check recommends.
        if (!LITERAL_PARENT_HOP.test(line)) return;
        if (/import\.meta\.url/.test(line) || boundNearby(i).some((n) => new RegExp(`\\b${n}\\b`).test(line))) {
            offenders.push(at);
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
