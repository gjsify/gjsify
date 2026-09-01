#!/usr/bin/env node
// Every adwaita-web custom element is listed in the style-isolation reset.
//
// THE INCIDENT
//
// `$adw-components` in `packages/web/adwaita-web/scss/_reset.scss` is the list of
// custom-element tags the ADR-0010 boundary reset applies to: it re-roots Adwaita
// typography and the box model at each widget boundary, so a host page's inherited
// `font-family`/`color`/`letter-spacing` and its `* { box-sizing }` reset stop
// there. A tag missing from the list gets no floor — it renders in the host's font
// and colour, and nothing fails. The list is hand-written; the truth is the defines
// `scripts/adwaita-elements.mjs` reads.
//
// It had already drifted: `adw-source-view` was defined for its whole life and
// never listed. The regression test ADR 0010 points at as the guard,
// `src/style-isolation.spec.ts`, instantiates only `adw-switch-row` — so it proves
// the reset for exactly one element. A per-element spec would be one more spec per
// element to forget; this compares the two lists instead.
//
// WHAT IT CHECKS, both directions
//
//   1. a `customElements.define(…)` with no `$adw-components` entry        → FAIL
//      (the incident: the element silently loses the isolation floor)
//   2. an entry with no `define` behind it                                 → FAIL
//      (a renamed or deleted element whose selector now matches nothing —
//      harmless to render, but it is the list lying about what exists, which is
//      how (1) goes unnoticed)
//
// Usage: node scripts/check-adwaita-reset-components.mjs [--root <dir>]

import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { adwaitaWebElements } from './adwaita-elements.mjs';

const args = process.argv.slice(2);
const rootIndex = args.indexOf('--root');
const ROOT = rootIndex === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..') : args[rootIndex + 1];

const RESET = join(ROOT, 'packages', 'web', 'adwaita-web', 'scss', '_reset.scss');

function fail(lines) {
    console.error(`check-adwaita-reset-components: ${lines.join('\n  ')}`);
    process.exit(1);
}

/** tag → the file that defines it, so a failure can name the file to open. */
let defined;
try {
    defined = adwaitaWebElements(ROOT);
} catch (error) {
    // The reader throws on a vacuous scan by design; catch to keep this script's prefix.
    fail([error.message]);
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
