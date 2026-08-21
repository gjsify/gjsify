#!/usr/bin/env node
// Every adwaita-web spec on disk RUNS.
//
// THE INCIDENT
//
// `src/test.browser.mts` is a hand-written list, and nothing held it. Deleting one name
// from the `run({ … })` literal — leaving the import in place, so no linter and no type
// check says a word — took the whole `connect-lifecycle` spec out of the suite, which
// then reported green with a smaller total and no warning anywhere. A spec file can
// therefore sit in `src/` forever and never execute, which is the one failure a test
// suite cannot report about itself: the number it prints is the number it ran.
//
// adwaita-web is the package where the rule is unconditional: its subjects are custom
// elements, so every one of its specs needs a DOM and the browser leg is the only leg it
// has. That is why this is scoped here rather than written as a repo-wide policy —
// elsewhere `test.browser.mts` is deliberately a DIFFERENT, browser-specific set
// (`packages/node/path` imports `./test.mjs` whole; adwaita-core keeps three headless
// specs out of its browser entry on purpose).
//
// WHAT IT CHECKS, per spec file under `packages/web/adwaita-web/src`
//
//   1. `test.browser.mts` imports it                        → else it cannot run
//   2. every binding that import brings in appears inside the `run({ … })` literal
//      → an import alone is what the deletion above left behind
//
// The symbol is READ from the import clause rather than guessed from the filename, so
// renaming an export is not a way to leave the suite quietly.
//
// Usage: node scripts/check-adwaita-web-specs-run.mjs [--root <dir>]

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ADWAITA_WEB_SRC } from './adwaita-elements.mjs';

const args = process.argv.slice(2);
const rootIndex = args.indexOf('--root');
const ROOT = rootIndex === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..') : args[rootIndex + 1];

function fail(lines) {
    console.error(`check-adwaita-web-specs-run: ${lines.join('\n  ')}`);
    process.exit(1);
}

/** Every `*.spec.ts` under `dir`, as paths relative to it — specs live in subdirectories too. */
function specFiles(dir, base = dir) {
    const found = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules') continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) found.push(...specFiles(path, base));
        else if (entry.name.endsWith('.spec.ts')) found.push(relative(base, path));
    }
    return found.sort();
}

const src = join(ROOT, ADWAITA_WEB_SRC);
const entry = join(src, 'test.browser.mts');
let text;
try {
    text = readFileSync(entry, 'utf8');
} catch (error) {
    fail([`cannot read ${relative(ROOT, entry)}: ${error.message}`]);
}

// The object literal `run` is called with — the only place a name actually enrols a
// spec. Matched to the first `}` at column zero, which is where this file's single
// `run({ … })` call ends.
const called = /\brun\(\{([\s\S]*?)\n\}/.exec(text);
if (called === null) {
    fail([
        `no \`run({ … })\` call in ${relative(ROOT, entry)}. Either the entry point changed shape or ` +
            'this reader stopped matching — a scan that finds nothing passes vacuously, so this is ' +
            'a failure, not a pass.',
    ]);
}
const enrolled = new Set(called[1].match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []);

/** `./x.spec.js` → the bindings that import brings in. */
const imported = new Map();
for (const [, clause, spec] of text.matchAll(/\bimport\s+\{([^}]*)\}\s*from\s*'([^']+)'/g)) {
    const names = clause
        .split(',')
        .map((name) =>
            name
                .trim()
                .split(/\s+as\s+/)
                .pop(),
        )
        .filter((name) => name !== '');
    imported.set(spec, names);
}

const specs = specFiles(src);
if (specs.length === 0) {
    fail([
        `no *.spec.ts under ${ADWAITA_WEB_SRC} — either the package moved or this reader stopped ` +
            'matching, and a scan with nothing in scope passes vacuously.',
    ]);
}

const problems = [];
for (const file of specs) {
    const specifier = `./${file.replaceAll('\\', '/').replace(/\.ts$/, '.js')}`;
    const names = imported.get(specifier);
    if (names === undefined) {
        problems.push(
            `${ADWAITA_WEB_SRC}/${file} is imported by no \`import { … } from '${specifier}'\` in ` +
                'test.browser.mts, so it never runs. Every adwaita-web spec drives custom elements, ' +
                'and the browser leg is the only leg they have.',
        );
        continue;
    }
    const missing = names.filter((name) => !enrolled.has(name));
    if (missing.length > 0) {
        problems.push(
            `${ADWAITA_WEB_SRC}/${file} exports ${missing.join(' + ')}, which test.browser.mts imports ` +
                'but does not pass to `run({ … })`. The import alone compiles, lints and type-checks, ' +
                'and the suite goes green having run none of it.',
        );
    }
}

if (problems.length > 0) fail(problems);

console.log(`check-adwaita-web-specs-run: OK — all ${specs.length} adwaita-web spec files are enrolled in run().`);
