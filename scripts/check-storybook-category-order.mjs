#!/usr/bin/env node
// Every storybook category is placed by the declaration, not by an enumeration.
//
// WHAT THIS REPLACES
//
// The sidebar's category order used to be whatever order each target happened to
// enumerate its stories in, and the three targets enumerate differently: the GTK
// and NativeScript storybooks take a path glob (alphabetical by
// `<category-dir>/<file>`), the browser target a hand-written import list. The
// only thing holding them together was a sentence in the browser list saying it
// "mirrors the native sidebar's category order" — which it did not. `Overview`
// led the browser sidebar and sat FIFTH, below the fold, on the native one, and
// that reads as the overview being MISSING rather than as an ordering
// difference. That is how it was reported.
//
// STORYBOOK_CATEGORY_ORDER now owns the order for all three (they share a
// StorybookController). A declaration is only worth more than the comment it
// replaces if something checks it, so:
//
// WHAT IT CHECKS
//
//   1. Every category a story actually carries is named in the declaration.
//      An unlisted category still renders — it sorts after the listed ones —
//      so without this check a new category would silently land at the end.
//   2. The declaration names no category that no story carries, so a renamed
//      or deleted category cannot leave a stale entry behind that looks like
//      it is doing something.
//   3. The declaration has no duplicates (a second entry can never be reached).
//
// It reads the categories out of the `title:` of each renderer-agnostic
// `*.meta.ts` — the same single source the three renderings share — rather than
// out of any one target's list, because a per-target list is precisely what
// stopped being authoritative.
//
// Plain Node over the repo's own files — no install, no build — so it runs in
// `audit-runtimes.yml` next to the other repo-scoped guards.
//
// Usage: node scripts/check-storybook-category-order.mjs [--root <dir>]

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { adwaitaStoryMetas } from './adwaita-elements.mjs';

const args = process.argv.slice(2);
const rootFlag = args.indexOf('--root');
const ROOT = rootFlag === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..') : args[rootFlag + 1];

/** Where the order is declared — posix-spelled, because failures PRINT it. */
const ORDER_SRC = 'packages/framework/storybook-core/src/category-order.ts';

const declared = [];
{
    const source = readFileSync(join(ROOT, ORDER_SRC), 'utf8');
    const block = source.match(/STORYBOOK_CATEGORY_ORDER[^=]*=\s*\[([^\]]*)\]/);
    if (!block) {
        console.error(`check-storybook-category-order: no STORYBOOK_CATEGORY_ORDER array in ${ORDER_SRC}.`);
        process.exit(1);
    }
    for (const match of block[1].matchAll(/'([^']+)'/g)) declared.push(match[1]);
}

const used = new Map(); // category -> the meta file that first carried it
try {
    for (const meta of adwaitaStoryMetas(ROOT).values()) {
        for (const title of meta.titles) {
            const category = title.split('/')[0];
            if (!used.has(category)) used.set(category, meta.file);
        }
    }
} catch (error) {
    // The reader throws on a vacuous scan by design; catch to keep this script's prefix.
    console.error(`check-storybook-category-order: ${error.message}`);
    process.exit(1);
}

if (used.size === 0) {
    console.error('check-storybook-category-order: found no story titles — the scan is broken, not the showcases.');
    process.exit(1);
}
if (declared.length === 0) {
    console.error('check-storybook-category-order: the declaration is empty — every category would sort as unlisted.');
    process.exit(1);
}

const failures = [];

const unlisted = [...used.keys()].filter((name) => !declared.includes(name)).sort();
for (const name of unlisted) {
    failures.push(
        `"${name}" is carried by ${used.get(name)} but is not in STORYBOOK_CATEGORY_ORDER — ` +
            'it would render last on every target, in whatever order discovery happened to hand it over.',
    );
}

const stale = declared.filter((name) => !used.has(name)).sort();
for (const name of stale) {
    failures.push(`"${name}" is declared but no story carries it — a stale entry that looks like it places something.`);
}

const seen = new Set();
for (const name of declared) {
    if (seen.has(name)) failures.push(`"${name}" is declared twice; the second entry can never be reached.`);
    seen.add(name);
}

if (failures.length > 0) {
    console.error(`check-storybook-category-order: ${failures.length} problem(s):\n`);
    for (const failure of failures) console.error(`  - ${failure}`);
    console.error(
        `\nThe order is what a reader meets first, and it used to differ per target while a comment said\n` +
            `it did not. Declare the category in ${ORDER_SRC} rather than letting\n` +
            `enumeration decide where it lands.`,
    );
    process.exit(1);
}

console.log(
    `check-storybook-category-order: ${declared.length} categories declared, ` +
        `all ${used.size} in use placed — leading with "${declared[0]}".`,
);
