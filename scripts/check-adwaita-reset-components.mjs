#!/usr/bin/env node
// Every adwaita-web custom element is listed in the style-isolation reset.
//
// THE INCIDENT
//
// `$adw-components` in `packages/web/adwaita-web/scss/_reset.scss` is the list
// of custom-element tags the ADR-0010 boundary reset applies to: the rule that
// re-roots Adwaita typography and the box model at each widget boundary, so a
// host page's inherited `font-family` / `color` / `letter-spacing` and its
// `* { box-sizing }` reset stop there. A tag missing from the list gets no
// floor — it renders in the host's font, in the host's colour, and nothing
// fails. The list is hand-written; the truth is 58 `customElements.define`
// calls spread over 45 files, several of which define two or three tags.
//
// It had already drifted. `adw-source-view` (src/source-view/adw-source-view.ts)
// was defined for its whole life and never listed. The regression test ADR 0010
// points at as the guard — `src/style-isolation.spec.ts` — only ever
// instantiates `adw-switch-row`, so it proves the reset works for exactly one
// element and says nothing about the other 57. A per-element spec would be 58
// specs to forget to write; this compares the two lists instead.
//
// WHAT IT CHECKS, both directions
//
//   1. a `customElements.define('adw-…')` with no `$adw-components` entry  → FAIL
//      (the incident: the element silently loses the isolation floor)
//   2. an entry with no `define` behind it                                 → FAIL
//      (a stale entry, i.e. a renamed or deleted element whose selector now
//      matches nothing — harmless to render, but it is the list lying about
//      what exists, which is how (1) goes unnoticed)
//
// Plain Node over the repo's own files — no install, no build, no SCSS compile —
// so it runs in `audit-runtimes.yml` next to the other repo-scoped guards.
//
// Usage: node scripts/check-adwaita-reset-components.mjs [--root <dir>]

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const rootIndex = args.indexOf('--root');
const ROOT = rootIndex === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..') : args[rootIndex + 1];

const PACKAGE = join(ROOT, 'packages', 'web', 'adwaita-web');
const SRC = join(PACKAGE, 'src');
const RESET = join(PACKAGE, 'scss', '_reset.scss');

function fail(lines) {
    console.error(`check-adwaita-reset-components: ${lines.join('\n  ')}`);
    process.exit(1);
}

/** Every `.ts` under `src/`, recursively — elements live in `elements/` AND `source-view/`. */
function sourceFiles(dir) {
    const found = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) found.push(...sourceFiles(path));
        else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) found.push(path);
    }
    return found;
}

// `customElements.define('adw-foo', …)`. Both quote styles; the formatter uses
// single, but a matcher that only sees one is a matcher that misses a rename.
const DEFINE_PATTERN = /customElements\s*\.\s*define\(\s*['"](adw-[a-z0-9-]+)['"]/g;

/** tag → the file that defines it, so a failure can name the file to open. */
const defined = new Map();
for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(DEFINE_PATTERN)) {
        defined.set(match[1], relative(ROOT, file));
    }
}

if (defined.size === 0) {
    fail([
        `no customElements.define('adw-…') calls found under ${relative(ROOT, SRC)}.`,
        'Either the package moved or DEFINE_PATTERN stopped matching — a check that',
        'finds nothing passes vacuously, so this is a failure, not a pass.',
    ]);
}

let resetText;
try {
    resetText = readFileSync(RESET, 'utf8');
} catch (error) {
    fail([`cannot read ${relative(ROOT, RESET)}: ${error.message}`]);
}

// `$adw-components: adw-a, adw-b, …;` — one declaration, wrapped over many lines.
const declaration = /\$adw-components\s*:\s*([^;]+);/.exec(resetText);
if (declaration === null) {
    fail([`no \`$adw-components:\` declaration in ${relative(ROOT, RESET)}.`]);
}

const listed = new Set(
    declaration[1]
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
);

const problems = [];

const missing = [...defined.keys()].filter((tag) => !listed.has(tag)).sort();
if (missing.length > 0) {
    problems.push(
        `${missing.length} element(s) defined but NOT in $adw-components — they render without the ADR 0010 isolation floor:`,
        ...missing.map((tag) => `  ${tag}  (defined in ${defined.get(tag)})`),
        `  Fix: add them to \`$adw-components\` in ${relative(ROOT, RESET)}.`,
    );
}

const stale = [...listed].filter((tag) => !defined.has(tag)).sort();
if (stale.length > 0) {
    problems.push(
        `${stale.length} entry(s) in $adw-components with no customElements.define behind them:`,
        ...stale.map((tag) => `  ${tag}`),
        `  Fix: remove them from ${relative(ROOT, RESET)}, or restore the element that used to define them.`,
    );
}

if (problems.length > 0) fail(problems);

console.log(
    `check-adwaita-reset-components: OK — ${defined.size} custom elements, all listed in $adw-components (${relative(ROOT, RESET)}).`,
);
