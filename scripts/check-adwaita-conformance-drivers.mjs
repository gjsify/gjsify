#!/usr/bin/env node
// Every conformance vector table is either driven by a RENDERER, or says why not.
//
// THE INCIDENT
//
// `@gjsify/adwaita-core/conformance` exists so a renderer that re-implements a
// derivation instead of delegating to core fails a unit test naming the input —
// which only works if a renderer actually drives the table. A census (#1072)
// found 43 tables driven by core alone, the derivation asserted against itself,
// 16 of them silent gaps rather than deliberate. Some core-only tables are
// legitimate (an intermediate step whose COMPOSED result is renderer-driven), so
// telling the two apart is the whole problem — and two headers here were found
// asserting coverage that did not exist, which reads as a reason not to look.
//
// WHAT IT CHECKS
//
// For every `export const *_VECTORS` in `conformance/`:
//   1. driven by at least one RENDERER suite            → pass
//   2. driven only by the core suite, and its own header (the docblock or the
//      section comment above it) carries a `CORE-ONLY:` line               → pass
//   3. driven only by the core suite with no such line                     → FAIL
//   4. driven by nothing at all                                            → FAIL
//   5. renderer-driven AND still carrying `CORE-ONLY:`                     → FAIL
//
// The `CORE-ONLY:` line belongs in the TABLE's own header, not a renderer's
// source: #1072 found three `TOOLBAR_VIEW_*` tables whose reason lived in both
// renderers and nowhere the table's reader would look.
//
// Usage: node scripts/check-adwaita-conformance-drivers.mjs [--root <dir>]

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const rootFlag = args.indexOf('--root');
const ROOT = rootFlag === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..') : args[rootFlag + 1];

const CONFORMANCE_DIR = join(ROOT, 'packages/web/adwaita-core/src/conformance');
/** Where the CORE drives its own tables. Not a renderer. */
const CORE_SUITE_DIR = join(ROOT, 'packages/web/adwaita-core/src');
/** The renderer suites — driving a table from one of these is the point. */
const RENDERER_DIRS = [
    join(ROOT, 'packages/web/adwaita-web/src'),
    join(ROOT, 'packages/nativescript-bridge/adwaita/src'),
];

/** The marker a core-only table must carry, in its own header. */
const CORE_ONLY_MARKER = 'CORE-ONLY:';

function walk(dir) {
    const out = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(path));
        else if (entry.name.endsWith('.ts')) out.push(path);
    }
    return out;
}

/**
 * Every exported vector table, with the text ABOVE its declaration — back to the
 * previous non-comment line, so the docblock plus any section banner, i.e.
 * exactly what a reader of the table sees.
 */
function tablesIn(file) {
    const source = readFileSync(file, 'utf8');
    const lines = source.split('\n');
    const found = [];
    for (const [index, line] of lines.entries()) {
        const match = /^export const ([A-Z0-9_]+_VECTORS)\b/.exec(line);
        if (!match) continue;
        let start = index - 1;
        while (
            start >= 0 &&
            (lines[start].trim().startsWith('*') ||
                lines[start].trim().startsWith('/') ||
                lines[start].trim().startsWith('//'))
        ) {
            start--;
        }
        found.push({ name: match[1], header: lines.slice(start + 1, index).join('\n'), file });
    }
    return found;
}

/** Which of `names` appear anywhere under `dirs`, excluding the tables' own file. */
function consumersUnder(dirs, names) {
    const seen = new Map(names.map((name) => [name, false]));
    for (const dir of dirs) {
        for (const file of walk(dir)) {
            if (file.startsWith(CONFORMANCE_DIR)) continue;
            const source = readFileSync(file, 'utf8');
            for (const name of names) {
                if (seen.get(name)) continue;
                // Word-boundary, so `FOO_VECTORS` does not match `FOO_VECTORS_2`.
                if (new RegExp(`\\b${name}\\b`).test(source)) seen.set(name, true);
            }
        }
    }
    return seen;
}

const tables = walk(CONFORMANCE_DIR).flatMap(tablesIn);
if (tables.length === 0) {
    console.error('check-adwaita-conformance-drivers: found no vector tables — the scan is broken.');
    process.exit(1);
}

const names = tables.map((table) => table.name);
const byRenderer = consumersUnder(RENDERER_DIRS, names);
const byCore = consumersUnder([CORE_SUITE_DIR], names);

const failures = [];
for (const table of tables) {
    const where = `${relative(ROOT, table.file)} → ${table.name}`;
    if (byRenderer.get(table.name)) {
        // The exemption is a claim about TODAY. Without this direction it only ever
        // ratchets one way: a table that gains a driver keeps its excuse forever, and
        // the next reader takes "CORE-ONLY" for the current state of the port.
        if (table.header.includes(CORE_ONLY_MARKER)) {
            failures.push(`${where}: renderer-driven, but still carries "${CORE_ONLY_MARKER}" — it landed, drop the marker.`);
        }
        continue;
    }
    if (!byCore.get(table.name)) {
        failures.push(`${where}: driven by NOTHING — not even the core suite.`);
        continue;
    }
    if (!table.header.includes(CORE_ONLY_MARKER)) {
        failures.push(
            `${where}: driven only by the core suite. Either drive it from a renderer, or state why not ` +
                `with a "${CORE_ONLY_MARKER} <reason>" line in the table's own header.`,
        );
    }
}

if (failures.length > 0) {
    console.error(`check-adwaita-conformance-drivers: ${failures.length} table(s) need attention:\n`);
    for (const failure of failures) console.error(`  - ${failure}`);
    console.error(
        `\nA table with no renderer behind it asserts a derivation against itself. That is sometimes right —\n` +
            `an intermediate step whose composed result IS renderer-driven — and sometimes a silent gap. The\n` +
            `marker is what tells a reader which, in the place they are already looking.`,
    );
    process.exit(1);
}

console.log(`check-adwaita-conformance-drivers: ${tables.length} vector tables, every one driven or explained.`);
