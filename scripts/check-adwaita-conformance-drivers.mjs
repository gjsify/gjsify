#!/usr/bin/env node
// Every conformance vector table is either driven by a RENDERER, or says why not —
// and the why-not is READ, not just counted.
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
// THE SECOND INCIDENT
//
// The first version of this gate tested that the literal `CORE-ONLY:` appeared in
// the header and stopped there. THREE false coverage claims then landed in the
// very PR that built it, and it passed all three: `SIDEBAR_BOUNDS_VECTORS` and
// `ABOUT_DIALOG_CREDITS_LEGAL_VECTORS` were each called driven by "both
// renderers" when only adwaita-web drives them (NativeScript drives a DIFFERENT
// table, `SIDEBAR_WIDTH_VECTORS`, and has no about-dialog spec at all), and
// `adw-data-grid.ts` said "Both ports are held to DATA_GRID_*_VECTORS" while
// adwaita-web drove none of the six. A reason left outside the check is prose,
// and prose that says "covered" is worse than no reason at all.
//
// WHAT IT CHECKS
//
// TABLE arm — for every `export const *_VECTORS` in `conformance/`:
//   1. driven by at least one RENDERER suite            → pass
//   2. driven only by the core suite, and its own header (the docblock or the
//      section comment above it) carries a `CORE-ONLY:` line               → pass
//   3. driven only by the core suite with no such line                     → FAIL
//   4. driven by nothing at all                                            → FAIL
//   5. renderer-driven AND still carrying `CORE-ONLY:`                     → FAIL
//
// CLAIM arm — every comment SENTENCE in the core or either renderer that names a
// vector table is resolved against reality:
//   6. a name, `PREFIX_*` glob or `A/B_VECTORS` pair that matches no declared
//      table                                                               → FAIL
//   7. a counted citation ("the five OVERLAY_SWIPE_* tables") whose count is
//      wrong. `OVERLAY_SWIPE_*` IS five real tables, so the arity is the whole
//      question: a checker that rejected globs would reject a true sentence  → FAIL
//   8. "both renderers / both ports / both drive" over tables one renderer
//      does not drive                                                      → FAIL
//   9. "the browser suite" / "the NativeScript suite" over tables THAT suite
//      does not drive                                                      → FAIL
//  10. a `CORE-ONLY:` reason citing a table as its coverage, where no chain of
//      citations from it reaches a renderer-driven table                   → FAIL
//
// A citation is exempt from 10 when the sentence spells a PRECEDENT ("same as X")
// rather than coverage: `TOOLBAR_VIEW_MEASURE_VECTORS` says its reason is the one
// `TOOLBAR_VIEW_ALLOCATE_VECTORS` gives, which is not a claim that ALLOCATE covers
// it. A checker that cannot tell those apart reports a true sentence as false.
//
// MODULE arm — the table arm is TABLE-keyed, so core behaviour with no table at
// all is invisible to it. Every module in `adwaita-core/src` therefore needs a
// conformance file of its own, a conformance file that imports it, or an entry in
// MODULE_REASONS below — itself checked, against the declared tables and against
// the open-item ledger.
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

/** Where the CORE drives its own tables. Not a renderer. */
const CORE_SUITE_DIR = join(ROOT, 'packages/web/adwaita-core/src');
const CONFORMANCE_DIR = join(CORE_SUITE_DIR, 'conformance');
/** The renderer suites — driving a table from one of these is the point. */
const RENDERERS = [
    { label: 'adwaita-web', dir: join(ROOT, 'packages/web/adwaita-web/src') },
    { label: 'nativescript', dir: join(ROOT, 'packages/nativescript-bridge/adwaita/src') },
];
const OPEN_TODOS = join(ROOT, 'status/open-todos.md');

/** The marker a core-only table must carry, in its own header. */
const CORE_ONLY_MARKER = 'CORE-ONLY:';

/** The open-item heading the four table-less core modules are ledgered under. */
const NO_TABLE_LEDGER = 'Four adwaita-core modules have no conformance vector table';

/**
 * Core modules with no conformance file named after them and no conformance file
 * importing them. `table` — its vectors live in another file under that name;
 * `gap` — no vector table exists, and the named `###` heading must be an open item
 * in `status/open-todos.md`, so the gap has a place to be closed from.
 */
const MODULE_REASONS = {
    breakpoint: { gap: NO_TABLE_LEDGER },
    'color-scheme': { gap: NO_TABLE_LEDGER },
    easing: { table: 'SPINNER_ARC_PHASE_VECTORS' },
    glib: { table: 'GLIB_CLAMP_VECTORS' },
    scrolling: { gap: NO_TABLE_LEDGER },
    toast: { gap: NO_TABLE_LEDGER },
};

/** `PREFIX_*[_VECTORS]` glob | `A/B_VECTORS` pair | a plain table name. */
const CITATION =
    /\b([A-Z][A-Z0-9_]*_)\*(?:_VECTORS)?|\b([A-Z][A-Z0-9_]*)\/([A-Z][A-Z0-9_]*_VECTORS)|\b[A-Z][A-Z0-9_]*_VECTORS\b/g;
/** "for the same reason as X" — cites X as a precedent, not as coverage. */
const PRECEDENT = /\bsame (?:as|reason as|rule as|gap as)\b/i;
/**
 * Three spellings OCCUR — "both renderers", "both drive", "Both ports" — and two of the three
 * false claims used the rarer two, so a checker that knows one spelling misses most of them.
 * "both sides" and "the two ports" say the same thing and are matched pre-emptively.
 */
const BOTH_CLAIM =
    /\bboth\s+(?:renderer\s+suites?|renderers?|ports?|suites?|elements?|sides|drive)\b|\bthe two (?:renderers?|ports?|suites?)\b/i;
/** A named renderer plus a coverage verb — "driven by the browser suite", "NativeScript drives X". */
const SUITE_CLAIMS = [
    { label: 'adwaita-web', pattern: /\b(?:browser|adwaita-web)\b/i },
    { label: 'nativescript', pattern: /\bNativeScript\b/i },
];
const COVERAGE_VERB = /\b(?:suite|drives?|driven by|held to|asserts)\b/i;
const COUNT_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

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
        while (start >= 0 && /^\s*(\*|\/)/.test(lines[start])) start--;
        found.push({ name: match[1], header: lines.slice(start + 1, index).join('\n'), file, line: index + 1 });
    }
    return found;
}

/** Which of `names` appear anywhere under `dir`, excluding the tables' own file. */
function consumersUnder(dir, names) {
    const seen = new Set();
    for (const file of walk(dir)) {
        if (file.startsWith(CONFORMANCE_DIR)) continue;
        const source = readFileSync(file, 'utf8');
        for (const name of names) {
            // Word-boundary, so `FOO_VECTORS` does not match `FOO_VECTORS_2`.
            if (!seen.has(name) && new RegExp(`\\b${name}\\b`).test(source)) seen.add(name);
        }
    }
    return seen;
}

/** Contiguous runs of comment lines, marker-stripped and joined — one prose block each. */
function commentBlocks(file) {
    const lines = readFileSync(file, 'utf8').split('\n');
    const blocks = [];
    let current = null;
    for (const [index, line] of lines.entries()) {
        const trimmed = line.trim();
        if (!/^(\/\/|\/\*|\*)/.test(trimmed)) {
            current = null;
            continue;
        }
        const text = trimmed
            .replace(/^\/\*+|^\/\/+|^\*+\/?/, '')
            .replace(/\*\/$/, '')
            .trim();
        if (current) {
            current.text += ` ${text}`;
            current.segments.push({ line: index + 1, text });
        } else {
            blocks.push((current = { file, line: index + 1, text, segments: [{ line: index + 1, text }] }));
        }
    }
    return blocks;
}

/** The source line a citation sits on — a 50-line header is not an address. */
const lineOf = (block, spelling) => block.segments.find((segment) => segment.text.includes(spelling))?.line ?? block.line;

/** Split on sentence ends only where a new sentence plausibly starts — `adw-tab-view.ts` must not split. */
const sentencesIn = (text) => text.split(/(?<=\.)\s+(?=[A-Z`(])/);

/**
 * The tables a citation names. `missing` is what the spelling promised and the tree
 * does not have; for a glob an empty `names` IS the miss.
 */
function citationsIn(text, declared) {
    const found = [];
    for (const match of text.matchAll(CITATION)) {
        const [spelling, globPrefix, pairHead, pairTail] = match;
        if (globPrefix) {
            found.push({
                spelling,
                kind: 'glob',
                index: match.index,
                names: [...declared].filter((name) => name.startsWith(globPrefix)),
                missing: [],
            });
        } else if (pairHead) {
            const shared = pairHead.slice(0, pairHead.lastIndexOf('_') + 1);
            const expanded = [`${pairHead}_VECTORS`, `${shared}${pairTail}`];
            found.push({
                spelling,
                kind: 'pair',
                index: match.index,
                names: expanded.filter((name) => declared.has(name)),
                missing: expanded.filter((name) => !declared.has(name)),
            });
        } else {
            const known = declared.has(spelling);
            found.push({
                spelling,
                kind: 'name',
                index: match.index,
                names: known ? [spelling] : [],
                missing: known ? [] : [spelling],
            });
        }
    }
    return found;
}

/**
 * The count word immediately before a citation, if the sentence states one. Digits count only
 * for a glob: before a single name, "at 96 dpi ADW_LENGTH_UNIT_VECTORS" is arithmetic and not
 * arity, and reading it as arity is how a checker invents findings.
 */
function statedCount(sentence, index, kind) {
    const before = sentence.slice(0, index).replace(/[`'"\s]+$/, '');
    const word = /([A-Za-z]+|\d+)$/.exec(before)?.[1];
    if (!word) return undefined;
    if (/^\d+$/.test(word)) return kind === 'glob' ? Number(word) : undefined;
    const spelled = COUNT_WORDS.indexOf(word.toLowerCase());
    return spelled === -1 ? undefined : spelled;
}

const tables = walk(CONFORMANCE_DIR).flatMap(tablesIn);
if (tables.length === 0) {
    console.error('check-adwaita-conformance-drivers: found no vector tables — the scan is broken.');
    process.exit(1);
}

const names = tables.map((table) => table.name);
const declared = new Set(names);
const byLabel = new Map(RENDERERS.map(({ label, dir }) => [label, consumersUnder(dir, names)]));
const byRenderer = new Set([...byLabel.values()].flatMap((set) => [...set]));
const byCore = consumersUnder(CORE_SUITE_DIR, names);

/** The `CORE-ONLY:` reason a table carries, as one line. */
const reasons = new Map();
for (const table of tables) {
    const lines = table.header.split('\n');
    const start = lines.findIndex((line) => line.includes(CORE_ONLY_MARKER));
    if (start === -1) continue;
    const text = lines
        .slice(start)
        .map((line) => line.trim().replace(/^\/\/+|^\*+\/?/, ''))
        .join(' ')
        .replace(/\*\/\s*$/, '')
        .replace(/\s+/g, ' ')
        .trim();
    reasons.set(table.name, text);
}

/**
 * Does the exemption chain from `name` end at a table a renderer actually drives?
 * One hop is the common case (an intermediate step naming its composed result); the
 * about-dialog licence tables are three hops deep, and a chain that only ever cites
 * other exempt tables is the shape this arm exists to reject.
 */
function reachesADriver(name, seen = new Set()) {
    if (byRenderer.has(name)) return true;
    if (seen.has(name)) return false;
    seen.add(name);
    const reason = reasons.get(name);
    if (!reason) return false;
    for (const citation of citationsIn(reason, declared)) {
        for (const cited of citation.names) {
            if (cited !== name && reachesADriver(cited, seen)) return true;
        }
    }
    return false;
}

const failures = [];
/** What each arm actually resolved. A gate that reports only "green" cannot show it ran. */
const resolved = { chains: 0, citations: 0, both: 0, suite: 0, counted: 0, exempted: 0 };
for (const table of tables) {
    const where = `${relative(ROOT, table.file)}:${table.line} → ${table.name}`;
    if (byRenderer.has(table.name)) {
        // The exemption is a claim about TODAY. Without this direction it only ever
        // ratchets one way: a table that gains a driver keeps its excuse forever, and
        // the next reader takes "CORE-ONLY" for the current state of the port.
        if (reasons.has(table.name)) {
            failures.push(`${where}: renderer-driven, but still carries "${CORE_ONLY_MARKER}" — it landed, drop the marker.`);
        }
        continue;
    }
    if (!byCore.has(table.name)) {
        failures.push(`${where}: driven by NOTHING — not even the core suite.`);
        continue;
    }
    const reason = reasons.get(table.name);
    if (reason === undefined) {
        failures.push(
            `${where}: driven only by the core suite. Either drive it from a renderer, or state why not ` +
                `with a "${CORE_ONLY_MARKER} <reason>" line in the table's own header.`,
        );
        continue;
    }
    resolved.exempted += 1;
    for (const sentence of sentencesIn(reason)) {
        if (PRECEDENT.test(sentence)) continue;
        const cited = citationsIn(sentence, declared).flatMap((citation) => citation.names);
        for (const name of cited) {
            if (name === table.name) continue;
            resolved.chains += 1;
            if (reachesADriver(name)) continue;
            failures.push(
                `${where}: its reason cites ${name} as the coverage that makes this table redundant, but ` +
                    `no chain of citations from ${name} reaches a table any renderer drives.`,
            );
        }
    }
}

// The CLAIM arm runs over the whole surface, not just table headers: two of the three
// false claims #1072 shipped were in prose ABOUT a table rather than above one, and
// `adw-data-grid.ts` put its "Both ports" a renderer-tree away from any conformance file.
for (const dir of [CORE_SUITE_DIR, ...RENDERERS.map((renderer) => renderer.dir)]) {
    for (const block of walk(dir).flatMap(commentBlocks)) {
        for (const sentence of sentencesIn(block.text)) {
            const citations = citationsIn(sentence, declared);
            if (citations.length === 0) continue;
            for (const citation of citations) {
                const where = `${relative(ROOT, block.file)}:${lineOf(block, citation.spelling)}`;
                resolved.citations += 1;
                for (const name of citation.missing) {
                    failures.push(`${where}: names ${name}, which no conformance file declares.`);
                }
                if (citation.kind === 'glob' && citation.names.length === 0) {
                    failures.push(`${where}: the glob ${citation.spelling} matches no declared table.`);
                    continue;
                }
                const stated = statedCount(sentence, citation.index, citation.kind);
                if (stated !== undefined) {
                    resolved.counted += 1;
                    if (stated !== citation.names.length) {
                        failures.push(
                            `${where}: says ${stated} ${citation.spelling} table(s); the tree declares ${citation.names.length}.`,
                        );
                    }
                }
                if (citation.names.length === 0) continue;
                if (BOTH_CLAIM.test(sentence)) {
                    resolved.both += 1;
                    for (const { label } of RENDERERS) {
                        const undriven = citation.names.filter((name) => !byLabel.get(label).has(name));
                        if (undriven.length > 0) {
                            failures.push(
                                `${where}: claims BOTH renderers cover ${citation.spelling}, but ${label} drives ` +
                                    `none of ${undriven.join(', ')}.`,
                            );
                        }
                    }
                }
                for (const { label, pattern } of SUITE_CLAIMS) {
                    if (!pattern.test(sentence) || !COVERAGE_VERB.test(sentence)) continue;
                    resolved.suite += 1;
                    const undriven = citation.names.filter((name) => !byLabel.get(label).has(name));
                    if (undriven.length > 0) {
                        failures.push(`${where}: credits the ${label} suite with ${undriven.join(', ')}, which it does not drive.`);
                    }
                }
            }
        }
    }
}

// MODULE arm. Everything above is keyed by TABLE, so a core module with no table is
// not under-covered by this gate — it is INVISIBLE to it. `breakpoint`, `color-scheme`,
// `scrolling` and `toast` had no vector table at all, three of them named in
// packages/web/AGENTS.md as the core's flagship shared behaviour, and the ledger that
// reported "156 tables, every one driven or explained" said nothing about any of them.
const conformanceSource = walk(CONFORMANCE_DIR)
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');
const openTodos = readFileSync(OPEN_TODOS, 'utf8');

for (const entry of readdirSync(CORE_SUITE_DIR, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.ts') || entry.name.endsWith('.spec.ts')) continue;
    const module = entry.name.slice(0, -3);
    if (module === 'index') continue;
    const where = `packages/web/adwaita-core/src/${entry.name}`;
    const covered =
        walk(CONFORMANCE_DIR).some((file) => file.endsWith(`/${entry.name}`)) ||
        conformanceSource.includes(`from '../${module}.js'`);
    const reason = MODULE_REASONS[module];
    if (covered) {
        if (reason) failures.push(`${where}: listed in MODULE_REASONS, but conformance covers it now — drop the entry.`);
        continue;
    }
    if (!reason) {
        failures.push(
            `${where}: no conformance file names or imports it, so no renderer is held to any of its ` +
                `behaviour. Add vectors for it, or a MODULE_REASONS entry saying which table carries them.`,
        );
    } else if (reason.table && !declared.has(reason.table)) {
        failures.push(`${where}: MODULE_REASONS points at ${reason.table}, which no conformance file declares.`);
    } else if (reason.gap && !openTodos.includes(`### ${reason.gap}`)) {
        failures.push(`${where}: MODULE_REASONS calls this a gap under "${reason.gap}", which is not an open item.`);
    }
}

if (failures.length > 0) {
    console.error(`check-adwaita-conformance-drivers: ${failures.length} finding(s):\n`);
    for (const failure of [...new Set(failures)]) console.error(`  - ${failure}`);
    console.error(
        `\nA table with no renderer behind it asserts a derivation against itself. That is sometimes right —\n` +
            `an intermediate step whose composed result IS renderer-driven — and sometimes a silent gap. The\n` +
            `marker is what tells a reader which, in the place they are already looking — so the marker's own\n` +
            `reason is resolved against the tree, because a false "both renderers drive it" reads as a reason\n` +
            `not to look.`,
    );
    process.exit(1);
}

console.log(
    `check-adwaita-conformance-drivers: ${tables.length} vector tables, ${resolved.exempted} core-only. ` +
        `Resolved ${resolved.citations} citation(s): ${resolved.chains} coverage chain(s), ${resolved.both} ` +
        `both-renderer claim(s), ${resolved.suite} single-suite claim(s), ${resolved.counted} counted glob(s).`,
);
