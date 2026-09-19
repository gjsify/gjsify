#!/usr/bin/env node
// Every Blueprint corpus count stated in live documentation is the count this tree holds.
//
// WHY THIS EXISTS. The corpus sizes — rule files, reality probes, goldens, refusals — are
// restated in prose in several files. Nothing held them to the tree, so every corpus change
// invalidated them in silence. It failed twice in one day: #1698
// corrected the counts in `status/open-todos.md`, and #1700 added three rule files and four
// refusals hours later and left every one of them wrong again. #1698 built exactly this gate
// one file over, for ADR 0053's census; this is the same class, and a gate is the only
// difference between a rule and a preference.
//
// THE NUMBERS ARE MEASURED, NEVER TRANSCRIBED. Each count comes from its own listing in the
// tree, and the fix for a failure here is to re-run the harness and write down what it
// prints — never to edit a digit until the message stops. Editing a digit is how the wrong
// count got there both times.
//
// FIVE VERDICTS, AND EVERY LINE THAT STATES A COUNT GETS ONE.
//
//   LIVE      — `SITES`: every count in the file must equal the tree, and the file must still
//               STATE each count it is listed for. A document that answers a stale number by
//               deleting the sentence has not been corrected, it has been emptied, so a
//               missing claim fails as loudly as a wrong one.
//   SNAPSHOT  — `SNAPSHOTS`: a whole file whose numbers are a measurement over the tree it was
//               taken against. Named, with the reason written down.
//   DATED     — `DATED_LINES`: one line inside a LIVE file whose number is an incident, a
//               delta or a quotation rather than a claim about this tree.
//   ELSEWHERE — `OTHER_SUBJECT`: one line that matches the nouns while counting something
//               else entirely.
//   OWNED     — `OWNED_ELSEWHERE`: a file another gate holds to a stricter contract. The
//               entry names that script, and fails when it leaves the tree.
//
// Both ledgers hold the line's exact text, so editing or deleting the line retires the entry
// instead of silently widening it, and an entry that matches nothing is itself a failure.
// Anything else that states a count fails as UNGATED — the arm that catches the file nobody
// thought to look in, which is why the sweep reads the tree rather than a list of documents.
//
// WHAT INPUT MAKES EACH CHECK FAIL, asked of every one of them because #1698 shipped an
// assertion that could not fail: a digit or a spelled-out number moved in a live file; a live
// file that stops stating a count it owns; a count appearing in a file with no verdict; a
// ledger entry whose line no longer reads as recorded; and a corpus that grows or shrinks by
// one file, which moves the tree side of every comparison at once. `rules + probes ===
// goldens` is a claim about three independent listings — `corpus/rules/*.blp`, tracked `.blp`
// minus the corpus, and `corpus/*/*.ui` — and no term of it is computed from the others, so
// the sum can be false. The manifest cross-checks have the same shape: the list and the
// directory are read separately.
//
// THE SWEEP KEYS ON NOUNS, AND SAYS SO. A count reaches a reader as a number beside the thing
// it counts, so that is what is matched — across line ends, because this repo hard-wraps and
// the sentence that went stale twice says "the 19" at the end of one line and "refusals" at
// the start of the next. A number with no noun near it ("42 of 42 byte-equal") is outside the
// sweep; `corpus/divergences.mjs` carried exactly that and now states no count at all, which
// is the fix this gate asks for anyway.
//
// THIS FILE IS NOT SWEPT, AND THE REASON IS NOT CONVENIENCE. Every count in it is a QUOTATION:
// the ledgers hold other files' lines verbatim, and the stale-entry arm below already requires
// each of those texts to still be a line in the file it names. Reading them a second time as
// claims of their own would make the ledger fail for containing the very thing it excuses, and
// would do it in the file a reader goes to for the explanation. Found the hard way: the first
// version of this gate was written, mutated and proved green while it was still UNTRACKED, so
// `git ls-files` never handed it to its own sweep. It went red the moment it was committed.
// A gate that has never been run against the tree it will live in has not been run.
//
// ADR 0053 IS NOT SWEPT HERE. `check-blueprint-census.mjs` holds it to a stricter contract —
// its census section is EMITTED, and a corpus count stated anywhere else in that ADR is
// refused outright rather than compared. One file, one gate, or one failure gets two fixes.
//
// In CI this runs in `tree-checks`, beside `check-blueprint-census.mjs`: the one job with no
// classifier gate, so a docs-only PR runs it — and a docs-only PR is precisely the one that
// edits these sentences.
//
// Usage: node scripts/check-blueprint-corpus-counts.mjs [--root <dir>]
// Exits 0 when the documents agree with the tree, 1 when they drift, 2 on a usage or read error.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CORPUS = 'packages/infra/blueprint/corpus';

/** How a reader is told to re-measure, printed with every failure. */
const MEASURE_WITH = 'node scripts/check-blueprint-corpus.mjs';

const ONES = [
    'zero',
    'one',
    'two',
    'three',
    'four',
    'five',
    'six',
    'seven',
    'eight',
    'nine',
    'ten',
    'eleven',
    'twelve',
    'thirteen',
    'fourteen',
    'fifteen',
    'sixteen',
    'seventeen',
    'eighteen',
    'nineteen',
];
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

/**
 * Spelled-out numbers count as much as digits. ADR 0053's gate found that the number a reader
 * believes is as often written out as typed, and `corpus/manifest.mjs` states the probe count
 * four times without ever using a digit — a sweep for `\d+` would report that file clean.
 * `forty-two`, `forty two` and `42` get one reading, or the sweep has a blind spot.
 */
const NUMBER_WORD = [
    ...ONES,
    ...Object.keys(TENS).flatMap((ten) => [...ONES.slice(1, 10).map((one) => `${ten}[- ]${one}`), ten]),
].join('|');

const readNumber = (text) => {
    const word = text.toLowerCase().replace(/\s+/g, '-');
    if (/^\d+$/.test(word)) return Number(word);
    const [tens, ones] = word.split('-');
    if (tens in TENS) return TENS[tens] + (ones ? ONES.indexOf(ones) : 0);
    return ONES.indexOf(word);
};

/**
 * The four counts, each with the spellings prose uses for it and the way the TREE answers it.
 * Every measurement is its own listing: none is derived from another, which is what lets the
 * partition below be a claim rather than an identity.
 */
const CATEGORIES = {
    rules: {
        label: 'rule file',
        noun: String.raw`(?:written\s+|corpus\s+)?rule files?|corpus rules?|rule goldens?`,
        measure: (tree) => tree.lsFiles(`${CORPUS}/rules/*.blp`).length,
    },
    probes: {
        label: 'reality probe',
        noun: String.raw`reality[- ]probes?|reality-probe goldens?|probes?|real(?:ity)? files?|real \x60?\.blp\x60?|shipped \x60?\.blp\x60?|\x60?\.blp\x60? files?`,
        measure: (tree) => tree.lsFiles('*.blp').filter((path) => !path.startsWith(`${CORPUS}/`)).length,
    },
    goldens: {
        label: 'golden',
        noun: String.raw`goldens?|corpus files?`,
        measure: (tree) => tree.lsFiles(`${CORPUS}/*/*.ui`).length,
    },
    refusals: {
        label: 'refusal',
        noun: String.raw`refusals?|refused files?`,
        measure: (tree) => tree.lsFiles(`${CORPUS}/refused/*.blp`).length,
    },
};

/**
 * LIVE documentation. `states` is what the file OWNS: each of those counts must appear in it at
 * least once, and every count that appears must be the tree's. Listing a category without a
 * sentence to back it fails, which is the point — the list is a promise about what the document
 * says, not a filter on what it is allowed to say.
 */
const SITES = [
    { file: 'status/open-todos.md', states: ['rules', 'probes', 'goldens', 'refusals'] },
    { file: 'packages/infra/blueprint/README.md', states: ['probes'] },
    { file: `${CORPUS}/manifest.mjs`, states: ['probes'] },
    { file: `${CORPUS}/expectations.mjs`, states: ['probes'] },
    { file: `${CORPUS}/real-expectations.mjs`, states: ['probes'] },
];

/**
 * Whole files whose numbers are a measurement over the tree they were taken against. A decision
 * record states what was true when the decision was taken; correcting it to today would destroy
 * the evidence the decision rests on.
 */
const SNAPSHOTS = [
    {
        file: 'docs/adr/0058-translatable-marking-gets-a-spelling.md',
        why: 'its § Context says in as many words to read the numbers "as a date, not as a constant" and tells the reader to re-derive rather than reconcile',
    },
    {
        file: 'docs/adr/0062-the-blueprint-conversion-frontier-is-composition.md',
        why: "a dated re-derivation of 0058's census, with a § Method naming the revision, the compiler and the `@girs` pin it was taken under",
    },
];

/**
 * Files another gate already owns, more strictly than this one could. Listed so the sweep
 * says who owns them instead of going quiet, and so a file cannot lose its gate by being
 * deleted from the other one — this entry names the script that must still be there.
 */
const OWNED_ELSEWHERE = [
    {
        file: 'docs/adr/0053-blueprint-parsed-in-repo.md',
        by: 'scripts/check-blueprint-census.mjs',
        why: 'its census section is EMITTED by `report-blueprint-census.mjs`, and that gate refuses any corpus count stated outside the emitted block rather than comparing it',
    },
];

/** A count inside a LIVE file that is not a claim about this tree. Matched by exact line text. */
const DATED_LINES = [
    {
        file: 'scripts/check-blueprint-corpus.mjs',
        text: '// and this one was stale at "25 rules" one rule file later.',
        why: 'the incident this gate exists because of, quoted as it stood',
    },
    {
        file: 'scripts/check-blueprint-census.mjs',
        text: '* found still sitting outside the block ("38 goldens, 37 byte-equal"), untouched by a gate',
        why: 'the count that made that gate widen its claim, quoted as it stood in the ADR',
    },
    {
        file: `${CORPUS}/expectations.mjs`,
        text: '* clause 3 names from the census of the eleven real files there were then; the rest are',
        why: '"there were then" — an explicitly dated reading of ADR 0053 clause 3',
    },
    {
        file: 'status/open-todos.md',
        text: '**0 of the 11 real `.blp` files this repo builds round-trip through `SharedNode`**, and the',
        why: 'quoted from ADR 0058 § Context, read at `702470a628`, which the sentence above it attributes',
    },
    {
        file: 'status/open-todos.md',
        text: 'else**, and closing that one loss moves 0 of the 11 real files, so the two directions do not',
        why: 'the same quotation, continued',
    },
    {
        file: 'status/open-todos.md',
        text: 'The census, over the 38 corpus files (27 written rule files, 11 real `.blp`) at',
        why: 'anchored at `702470a628` on the line below it — a measurement over that tree',
    },
    {
        file: '.github/workflows/main.yml',
        text: '# were stale one rule file later. Stage A (complete corpus, valid expectations, no',
        why: 'the incident again, in the job comment that explains why `tree-checks` runs these at all',
    },
];

/** A line matching the nouns while counting something else entirely. Matched by exact text. */
const OTHER_SUBJECT = [
    {
        file: '.github/workflows/main.yml',
        text: 'echo "all three refusals fired"',
        why: "the `gi://` renderer arms' three build-time refusals, nothing to do with the corpus",
    },
    {
        file: 'status/open-todos.md',
        text: 'the two refusals are e2e-covered. What has never happened is the submission.',
        why: 'the two Flathub submission refusals',
    },
];

const TEXT = /\.(?:md|mdx|mjs|cjs|js|ts|tsx|mts|cts|yml|yaml|json|blp|ui|txt|toml)$/;

/** This script, which holds other files' lines verbatim — see the header for why it is skipped. */
const SELF = 'scripts/check-blueprint-corpus-counts.mjs';

/**
 * In scope when the file talks about THIS corpus rather than about Blueprint in general. A
 * document that states the corpus's size names the corpus — the harness that measures it, the
 * directory that holds it, or the ledger beside it — so scope is a property of the subject and
 * not a list of documents, and a new file about the corpus is swept the day it is written.
 * `.blp` counts belonging to a showcase or to Learn6502 are a different subject and stay out:
 * they say nothing about `corpus/`.
 */
const SUBJECT = /packages\/infra\/blueprint|check-blueprint-corpus|SHADOW_DIVERGENCES|corpus\/(?:rules|refused|real)\b/;

/**
 * Every claim in a whole file, scanned ACROSS line ends and reported against the line the
 * number falls on. Markdown here is hard-wrapped at about ninety columns, which splits a
 * claim as often as not: the sentence this gate was written for says "and the 19" at the end
 * of one line and "refusals" at the start of the next. A line-at-a-time sweep reads that file
 * as stating no refusal count at all — green, and blind to the exact claim that went stale
 * twice.
 */
function claimsIn(text) {
    const lineStarts = [0];
    for (let i = 0; i < text.length; i += 1) if (text[i] === '\n') lineStarts.push(i + 1);
    const lineOf = (index) => {
        let low = 0;
        let high = lineStarts.length - 1;
        while (low < high) {
            const mid = (low + high + 1) >> 1;
            if (lineStarts[mid] <= index) low = mid;
            else high = mid - 1;
        }
        return low;
    };

    const found = [];
    for (const [key, { noun }] of Object.entries(CATEGORIES)) {
        const re = new RegExp(String.raw`\b(${NUMBER_WORD}|\d{1,3})\b[\s\x60*_]{0,3}(?:${noun})\b`, 'gi');
        for (const match of text.matchAll(re)) {
            found.push({
                key,
                stated: readNumber(match[1]),
                text: match[0].replace(/\s+/g, ' '),
                line: lineOf(match.index),
            });
        }
    }
    return found;
}

async function readTree(root) {
    const git = (args) => {
        const run = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
        if (run.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${(run.stderr || '').trim()}`);
        return run.stdout.split('\n').filter(Boolean);
    };
    const { CORPUS_RULES, CORPUS_REAL_FILES, CORPUS_REFUSALS } = await import(
        `file://${join(root, CORPUS, 'manifest.mjs')}`
    );
    const ctx = { lsFiles: (pattern) => git(['ls-files', '--', pattern]) };
    const counts = Object.fromEntries(Object.entries(CATEGORIES).map(([key, c]) => [key, c.measure(ctx)]));
    return { counts, files: git(['ls-files']), manifest: { CORPUS_RULES, CORPUS_REAL_FILES, CORPUS_REFUSALS } };
}

/**
 * The tree read two ways. Each of these is false for a real edit: a rule `.blp` committed
 * without its golden breaks the partition, and a manifest entry removed while its file stays
 * breaks the cross-check. Neither side is computed from the other — the defect #1698 shipped
 * and then documented was a sum whose second term was the difference of the first and the
 * total, which could not be false.
 */
function treeSelfChecks({ counts, manifest }) {
    const out = [];
    if (counts.rules + counts.probes !== counts.goldens) {
        out.push(
            `the corpus does not add up: ${counts.rules} rule file(s) + ${counts.probes} reality probe(s) is not ` +
                `${counts.goldens} golden(s) — a rule or a probe is missing its \`.ui\`, or a stray one is tracked`,
        );
    }
    const pairs = [
        ['CORPUS_RULES', manifest.CORPUS_RULES.length, counts.rules, `${CORPUS}/rules/*.blp`],
        ['CORPUS_REAL_FILES', manifest.CORPUS_REAL_FILES.length, counts.probes, 'tracked `.blp` outside the corpus'],
        ['CORPUS_REFUSALS', manifest.CORPUS_REFUSALS.length, counts.refusals, `${CORPUS}/refused/*.blp`],
    ];
    for (const [name, listed, onDisk, where] of pairs) {
        if (listed !== onDisk) {
            out.push(
                `${name} lists ${listed} file(s) and ${where} holds ${onDisk} — \`${MEASURE_WITH}\` stage A says which`,
            );
        }
    }
    return out;
}

async function main() {
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) {
        console.log('usage: node scripts/check-blueprint-corpus-counts.mjs [--root <dir>]');
        return process.exit(0);
    }
    // A mistyped flag must not read as its own absence — see `check-blueprint-corpus.mjs`.
    const rootFlag = args.indexOf('--root');
    const root = rootFlag === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..') : args[rootFlag + 1];
    const stray = args.filter((arg, i) => arg !== '--root' && !(rootFlag !== -1 && i === rootFlag + 1));
    if (stray.length > 0 || (rootFlag !== -1 && typeof root !== 'string')) {
        const why = stray.length > 0 ? `unknown argument(s): ${stray.join(', ')}` : '--root needs a directory';
        console.error(
            `check-blueprint-corpus-counts: ${why}\n` +
                '  usage: node scripts/check-blueprint-corpus-counts.mjs [--root <dir>]',
        );
        return process.exit(2);
    }

    let tree;
    try {
        tree = await readTree(root);
    } catch (error) {
        console.error(`check-blueprint-corpus-counts: ${error.message}`);
        return process.exit(2);
    }

    const { counts } = tree;
    const drift = [];
    const ungated = [];
    const stated = new Set();
    const usedLedger = new Set();
    const swept = [];

    for (const file of tree.files.filter((path) => TEXT.test(path))) {
        let text;
        try {
            text = readFileSync(join(root, file), 'utf8');
        } catch (error) {
            console.error(`check-blueprint-corpus-counts: cannot read ${file}: ${error.message}`);
            return process.exit(2);
        }
        if (file === SELF) continue;
        if (!file.startsWith('packages/infra/blueprint/') && !SUBJECT.test(text)) continue;
        swept.push(file);
        if (SNAPSHOTS.some((entry) => entry.file === file)) {
            usedLedger.add(`snapshot\u0000${file}`);
            continue;
        }
        if (OWNED_ELSEWHERE.some((entry) => entry.file === file)) {
            usedLedger.add(`owned\u0000${file}`);
            continue;
        }

        const site = SITES.find((entry) => entry.file === file);
        const lines = text.split('\n');
        for (const claim of claimsIn(text)) {
            const trimmed = lines[claim.line].trim();
            const ledgered = [...DATED_LINES, ...OTHER_SUBJECT].find(
                (entry) => entry.file === file && entry.text === trimmed,
            );
            if (ledgered) {
                usedLedger.add(`line\u0000${file}\u0000${ledgered.text}`);
                continue;
            }
            if (!site) {
                ungated.push({ file, at: claim.line + 1, line: trimmed, claims: [claim] });
                continue;
            }
            stated.add(`${file}\u0000${claim.key}`);
            if (claim.stated !== counts[claim.key]) drift.push({ file, at: claim.line + 1, line: trimmed, claim });
        }
    }

    const problems = treeSelfChecks(tree);

    // Both halves are printed, because "they differ" without the two texts is the kind of
    // failure people fix by editing the number the error happens to mention.
    if (drift.length > 0) {
        console.error('check-blueprint-corpus-counts: a stated count is not the count this tree holds.\n');
        for (const { file, at, line, claim } of drift) {
            console.error(`  ${file}:${at}`);
            console.error(`    doc:  ${line}`);
            console.error(
                `    tree: ${counts[claim.key]} ${CATEGORIES[claim.key].label}(s), where the line says "${claim.text}"\n`,
            );
        }
    }

    for (const { file, at, line, claims } of ungated) {
        console.error(
            `check-blueprint-corpus-counts: ${file}:${at} states a corpus count and nothing checks it —\n` +
                '  the failure this gate exists to end, in a file that has no verdict.\n' +
                `    ${line}\n` +
                `    reads as: ${claims.map((c) => `${c.stated} ${CATEGORIES[c.key].label}(s)`).join(', ')}\n` +
                '  Give it one: a `SITES` entry when the document is live, a `SNAPSHOTS` or ledger entry\n' +
                '  with the reason written down when the number is dated or counts something else.\n',
        );
    }

    for (const site of SITES) {
        for (const key of site.states) {
            if (!stated.has(`${site.file}\u0000${key}`)) {
                problems.push(
                    `${site.file} is listed as stating the ${CATEGORIES[key].label} count and states none — ` +
                        'a sentence deleted is not a number corrected; put it back, or drop the category from `SITES`',
                );
            }
        }
    }

    for (const entry of [...DATED_LINES, ...OTHER_SUBJECT]) {
        if (!usedLedger.has(`line\u0000${entry.file}\u0000${entry.text}`)) {
            problems.push(
                `a ledger entry for ${entry.file} matches no line any more — re-justify it or remove it:\n` +
                    `    recorded: ${entry.text}\n` +
                    `    because:  ${entry.why}`,
            );
        }
    }
    for (const entry of SNAPSHOTS) {
        if (!usedLedger.has(`snapshot\u0000${entry.file}`)) {
            problems.push(
                `\`SNAPSHOTS\` names ${entry.file}, which the sweep never reached — the entry is dead weight`,
            );
        }
    }
    for (const entry of OWNED_ELSEWHERE) {
        if (!usedLedger.has(`owned\u0000${entry.file}`)) {
            problems.push(
                `\`OWNED_ELSEWHERE\` names ${entry.file}, which the sweep never reached — the entry is dead weight`,
            );
        }
        if (!tree.files.includes(entry.by)) {
            problems.push(
                `${entry.file} is left to ${entry.by}, and that script is not in the tree — nothing gates it now`,
            );
        }
    }

    for (const problem of problems) console.error(`check-blueprint-corpus-counts: ${problem}\n`);

    if (drift.length + ungated.length + problems.length > 0) {
        console.error(`  Re-measure, then write down what it prints:\n    ${MEASURE_WITH}`);
        return process.exit(1);
    }

    const summary = Object.entries(counts)
        .map(([key, n]) => `${n} ${CATEGORIES[key].label}(s)`)
        .join(', ');
    console.log(
        `check-blueprint-corpus-counts: ${swept.length} file(s) swept, every stated count is the tree's — ${summary}.`,
    );
    return process.exit(0);
}

// `import.meta.main` is not available on every Node this repo's CI still runs.
if (process.argv[1] && process.argv[1].endsWith('check-blueprint-corpus-counts.mjs')) await main();
