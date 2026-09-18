#!/usr/bin/env node
// What do the real `.blp` files in this tree actually use — at a revision you name?
//
// THE INCIDENT. ADR 0053 § Context carries a census of the real `.blp` files, and the
// decision to parse Blueprint in this repo rests on it. It was measured once, by hand,
// over the eleven files that existed on 2026-09-10, and written into the ADR as a table.
// Then #1690 added a twelfth file and the table silently became a claim about a tree
// that no longer existed. The first attempt to repair it patched the dated table with a
// sentence saying what the twelfth file adds — and that sentence was wrong twice: it
// said the new file "moves no other row" when it moves three more, and it was derived
// rather than measured, because nobody could re-run the original count.
//
// That is the real defect, and it is not arithmetic. A decision record whose evidence
// table cannot be re-derived from the tree stops being evidence and becomes recollection,
// and the only way anyone notices is when someone tries to check it. So the census is a
// script now: the ADR's table is dateABLE instead of dated, and "re-run it" is an answer.
//
// TWO ROWS OF THE ORIGINAL TABLE DO NOT REPRODUCE, and this script does not pretend
// otherwise. The ADR's `title: "…"` row and its `content: Adw.ToolbarView { }` row
// cannot be recovered from the tree under any definition tried — the candidates and what
// each one means are recorded in ADR 0053 beside the table, where a reader meets them.
// The rows below that carry `substitute: true` are the nearest measurable questions, and
// they are published under their OWN labels rather than under the old ones. Substituting
// a different measure under an unchanged label is how the table would lie a second time,
// more convincingly than the first.
//
// THE FILE LIST IS DERIVED, NEVER LISTED. It comes from `git ls-tree` at the revision,
// minus the corpus's own fixtures — so a thirteenth `.blp` is in the census the day it
// lands, and the same script run against an older revision reproduces that revision's
// numbers. `scripts/check-blueprint-corpus.mjs` stage A is what guarantees the two views
// agree: a real `.blp` that is not also a corpus reality probe fails it.
//
// No counts are written in this file. They are printed, for the reason
// `check-blueprint-corpus.mjs` gives at length: a live count in a comment is restatement
// that goes stale one commit later, which is the whole failure this script exists to end.
//
// Usage: node scripts/report-blueprint-census.mjs [<tree-ish>] [--markdown]
// Defaults to HEAD. `--markdown` prints the ADR's table shape, ready to paste.
// Exits non-zero only on a usage error or an unreadable revision — never on a finding.

import { spawnSync } from 'node:child_process';

/** The corpus keeps its own written fixtures here; the census is about the REAL files. */
const CORPUS_PREFIX = 'packages/infra/blueprint/corpus/';

/**
 * One row per question the census asks. `pattern` counts matching LINES, not matches, so
 * a line holding two constructs counts once — the same thing `grep -c` does, which is
 * what the hand-measured original used.
 *
 * `substitute: true` marks a row that is NOT a reproduction of an ADR 0053 table row but
 * the nearest question that can actually be measured. See the header.
 *
 * @type {readonly {label: string, pattern?: RegExp, derived?: string, substitute?: boolean, why: string}[]}
 */
const CENSUS_ROWS = [
    {
        label: 'using (every import line)',
        pattern: /^using /,
        why: 'ADR 0053 labels this row `using Adw 1;`, and the label undersells it: every real file imports BOTH Gtk and Adw, so the number is all `using` lines and not the Adw one. Counting only Adw halves it.',
    },
    {
        label: 'objects, line-start',
        pattern: /^\s*(?:Adw|Gtk)\.[A-Za-z]+/,
        why: 'Objects written as their own statement. Anchored at line start, so an object in property-value position (`content: Adw.ToolbarView { }`) is NOT counted here. The ADR table corroborates the anchor: its object-id row says "of those", and object ids counted line-start match it exactly while counting them anywhere does not.',
    },
    {
        label: 'object ids, line-start',
        pattern: /^\s*(?:Adw|Gtk)\.[A-Za-z]+\s+[A-Za-z_][A-Za-z0-9_]*/,
        why: 'GtkBuilder addressing, the subset of the row above that names its object. This is what `bind` resolves against, which is why a notation without ids cannot express `bind` at all.',
    },
    {
        label: 'property assignments, all',
        substitute: true,
        pattern: /^\s*[a-z][a-z0-9_-]*:/,
        why: 'Every `name: value`, object-valued ones included.',
    },
    {
        label: 'property assignments, object-valued',
        substitute: true,
        pattern: /^\s*[a-z][a-z0-9_-]*:\s*(?:Adw|Gtk)\./,
        why: 'An object as a property value — a slot, read through a ParamSpec. The nearest measurable neighbour of the ADR row that does not reproduce.',
    },
    {
        label: 'property assignments, scalar',
        substitute: true,
        derived: 'property assignments, all − property assignments, object-valued',
        // THE CAVEAT THAT MUST TRAVEL WITH THIS ROW: it is a substitute measure, not a
        // reconstruction. The ADR's `title: "…"` row cannot be reproduced, and this is
        // not a rediscovery of it — it is a different, answerable question that happens
        // to occupy the same place in the table. Do not relabel it back.
        why: 'Properties whose value is not an object. A substitute measure, NOT the ADR `title: "…"` row recovered.',
    },
    {
        label: 'slot brackets',
        pattern: /^\s*\[[a-z]+\]/,
        why: '`[start]`, `[end]`, `[top]`, `[bottom]`, `[center]`, `[breakpoint]` — placement on the child wrapper, which ADR 0029 § 4 derives from GIR.',
    },
    {
        label: 'styles blocks',
        pattern: /styles\s*\[/,
        why: 'ADR 0049 decided style classes are a list, so this projects to `cssClasses`.',
    },
    {
        label: 'template roots',
        pattern: /^template \$/,
        why: 'Not a tree construct at all: a file-level statement that this tree IS a class template. Equals the file count while every real file is a template.',
    },
    {
        label: 'translatable calls `_()`',
        // THE CAVEAT: `^[^/]*_\("` is a HEURISTIC, not a parse. It exists to skip the
        // `_()` written inside gtk-minimal's prose comment, which a bare /_\("/ counts as
        // a real call. It would miscount the mirror case — code on a line that later
        // carries a trailing `//` comment — of which this tree holds none today. If one
        // appears, this row is the first thing to distrust.
        pattern: /^[^/]*_\("/,
        why: 'The marking `xgettext` reads. The VALUE survives projection to `SharedNode` and the MARKING does not, which is the loss ADR 0033 prefers a template to avoid.',
    },
    {
        label: 'bind',
        pattern: /(?:^|\s)bind\s/,
        why: 'A GObject property binding, addressed by object id.',
    },
    {
        label: 'condition',
        pattern: /^\s*condition/,
        why: "`Adw.Breakpoint`'s own grammar, which is neither a property nor a child.",
    },
    {
        label: 'setters',
        pattern: /^\s*setters/,
        why: 'The other half of a breakpoint.',
    },
    {
        label: 'signal handlers `=>`',
        pattern: /=>/,
        why: 'Expected to be zero: handlers are wired in TypeScript here. A non-zero reading is news, because it is a construct the projection has never had to carry.',
    },
    {
        label: 'menu blocks',
        pattern: /^\s*menu\s/,
        why: 'Expected to be zero. `SharedNode.props` admits no menu model, so the first one is a blocker.',
    },
    {
        label: 'inline Gtk.Adjustment',
        pattern: /Gtk\.Adjustment/,
        why: 'Expected to be zero, and blocked for the same reason as a menu: ADR 0046 made it portable as a VALUE, which `SharedNode.props` cannot hold.',
    },
];

/** `git` with an argv array — never an interpolated command line. */
function git(args) {
    const r = spawnSync('git', args, { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0)
        throw new Error(`git ${args.slice(0, 2).join(' ')} failed: ${(r.stderr || '').trim().split('\n')[0]}`);
    return r.stdout;
}

/**
 * Every real `.blp` at this revision: tracked, and not one of the corpus's own fixtures.
 * Derived rather than listed, so the census follows the tree instead of trailing it.
 */
function realBlueprintPaths(rev) {
    return git(['ls-tree', '-r', '--name-only', rev])
        .split('\n')
        .filter((path) => path.endsWith('.blp') && !path.startsWith(CORPUS_PREFIX))
        .sort();
}

/** The census at one revision. Nothing is cached: two revisions are two runs. */
export function blueprintCensus(rev, { readTree = git } = {}) {
    const paths = realBlueprintPaths(rev);
    const lines = paths.flatMap((path) => readTree(['show', `${rev}:${path}`]).split('\n'));

    const counts = new Map();
    for (const row of CENSUS_ROWS) {
        if (row.pattern) counts.set(row.label, lines.filter((line) => row.pattern.test(line)).length);
    }
    // The derived row is spelled out rather than regexed, because subtraction is what it
    // IS: "not an object" has no pattern of its own.
    const all = counts.get('property assignments, all');
    const objectValued = counts.get('property assignments, object-valued');
    counts.set('property assignments, scalar', all - objectValued);

    return { rev, paths, rows: CENSUS_ROWS.map((row) => ({ ...row, count: counts.get(row.label) })) };
}

function renderText(report) {
    const width = Math.max(...report.rows.map((row) => row.label.length));
    const header = `${report.paths.length} real .blp at ${report.rev}\n`;
    const body = report.rows
        .map(
            (row) =>
                `  ${row.label.padEnd(width)}  ${String(row.count).padStart(4)}${row.substitute ? '  (substitute measure)' : ''}`,
        )
        .join('\n');
    return `${header}${body}\n\n  files:\n${report.paths.map((path) => `    ${path}`).join('\n')}\n`;
}

function renderMarkdown(report) {
    const rows = report.rows
        .map((row) => `| ${row.label}${row.substitute ? ' *' : ''} | ${row.count} | ${row.why} |`)
        .join('\n');
    return [
        `Measured over the ${report.paths.length} real \`.blp\` at \`${report.rev}\`, by`,
        '`node scripts/report-blueprint-census.mjs`.',
        '',
        '| construct | count | what it establishes |',
        '|---|---|---|',
        rows,
        '',
        '`*` = a substitute measure, not a reproduction of the original hand-count.',
        '',
    ].join('\n');
}

function main() {
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) {
        console.log(
            [
                'Usage: node scripts/report-blueprint-census.mjs [<tree-ish>] [--markdown]',
                '',
                'Counts what the real `.blp` files use, at the revision given (default HEAD).',
                'The file list is derived from the revision, so an older revision reproduces',
                "that revision's numbers and a newly added `.blp` is counted the day it lands.",
                '',
                '  <tree-ish>   any revision git understands: HEAD, origin/main, a SHA, a tag.',
                '  --markdown   print the ADR table shape instead of the plain listing.',
                '',
                'Two rows of the ADR 0053 table it replaces do not reproduce from the tree;',
                'rows marked as a substitute measure are the nearest answerable question and',
                'are labelled as themselves, never as the row they stand in for.',
            ].join('\n'),
        );
        return process.exit(0);
    }

    const rev = args.find((arg) => !arg.startsWith('-')) ?? 'HEAD';
    let report;
    try {
        report = blueprintCensus(rev);
    } catch (error) {
        console.error(`report-blueprint-census: ${error.message}`);
        return process.exit(2);
    }
    if (report.paths.length === 0) {
        // Said out loud: "no real `.blp` at this revision" and "the filter is wrong" look
        // identical in a table of zeros, and the second one is a broken census reporting green.
        console.error(`report-blueprint-census: no real .blp found at ${rev} — is the revision right?`);
        return process.exit(2);
    }

    console.log(args.includes('--markdown') ? renderMarkdown(report) : renderText(report));
    return process.exit(0);
}

// `import.meta.main` is not available on every Node this repo's CI still runs.
if (process.argv[1] && process.argv[1].endsWith('report-blueprint-census.mjs')) main();
