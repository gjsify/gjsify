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
// "Driven" means a renderer's `*.spec.ts` names the table OUTSIDE a comment. Both
// halves were bought: this branch's own corrective comment spelled five table names
// out in a renderer file, and thereby made the gate read them as browser-driven.
//
// CLAIM arm — every comment CLAUSE in the core or either renderer that names a
// vector table is resolved against reality. The clause, not the sentence: "only
// NativeScript drives X" and "…, unlike Y, which stays core-only" are how English
// states single-renderer coverage, and both were rejected as false claims.
//   6. a `*_VECTORS` name or `A/B_VECTORS` pair that matches no declared table → FAIL
//      (a `PREFIX_*` glob expanding to nothing is NOT a citation — these trees
//      are ports of C and cite upstream enum families the same way)
//   7. a counted citation ("the five OVERLAY_SWIPE_* tables") whose count is
//      wrong. `OVERLAY_SWIPE_*` IS five real tables, so the arity is the whole
//      question: a checker that rejected globs would reject a true sentence  → FAIL
//   8. "both renderers / both ports / both drive" over tables one renderer
//      does not drive                                                      → FAIL
//   9. "the browser suite" / "the NativeScript suite" over tables THAT suite
//      does not drive                                                      → FAIL
//  10. a `CORE-ONLY:` reason citing a table as its coverage, where no chain of
//      citations from it reaches a renderer-driven table                   → FAIL
//  11. a `CORE-ONLY:` reason that names no table and is not a ledgered GAP  → FAIL
//
// 10 reads only citations whose own clause is PHRASED as coverage. A reason cites a
// table for other reasons too — as a precedent (`TOOLBAR_VIEW_MEASURE_VECTORS` says
// its reason is the one `TOOLBAR_VIEW_ALLOCATE_VECTORS` gives, which is not a claim
// that ALLOCATE covers it), as a concession, as a contrast. Precedents are not left
// unchecked by that: the cited table is a table, so the TABLE arm holds its header.
//
// 11 is what makes an exemption falsifiable at all. Without it the cheapest way to
// write one is to name nothing — `CORE-ONLY: both renderers exercise this already
// through their real widgets` passed every other arm, because they all key off a
// citation. Three of the 43 exemptions were that shape.
//
// MODULE arm — the table arm is TABLE-keyed, so core behaviour with no table at
// all is invisible to it. Every module under `adwaita-core/src` that exports
// behaviour therefore needs a conformance file of its own, a conformance file that
// imports it FOR VALUE, or an entry in MODULE_REASONS below — itself checked,
// against the declared tables, against whether a renderer drives them, and against
// the open-item ledger.
//
// WHAT IT DOES NOT CHECK: "driven" is a name used outside a comment in a spec, so a
// spec that imports a table and filters the interesting rows away still counts as
// driving it. Six tables are referenced only through a `.filter(` today. Measured
// and ledgered under "A table can be 'driven' while the rows that matter are
// skipped" rather than half-guarded: the `.filter(` form is mechanical, the
// `continue`-guard form beside it is not, and a rule that catches two shapes of a
// three-shape class reads as covering the class.
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

/**
 * The open-item headings a module-level gap is ledgered under. Count-free ON PURPOSE: the
 * first spelling was "Four adwaita-core modules …", matched here as a literal string, so
 * closing one gap made the heading false and correcting it meant editing THIS FILE in the
 * same change. AGENTS.md forbids a live count in a comment; inside a required check it is
 * worse than drift.
 */
const NO_TABLE_LEDGER = 'adwaita-core modules with no conformance vector table';
const NO_DRIVER_LEDGER = 'adwaita-core modules whose only vector table is core-only';

/**
 * Core modules with no conformance file named after them and none importing them for VALUE.
 * `table` — its vectors live in another file under that name; `gap` — the named `###` heading
 * must be an open item in `status/open-todos.md`, so the gap has a place to be closed from.
 * Both, where the vectors exist but no renderer drives THEM either: those are different facts
 * and the entry has to state both, or "explained" quietly means "unexamined".
 */
const MODULE_REASONS = {
    breakpoint: { gap: NO_TABLE_LEDGER },
    'color-scheme': { gap: NO_TABLE_LEDGER },
    easing: { table: 'SPINNER_ARC_PHASE_VECTORS', gap: NO_DRIVER_LEDGER },
    glib: { table: 'GLIB_CLAMP_VECTORS', gap: NO_DRIVER_LEDGER },
    'length-unit': { table: 'ADW_LENGTH_UNIT_VECTORS', gap: NO_DRIVER_LEDGER },
    scrolling: { gap: NO_TABLE_LEDGER },
    toast: { gap: NO_TABLE_LEDGER },
};

/** `PREFIX_*[_VECTORS]` glob | `A/B_VECTORS` pair | a plain table name. */
const CITATION =
    /\b([A-Z][A-Z0-9_]*_)\*(?:_VECTORS)?|\b([A-Z][A-Z0-9_]*)\/([A-Z][A-Z0-9_]*_VECTORS)|\b[A-Z][A-Z0-9_]*_VECTORS\b/g;
/**
 * A citation is a COVERAGE claim only where the clause around it says so. The default is
 * the other way: a reason cites a table for lots of reasons — as a precedent ("same as X"),
 * as a concession ("its other reachers go through X, which stays core-only"), as a contrast.
 * This started as a four-phrase whitelist of precedent spellings, which reported "GAP for the
 * reason X gives" as a coverage claim: an unrecognised TRUE spelling became an accusation.
 * Naming the coverage spellings instead makes an unrecognised one silent.
 */
const COVERAGE_PHRASING = /\b(?:driven|drives?|driving|covered|asserted|asserts|held to|the RESULT is|same thing twice)\b/i;
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
/** An exemption that offers no coverage is a GAP, and a GAP with no anchor has no retirement. */
const GAP_REASON = /\bGAP\b/;
const GAP_ANCHOR = /#\d+/;
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

/** Comment bodies, blanked. `[^:]` before `//` keeps `https://` out of it. */
const withoutComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

/**
 * Which of `names` a suite under `dir` DRIVES: names used outside a comment, in a
 * `*.spec.ts`. Both halves are load-bearing, and a plain text scan had neither.
 *
 * Comments, because a claim must not supply its own evidence. This branch's own fix
 * spelled the five `DATA_GRID_*_VECTORS` out in an adwaita-web comment saying the
 * browser drives NONE of them — and thereby made all five read as browser-driven,
 * silencing the gate on the exact defect it was built for. It cuts the other way too:
 * a truthful cross-reference to an exempt table flipped it to "renderer-driven", and
 * the staleness arm then demanded the true marker be deleted.
 *
 * `*.spec.ts`, because driving a table means ITERATING it in a test. Today every
 * non-spec mention in either renderer is prose, so this changes nothing on its own —
 * it is what keeps the comment rule from being one file's move away from useless.
 */
function consumersUnder(dir, names) {
    const seen = new Set();
    for (const file of walk(dir)) {
        if (file.startsWith(CONFORMANCE_DIR) || !file.endsWith('.spec.ts')) continue;
        const source = withoutComments(readFileSync(file, 'utf8'));
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
 * A sentence, cut where it turns: at the words that switch which side of a contrast you
 * are on. The claim arms read CLAUSES, not sentences, because a sentence is not one claim.
 * Three TRUE sentences were rejected while it was:
 *   "Both renderers consume the derivation … and NEITHER is held to TAB_TOOLTIP_VECTORS"
 *   "The browser works in CSS pixels …, so ONLY NativeScript drives SIDEBAR_WIDTH_VECTORS."
 *   "Both renderers drive TOOLBAR_VIEW_CLASS_VECTORS, UNLIKE TOOLBAR_VIEW_ALLOCATE_VECTORS…"
 * Every one names the OTHER renderer, or the table that is NOT covered, in the same
 * sentence — which is how you state single-renderer coverage in English. The tree was green
 * only because its reasons had been worded around this: the split-view fix puts browser and
 * NativeScript in separate sentences, and the TAB_TOOLTIP reason writes "these rows" rather
 * than naming its own table. Dodged by wording is not satisfied.
 *
 * The marker STARTS the next clause, so the contrasted half is still read — it just no
 * longer inherits the claim from the half before it.
 */
const CLAUSE_TURN = /(?=\b(?:but|unlike|neither|nor|rather than|instead|whereas|while|except|not|no|none|only)\b)/i;
const clausesIn = (sentence) => sentence.split(CLAUSE_TURN);

/**
 * The tables a citation names. `missing` is what the spelling promised and the tree
 * does not have; for a glob an empty `names` IS the miss.
 */
function citationsIn(text, declared) {
    const found = [];
    for (const match of text.matchAll(CITATION)) {
        const [spelling, globPrefix, pairHead, pairTail] = match;
        if (globPrefix) {
            const expanded = [...declared].filter((name) => name.startsWith(globPrefix));
            // A glob that expands to NOTHING is not a citation. These trees are ports of C
            // and cite upstream constant families the same way — `GTK_STATE_FLAG_*`,
            // `ADW_TOAST_PRIORITY_*`, and `O_*`/`DH_CHECK_*` elsewhere in the repo. Reading
            // those as broken table citations rejected true sentences, and this gate carries
            // no `paths:` filter, so one such comment blocks every merge in the repo.
            if (expanded.length === 0) continue;
            found.push({ spelling, kind: 'glob', index: match.index, names: expanded, missing: [] });
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
 * The count word immediately before a citation, if the sentence states one — for a spelling
 * that CAN expand to several tables. A plain name always expands to exactly one, so the only
 * count that ever passes is "one", and "the three TAB_TOOLTIP_VECTORS rows below" — counting
 * ROWS, which is ordinary prose here — reads as an arity of three and fails. The digit case
 * was already excluded for this reason ("at 96 dpi ADW_LENGTH_UNIT_VECTORS" is arithmetic);
 * the spelled-word path was left open.
 */
function statedCount(sentence, index, kind) {
    if (kind === 'name') return undefined;
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

/** The unit both claim arms read: one clause of one sentence. */
const claimUnitsIn = (text) => sentencesIn(text).flatMap(clausesIn);

/** The tables a reason offers AS ITS COVERAGE — a citation whose own clause says so. */
function coverageCitedIn(reason) {
    const cited = [];
    for (const clause of claimUnitsIn(reason)) {
        if (!COVERAGE_PHRASING.test(clause)) continue;
        for (const citation of citationsIn(clause, declared)) cited.push(...citation.names);
    }
    return cited;
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
    return coverageCitedIn(reason).some((cited) => cited !== name && reachesADriver(cited, seen));
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
    // Every exemption is one of exactly two things, and it has to say which. A reason that
    // rests on another table NAMES it — as coverage (chain-resolved below) or as a precedent,
    // whose own header the table arm checks in its own right. A reason that rests on nothing
    // is a GAP, and says so with somewhere to close it from. The third shape — prose that
    // reads like coverage and names nothing — is the cheapest unfalsifiable exemption there
    // is, and no arm can see it: `CORE-ONLY: both renderers exercise this through their real
    // widgets` passed everything. Three of the 43 were that shape; two were measurably false.
    const named = citationsIn(reason, declared)
        .flatMap((citation) => citation.names)
        .filter((name) => name !== table.name);
    const coverage = coverageCitedIn(reason).filter((name) => name !== table.name);
    if (named.length === 0 && !GAP_REASON.test(reason)) {
        failures.push(
            `${where}: its ${CORE_ONLY_MARKER} reason names no table, so no part of it is checkable. ` +
                `Name the table whose coverage makes this one redundant, or spell it ` +
                `"${CORE_ONLY_MARKER} GAP — <why no renderer can drive it>. Tracked in #<issue>".`,
        );
    }
    // Regardless of what a GAP cites — several name the table they USED to be exempted by.
    if (GAP_REASON.test(reason) && !GAP_ANCHOR.test(reason)) {
        failures.push(`${where}: a ${CORE_ONLY_MARKER} GAP with no issue anchor has no owner and no retirement.`);
    }
    for (const name of coverage) {
        resolved.chains += 1;
        if (reachesADriver(name)) continue;
        failures.push(
            `${where}: its reason cites ${name} as the coverage that makes this table redundant, but ` +
                `no chain of citations from ${name} reaches a table any renderer drives.`,
        );
    }
}

// The CLAIM arm runs over the whole surface, not just table headers: two of the three
// false claims #1072 shipped were in prose ABOUT a table rather than above one, and
// `adw-data-grid.ts` put its "Both ports" a renderer-tree away from any conformance file.
for (const dir of [CORE_SUITE_DIR, ...RENDERERS.map((renderer) => renderer.dir)]) {
    for (const block of walk(dir).flatMap(commentBlocks)) {
        for (const clause of claimUnitsIn(block.text)) {
            const citations = citationsIn(clause, declared);
            if (citations.length === 0) continue;
            for (const citation of citations) {
                const where = `${relative(ROOT, block.file)}:${lineOf(block, citation.spelling)}`;
                resolved.citations += 1;
                for (const name of citation.missing) {
                    failures.push(`${where}: names ${name}, which no conformance file declares.`);
                }
                const stated = statedCount(clause, citation.index, citation.kind);
                if (stated !== undefined) {
                    resolved.counted += 1;
                    if (stated !== citation.names.length) {
                        failures.push(
                            `${where}: says ${stated} ${citation.spelling} table(s); the tree declares ${citation.names.length}.`,
                        );
                    }
                }
                if (citation.names.length === 0) continue;
                if (BOTH_CLAIM.test(clause)) {
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
                    if (!pattern.test(clause) || !COVERAGE_VERB.test(clause)) continue;
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
const conformanceFiles = walk(CONFORMANCE_DIR);
const conformanceSource = conformanceFiles.map((file) => readFileSync(file, 'utf8')).join('\n');
const openTodos = readFileSync(OPEN_TODOS, 'utf8');

/** Does this module export anything a renderer could be held to? */
const HAS_BEHAVIOUR = /^export\s+(?:async\s+)?(?:const|function|class|let|var|enum|default)\b/m;

for (const file of walk(CORE_SUITE_DIR)) {
    // Recursive, unlike the readdir this arm started with — the arm exists because the table
    // arm had an invisible set, and a non-recursive scan reproduces that one directory down.
    if (file.startsWith(CONFORMANCE_DIR) || file.endsWith('.spec.ts')) continue;
    const module = relative(CORE_SUITE_DIR, file).slice(0, -3);
    if (module === 'index') continue;
    const source = readFileSync(file, 'utf8');
    // A module of pure types has no behaviour to vector, so demanding vectors for it would
    // force the author to invent a table or a ledger item. Derived, not allowlisted.
    if (!HAS_BEHAVIOUR.test(source)) continue;
    const where = `${relative(ROOT, file)}`;
    // A VALUE import. `import type { AdwLengthUnit } from '../length-unit.js'` proves nothing
    // about vectors — it borrows a name for a field — and that is the whole of what covered
    // `length-unit.ts`.
    const valueImport = new RegExp(`import\\s+(?!type\\b)[^;]*?from '\\.\\./${module}\\.js'`);
    const covered =
        conformanceFiles.some((candidate) => candidate.endsWith(`/${module}.ts`)) || valueImport.test(conformanceSource);
    const reason = MODULE_REASONS[module];
    if (covered) {
        if (reason) failures.push(`${where}: listed in MODULE_REASONS, but conformance covers it now — drop the entry.`);
        continue;
    }
    if (!reason) {
        failures.push(
            `${where}: no conformance file is named after it and none imports it for value, so nothing ` +
                `tables its behaviour. Add vectors for it, or a MODULE_REASONS entry saying which table carries them.`,
        );
        continue;
    }
    if (reason.table && !declared.has(reason.table)) {
        failures.push(`${where}: MODULE_REASONS points at ${reason.table}, which no conformance file declares.`);
    }
    // A `table:` naming a table no renderer drives explains where the vectors LIVE and nothing
    // about who is held to them — which is the question this arm's finding text asks. Left at
    // `declared.has()`, the entry reads as resolved while the module is held to nothing at all.
    if (reason.table && declared.has(reason.table) && !byRenderer.has(reason.table) && !reason.gap) {
        failures.push(
            `${where}: its vectors live in ${reason.table}, which no renderer drives either — so no ` +
                `renderer is held to this module. That is a gap; give the entry a ledger heading too.`,
        );
    }
    if (reason.gap && !openTodos.includes(`### ${reason.gap}`)) {
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
