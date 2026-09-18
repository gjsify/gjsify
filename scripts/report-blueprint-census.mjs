#!/usr/bin/env node
// What do the real `.blp` files in this tree actually use — at a revision you name?
//
// THE INCIDENT. ADR 0053 § Context carries a census of the real `.blp` files, and the
// decision to parse Blueprint in this repo rests on it. It was measured once, by hand,
// over the eleven files of 2026-09-10, and written into the ADR as a table. #1690 added a
// twelfth file and the table became a claim about a tree that no longer existed. The first
// repair patched it with a sentence saying what the twelfth file adds, and that sentence
// was wrong — it said the new file "moves no other row" when it moves three more. Nobody
// could re-run the original count to check it against, so the delta was reasoned rather
// than measured. That is why this script exists: the ADR's table is emitted from here, and
// `check-blueprint-census.mjs` fails when the two disagree.
//
// THE SECOND MISTAKE IS THE ONE WORTH REMEMBERING. Two rows — `title: "…"` at 197 and
// `content: Adw.ToolbarView { }` at 19 — resisted every definition tried, and the next
// repair was about to publish "these two rows cannot be reproduced" in the ADR. They
// reproduce. 197 + 19 = 216, which is the total property-assignment count that was already
// measured and sitting right there: TWO ORPHAN NUMBERS THAT SUM TO A NUMBER YOU ALREADY
// HAVE ARE A PARTITION, NOT NOISE. The 19 are the properties whose value is an ANONYMOUS
// object; the other 197 are everything else, which is mostly properties with no object
// value at all plus three whose value object carries a GtkBuilder id. `assertPartition`
// below holds that identity on every run, because what hid it was that nobody checked the
// halves against the whole.
//
// AND THE FIRST `assertPartition` COULD NOT FAIL. It computed one half by subtracting the
// other and then checked that they added back up — a tautology, under a comment saying it
// held the identity on every run. That is the same defect as the stale table it was written
// to guard: something reporting success without doing any checking. Each count now comes
// from its own pattern, so the sum is a claim that can be false, and mutating any one of
// the four patterns makes it false.
//
// THE FILE LIST IS DERIVED, NEVER LISTED. It comes from `git ls-tree` at the revision,
// minus the corpus's own fixtures — so a thirteenth `.blp` is in the census the day it
// lands, and the same script at an older revision reproduces that revision's numbers.
// `check-blueprint-corpus.mjs` stage A is what keeps the two views agreeing: a real `.blp`
// that is not also a corpus reality probe fails it.
//
// NAMESPACES ARE REPORTED, NOT FILTERED. The object patterns match any `Ns.Type` and any
// `$Extern`, and the run prints which namespaces it saw. An earlier draft hard-wired
// `Adw|Gtk`, which is true today and would have dropped a `Gio.`, `GtkSource.` or `$Custom`
// object out of the census in silence — a census that quietly stops counting is worse than
// one that stops.
//
// No counts are written in this file. They are printed, for the reason
// `check-blueprint-corpus.mjs` gives at length: a live count in a comment is restatement
// that goes stale one commit later, which is the whole failure this script exists to end.
//
// Usage: node scripts/report-blueprint-census.mjs [<tree-ish>] [--markdown]
// Defaults to HEAD. `--markdown` emits ADR 0053's table block verbatim — the same bytes
// `check-blueprint-census.mjs` holds the ADR to, so the table is never hand-transcribed.
// Exits non-zero on a usage error, an unreadable revision, or a broken partition.

import { spawnSync } from 'node:child_process';

/** The corpus keeps its own written fixtures here; the census is about the REAL files. */
const CORPUS_PREFIX = 'packages/infra/blueprint/corpus/';

/** `Ns.Type` or `$Extern` — every object spelling Blueprint has, not a namespace allowlist. */
const OBJECT = String.raw`(?:[A-Z][A-Za-z0-9]*\.[A-Za-z][A-Za-z0-9]*|\$[A-Za-z][A-Za-z0-9]*)`;

/** A property assignment's name, which is always lower-case in Blueprint. */
const PROP = String.raw`[a-z][a-z0-9_-]*:`;

/**
 * The raw line counts the rows are built from. Each counts matching LINES, not matches, so
 * a line holding two constructs counts once — what `grep -c` does, and what the original
 * hand-count did.
 */
const PATTERNS = {
    using: /^using /,
    objects: new RegExp(String.raw`^\s*${OBJECT}`),
    objectIds: new RegExp(String.raw`^\s*${OBJECT}\s+[A-Za-z_][A-Za-z0-9_]*`),
    propsAll: new RegExp(String.raw`^\s*${PROP}`),
    // The `{` with nothing between it and the type name is what makes the value object
    // ANONYMOUS. Drop it and three id-carrying `content: Gtk.Box canvasContainer {` join
    // the count, which is exactly the 22-vs-19 that made this row look unreproducible.
    propsAnonymousObject: new RegExp(String.raw`^\s*${PROP}\s*${OBJECT}\s*\{`),
    // Counted from its OWN pattern, never as `propsAll - propsAnonymousObject`. Subtracting
    // is what made the first `assertPartition` a tautology: it reported success without
    // checking anything, which is the defect this whole census exists to document. Derived
    // independently, the sum below is a real claim about two regexes and breaks when either
    // one drifts away from the other.
    propsScalar: new RegExp(String.raw`^\s*${PROP}(?!\s*${OBJECT}\s*\{)`),
    propsObjectValued: new RegExp(String.raw`^\s*${PROP}\s*${OBJECT}`),
    propsIdentifiedObject: new RegExp(String.raw`^\s*${PROP}\s*${OBJECT}\s+[A-Za-z_][A-Za-z0-9_]*`),
    slots: /^\s*\[[a-z]+\]/,
    styles: /styles\s*\[/,
    templates: /^template \$/,
    // A HEURISTIC, not a parse: it skips the `_()` written inside gtk-minimal's prose
    // comment, which a bare /_\("/ counts as a real call. It would miscount the mirror
    // case — code on a line that later carries a trailing `//` — of which this tree holds
    // none. If one appears, this is the first row to distrust.
    translatable: /^[^/]*_\("/,
    bind: /(?:^|\s)bind\s/,
    condition: /^\s*condition/,
    setters: /^\s*setters/,
    signals: /=>/,
    menus: /^\s*menu\s/,
    adjustments: /Gtk\.Adjustment/,
};

/**
 * ADR 0053 § Context's table, one entry per row and in its order. `cell` renders the count
 * column; the other three columns are the ADR's own prose and live here so the table is
 * emitted rather than transcribed.
 *
 * @type {readonly {blueprint: string, cell: (c: Record<string, number>) => string, sharedNode: string, gir: string}[]}
 */
const CENSUS_ROWS = [
    {
        blueprint: '`using Gtk 4.0;` and `using Adw 1;` — EVERY import line',
        cell: (c) => `${c.using}`,
        sharedNode: 'carried by the class name',
        gir: 'yes — namespace and version',
    },
    {
        blueprint: '`Adw.HeaderBar { }` — an object as its own statement',
        cell: (c) => `${c.objects}`,
        sharedNode: "`tag: 'AdwHeaderBar'`",
        gir: 'yes — the GIR type',
    },
    {
        blueprint: '`title: "…"` — every property whose value is not an anonymous object',
        cell: (c) => `${c.propsScalar}`,
        sharedNode: "`props: { title: '…' }`",
        gir: 'yes — a ParamSpec',
    },
    {
        blueprint: '`[start]`, `[end]`, `[top]`, `[bottom]`, `[center]`, `[breakpoint]`',
        cell: (c) => `${c.slots}`,
        sharedNode: "`slot: 'start'`",
        gir: 'yes — ADR 0029 § 4 derives slot candidates from GIR',
    },
    {
        blueprint: '`content: Adw.ToolbarView { }` — an ANONYMOUS object as a property value',
        cell: (c) => `${c.propsAnonymousObject}`,
        sharedNode: "a child carrying `slot: 'content'`",
        gir: 'yes — a ParamSpec, read as a slot',
    },
    {
        blueprint: '`styles ["flat"]`',
        cell: (c) => `${c.styles}`,
        sharedNode: "`cssClasses: ['flat']`",
        gir: 'yes — ADR 0049 decided style classes are a list',
    },
    {
        blueprint: '`template $Foo: Adw.Bin`',
        cell: (c) => `${c.templates}`,
        sharedNode: '—',
        gir: '**no** — a GtkBuilder composite-template declaration',
    },
    {
        blueprint: '`Gtk.Box canvasContainer { }`',
        cell: (c) => `${c.objectIds} of those ${c.objects}`,
        sharedNode: '—',
        gir: '**no** — a GtkBuilder object id',
    },
    {
        blueprint: '`_("Back")`',
        cell: (c) => `${c.translatable}`,
        sharedNode: '—',
        gir: '**no** — a `translatable` attribute on the emitted XML',
    },
    {
        blueprint: '`bind …`',
        cell: (c) => `${c.bind}`,
        sharedNode: '—',
        gir: '**no** — a GObject property binding, addressed by id',
    },
    {
        blueprint: '`condition (…)` + `setters { }`',
        cell: (c) => `${c.condition} + ${c.setters}`,
        sharedNode: '—',
        gir: "**no** — `Adw.Breakpoint`'s own grammar",
    },
];

/** `git` with an argv array — never an interpolated command line. */
function git(args) {
    const r = spawnSync('git', args, { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) {
        throw new Error(`git ${args.slice(0, 2).join(' ')} failed: ${(r.stderr || '').trim().split('\n')[0]}`);
    }
    return r.stdout;
}

/**
 * Two partitions, each over counts taken from INDEPENDENT patterns, so each sum is a claim
 * that can be false:
 *
 *   every property assignment  = not-an-anonymous-object + anonymous-object
 *   every object-valued one    = anonymous + id-carrying
 *
 * The first version of this function computed one side by subtracting the other and then
 * checked that they added back up. That is a tautology: it could not fail, and it sat under
 * a comment claiming it held the identity on every run. A check that reports success without
 * checking is the same defect as the stale table this census replaced, so the shape matters
 * more than the arithmetic — each number here comes from its own regex against the lines.
 */
function assertPartition(counts) {
    const sums = [
        ['every property assignment', counts.propsAll, ['propsScalar', 'propsAnonymousObject']],
        ['object-valued properties', counts.propsObjectValued, ['propsAnonymousObject', 'propsIdentifiedObject']],
    ];
    for (const [what, whole, parts] of sums) {
        const total = parts.reduce((sum, key) => sum + counts[key], 0);
        if (total !== whole) {
            throw new Error(
                `${what} do not partition: ${parts.map((key) => `${key}=${counts[key]}`).join(' + ')} ` +
                    `= ${total}, but the whole is ${whole} — two of these patterns have drifted apart.`,
            );
        }
    }
}

/** Every real `.blp` at this revision: tracked, and not one of the corpus's own fixtures. */
function realBlueprintPaths(rev) {
    return git(['ls-tree', '-r', '--name-only', rev])
        .split('\n')
        .filter((path) => path.endsWith('.blp') && !path.startsWith(CORPUS_PREFIX))
        .sort();
}

/** The census at one revision. Nothing is cached: two revisions are two runs. */
export function blueprintCensus(rev) {
    const paths = realBlueprintPaths(rev);
    const lines = paths.flatMap((path) => git(['show', `${rev}:${path}`]).split('\n'));

    const counts = Object.fromEntries(
        Object.entries(PATTERNS).map(([key, pattern]) => [key, lines.filter((line) => pattern.test(line)).length]),
    );
    assertPartition(counts);

    // Reported so a namespace this census has never seen announces itself instead of
    // falling through a filter. `using Ns 1;` carries one too. A bare `$Extern` object has
    // no namespace to report and so cannot appear here — it moves the counts, silently, and
    // the object rows are where it would show.
    const objectNamespace = new RegExp(String.raw`(?:^\s*|:\s*)([A-Z][A-Za-z0-9]*)\.`);
    const namespaces = new Set();
    const usingByNamespace = {};
    for (const line of lines) {
        const object = line.match(objectNamespace);
        if (object) namespaces.add(object[1]);
        const imported = line.match(/^using ([A-Z][A-Za-z0-9]*)/);
        if (imported) {
            namespaces.add(imported[1]);
            usingByNamespace[imported[1]] = (usingByNamespace[imported[1]] ?? 0) + 1;
        }
    }

    return { rev, paths, counts, namespaces: [...namespaces].sort(), usingByNamespace, rows: CENSUS_ROWS };
}

/** The zeros the ADR states in prose. Emitted with their real values, so drift shows. */
function zeroSentence(counts) {
    const [signals, menus, adjustments] = [
        [counts.signals, 'signal handlers (`=>`)'],
        [counts.menus, '`menu` blocks'],
        [counts.adjustments, 'inline `Gtk.Adjustment` objects'],
    ].map(([n, what]) => `${n === 0 ? 'zero' : `**${n}**`} ${what}`);
    return `${signals[0].toUpperCase()}${signals.slice(1)}, ${menus} and ${adjustments}.`;
}

/** Small counts read as words in the ADR's prose, which is where they have to be emitted. */
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

/** `12` → `twelve`, and anything past the table's vocabulary stays a numeral. */
function word(n) {
    return WORDS[n] ?? `${n}`;
}

/**
 * ADR 0053's WHOLE census section, verbatim: the heading, the sentence that says what was
 * measured, the table, the zeros, and the two paragraphs that read numbers out of it.
 * `check-blueprint-census.mjs` holds the ADR to these exact bytes.
 *
 * THE PROSE IS IN HERE FOR A REASON. An earlier version emitted only the table, and the
 * paragraph under it went on asserting "twelve real", "11 + 12" and "208 + 20 = 228" in
 * plain text where nothing checked them — so falsifying all four left the gate green. That
 * is this PR's own failure moved one paragraph down: a number a reader will believe must
 * not sit outside the thing that checks numbers. Prose that states a count belongs here;
 * prose that states a JUDGEMENT belongs in the ADR, below the block.
 */
export function renderAdrBlock(report) {
    const { counts } = report;
    const files = report.paths.length;
    const adwImports = report.usingByNamespace.Adw ?? 0;
    const identified = counts.propsIdentifiedObject;
    const noObjectValue = counts.propsScalar - identified;
    return [
        `### What the ${word(files)} \`.blp\` files actually use`,
        '',
        `Measured over the ${word(files)} real \`.blp\` in this tree by`,
        '`node scripts/report-blueprint-census.mjs`, which derives its file list from `git ls-tree` at',
        'the revision it is given. This whole section is EMITTED by that script — heading, table and',
        'the two paragraphs below it — and `scripts/check-blueprint-census.mjs` fails when the ADR and',
        'the tree disagree, so a thirteenth `.blp` cannot leave any of it quietly wrong.',
        '',
        '| Blueprint | count | `SharedNode` | GIR-derived? |',
        '|---|---|---|---|',
        ...report.rows.map((row) => `| ${row.blueprint} | ${row.cell(counts)} | ${row.sharedNode} | ${row.gir} |`),
        '',
        zeroSentence(counts),
        '',
        `Three labels say what they count, because the old ones undersold it. The \`using\` row counts`,
        `EVERY import line — ${adwImports} \`using Adw 1;\` and ${counts.using - adwImports} \`using Gtk 4.0;\`, since not every file`,
        `imports both — where reading it as the Adw one alone gives ${adwImports}. The object row is anchored at`,
        'the start of a line and so excludes an object in property-value position, which the row below',
        'it counts instead. The object-id row is the subset of that object row which names its object,',
        'which is what its "of those" means and what `bind` resolves against.',
        '',
        'The two property rows are a PARTITION, and that is the one thing to carry away from this',
        `table: ${counts.propsScalar} + ${counts.propsAnonymousObject} = ${counts.propsAll}, every property assignment in the tree. The ${counts.propsAnonymousObject} are the ones whose`,
        `value is an ANONYMOUS object. The other ${counts.propsScalar} are not one thing: ${noObjectValue} have no object value at`,
        `all, and ${word(identified)} have an object value that carries a GtkBuilder id — \`content: Gtk.Box`,
        "canvasContainer { }`, which the anonymous row's `{` excludes. That split was nearly declared",
        'unreproducible during a recount, because both halves were measured against a guess instead of',
        `against their own total: ${counts.propsScalar} + ${counts.propsAnonymousObject} was sitting beside the ${counts.propsAll} that was already known. Two orphan`,
        'numbers that sum to a number you already have are a partition, not noise.',
    ].join('\n');
}

function renderText(report) {
    const { counts } = report;
    const rows = report.rows.map((row) => [row.blueprint.replace(/`/g, ''), row.cell(counts)]);
    const width = Math.max(...rows.map(([label]) => label.length));
    const scalar = counts.propsScalar;
    return [
        `${report.paths.length} real .blp at ${report.rev}`,
        ...rows.map(([label, cell]) => `  ${label.padEnd(width)}  ${cell}`),
        '',
        `  ${zeroSentence(counts)}`,
        `  namespaces seen: ${report.namespaces.join(', ')}`,
        `  partition: ${scalar} + ${counts.propsAnonymousObject} = ${counts.propsAll} property assignments`,
        '',
        '  files:',
        ...report.paths.map((path) => `    ${path}`),
    ].join('\n');
}

const USAGE = 'usage: node scripts/report-blueprint-census.mjs [<tree-ish>] [--markdown]';

function main() {
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) {
        console.log(
            [
                USAGE,
                '',
                'Counts what the real `.blp` files use, at the revision given (default HEAD).',
                'The file list is derived from the revision, so an older revision reproduces',
                "that revision's numbers and a newly added `.blp` is counted the day it lands.",
                '',
                '  <tree-ish>   any revision git understands: HEAD, origin/main, a SHA, a tag.',
                "  --markdown   emit ADR 0053's table block verbatim, for that ADR and for",
                '               `check-blueprint-census.mjs`, which holds the ADR to it.',
            ].join('\n'),
        );
        return process.exit(0);
    }

    // A mistyped flag must not read as its own absence, and a second tree-ish must not be
    // dropped in silence: both would report a census of something other than what was asked
    // for. Same reasoning as `check-blueprint-corpus.mjs`'s own stray-argument check.
    const positional = args.filter((arg) => !arg.startsWith('-'));
    const stray = args.filter((arg) => arg.startsWith('-') && arg !== '--markdown');
    if (stray.length > 0 || positional.length > 1) {
        const why =
            stray.length > 0
                ? `unknown argument(s): ${stray.join(', ')}`
                : `expected at most one tree-ish, got: ${positional.join(', ')}`;
        console.error(`report-blueprint-census: ${why}\n  ${USAGE}`);
        return process.exit(2);
    }

    let report;
    try {
        report = blueprintCensus(positional[0] ?? 'HEAD');
    } catch (error) {
        console.error(`report-blueprint-census: ${error.message}`);
        return process.exit(2);
    }
    if (report.paths.length === 0) {
        // Said out loud: "no real `.blp` here" and "the filter is wrong" look identical in a
        // table of zeros, and the second is a broken census reporting green.
        console.error(`report-blueprint-census: no real .blp found at ${report.rev} — is the revision right?`);
        return process.exit(2);
    }

    console.log(args.includes('--markdown') ? renderAdrBlock(report) : renderText(report));
    return process.exit(0);
}

// `import.meta.main` is not available on every Node this repo's CI still runs.
if (process.argv[1] && process.argv[1].endsWith('report-blueprint-census.mjs')) main();
