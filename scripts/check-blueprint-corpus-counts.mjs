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
// assertion that could not fail: a digit, a spelled-out number or a thousands-separated one
// moved in a live file; a live file that stops stating a count it owns; a count appearing in
// any tracked file with no verdict; a ledger entry whose line no longer reads as recorded; and
// a corpus that grows or shrinks by one file, which moves the tree side of every comparison at
// once. `rules + probes ===
// goldens` is a claim about three independent listings — `corpus/rules/*.blp`, tracked `.blp`
// minus the corpus, and `corpus/*/*.ui` — and no term of it is computed from the others, so
// the sum can be false. The manifest cross-checks have the same shape: the list and the
// directory are read separately.
//
// WHAT IS SWEPT, EXACTLY — because an arm that promises more than it does is this gate's own
// failure class, one level up. EVERY tracked file is read: no allow-list of extensions (an
// adversarial pass walked a stale count through `.sh`, `.py`, `.rs`, `.html`, `.xml`, `.svg`,
// `.po`, `.rst`, `.jsonc` and an extensionless `NOTES` when there was one), no filter on what
// the file says. Binary is decided by a NUL byte at the read, not by its name.
//
// The NOUNS are what is scoped, in two tiers. A PLAIN spelling can only be this corpus — "rule
// files", "reality probes", "corpus files", "refused `.blp`", "`.ui` goldens", "negative
// cases" — and is matched everywhere in the tree. A LOOSE spelling ("rules", "probes",
// "goldens", "fixtures", "refusals") names a dozen other things here, and is read only inside
// the package that IS the corpus, or in a file whose path names it. That boundary is measured,
// not preferred: reading the loose set wherever a file merely MENTIONS the corpus turns
// `status/open-todos.md` into sixty findings that are e2e fixtures and lint rules, and a gate
// nobody reads twice gates nothing. The cost is stated rather than hidden — a bare "rules"
// count in a file outside the package is not seen, which is why the live documents here were
// moved to the unambiguous spelling instead of being excused.
//
// Matching runs ACROSS line ends, because this repo hard-wraps: the sentence this gate exists
// for says "and the 19" at the end of one line and the noun at the start of the next. Between
// the number and its noun may stand whitespace at any indent, one blank line, one markdown
// table pipe, emphasis marks, a backtick — never a word. A number with no noun near it at all
// ("42 of 42 byte-equal") is outside the sweep; `corpus/divergences.mjs` carried exactly that
// and now states no count, which is the fix this gate asks for anyway.
//
// THIS FILE IS SWEPT LIKE ANY OTHER, MINUS ITS QUOTATIONS. The ledgers below hold other files'
// lines verbatim, and the stale-entry arm already requires each of those texts to still be a
// line in the file it names; reading them a second time as claims of their own would make the
// ledger fail for containing what it excuses. So the skip is per LINE and only while the line
// still carries a ledgered text — a bounded blind spot rather than a whole unread file. The one
// count here that is not a quotation is the incident in the paragraph above, and it is ledgered
// by name like any other. Found the hard way twice: the first version was written, mutated and
// proved green while still UNTRACKED, so `git ls-files` never handed it to its own sweep and it
// went red the moment it was committed; the second excluded itself wholesale and hid twelve
// lines in the one file a reader opens for the explanation.
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
    const word = text
        .toLowerCase()
        .replace(/[,\u202f]/g, '')
        .replace(/\s+/g, '-');
    if (/^\d+$/.test(word)) return Number(word);
    const [tens, ones] = word.split('-');
    if (tens in TENS) return TENS[tens] + (ones ? ONES.indexOf(ones) : 0);
    return ONES.indexOf(word);
};

/** A backtick, written as an escape so this file's own nouns are not mistaken for template holes. */
const TICK = String.raw`\x60?`;

/**
 * The four counts. `plain` is a spelling that can only be this corpus, and is swept over the
 * WHOLE tree; `loose` is a spelling that names a dozen other things (bare `rules` in a lint
 * registry, `fixtures` in a test suite) and is swept only where the file is about this corpus.
 * Two tiers because one tier has to choose between missing a count in a file that never says
 * "Blueprint" and reporting every lint rule in the repository — and an adversarial pass walked
 * a stale count through a `.blp` comment under `templates/` on exactly that gap.
 *
 * Every measurement is its own listing: none is derived from another, which is what lets the
 * partition below be a claim rather than an identity.
 */
const CATEGORIES = {
    rules: {
        label: 'rule file',
        plain: String.raw`(?:blueprint\s+|written\s+|corpus\s+)?rule\s+(?:files?|goldens?|cases?)|(?:blueprint|written|corpus)\s+rules?`,
        loose: String.raw`rules?`,
        measure: (tree) => tree.lsFiles(`${CORPUS}/rules/*.blp`).length,
    },
    probes: {
        label: 'reality probe',
        plain: String.raw`reality[-\s]probes?|reality-probe\s+goldens?|(?:real|shipped)\s+${TICK}\.blp${TICK}`,
        loose: String.raw`probes?|real(?:ity)?\s+files?|${TICK}\.blp${TICK}\s+files?`,
        measure: (tree) => tree.lsFiles('*.blp').filter((path) => !path.startsWith(`${CORPUS}/`)).length,
    },
    goldens: {
        label: 'golden',
        plain: String.raw`corpus\s+(?:files?|goldens?)|${TICK}\.ui${TICK}\s+goldens?`,
        loose: String.raw`goldens?|fixtures?|${TICK}\.ui${TICK}\s+files?`,
        measure: (tree) => tree.lsFiles(`${CORPUS}/*/*.ui`).length,
    },
    refusals: {
        label: 'refusal',
        plain: String.raw`refused\s+(?:${TICK}\.blp${TICK}|files?)(?:\s+files?)?|refusal\s+files?|negative\s+cases?`,
        loose: String.raw`refusals?`,
        measure: (tree) => tree.lsFiles(`${CORPUS}/refused/*.blp`).length,
    },
};

/** This script. Its ledger quotations are skipped line by line — see the header for why. */
const SELF = 'scripts/check-blueprint-corpus-counts.mjs';

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
        file: `${CORPUS}/manifest.mjs`,
        text: '* header records at "25 rules". The gate counts the list; a reader who needs the number',
        why: "the same incident, quoted as the other gate's header carries it",
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
        file: 'docs/adr/0060-what-the-cli-borrows-from-yarn.md',
        text: '**Cost, honestly:** small but not zero. One rule file, plus a decision about `scope`',
        why: "a `@gjsify/manifest-conformance` rule file — the registry's unit of work, not the corpus's",
    },
    {
        file: 'packages/infra/blueprint/src/emit-xml.mjs',
        text: '* point at are load-bearing) are three files that would otherwise collapse into one rule.',
        why: 'a rule of the LANGUAGE, which is what a corpus file isolates rather than how many exist',
    },
    {
        file: SELF,
        text: '// corrected the counts in `status/open-todos.md`, and #1700 added three rule files and four',
        why: 'what #1700 added, which is the incident — the only count in this file that is not a quotation',
    },
];

/**
 * Binary by extension — a shortcut for the common cases, not the rule. The rule is the NUL-byte
 * test at the read, so an extension nobody listed is SWEPT rather than skipped. The first
 * version of this file had an allow-list of extensions, which is the same shape as an
 * allow-list of nouns and failed the same way: `.sh`, `.py`, `.rs`, `.html`, `.xml`, `.svg`,
 * `.po`, `.rst`, `.jsonc` and an extensionless `NOTES` each carried a stale count straight
 * through it.
 */
const BINARY_EXT =
    /\.(?:png|jpe?g|gif|webp|avif|ico|icns|bmp|tiff?|woff2?|ttf|otf|eot|zip|gz|tgz|bz2|xz|zst|7z|rar|tar|pdf|mp[34]|m4[av]|webm|ogg|oga|wav|flac|mov|avi|so|dylib|dll|exe|node|wasm|class|jar|bin|dat|db|sqlite3?|gresource|compiled|typelib|mpd|pyc)$/i;

/**
 * Where the LOOSE spellings are read: inside the package that IS the corpus, or in a file whose
 * PATH names it. Nowhere else, and the boundary is a measurement rather than a preference —
 * reading `rules`, `probes`, `goldens` and `fixtures` wherever a file merely MENTIONS the corpus
 * turns `status/open-todos.md`, a seven-thousand-line repo-wide ledger, into sixty findings that
 * are e2e fixtures and lint rules. The PLAIN spellings ignore this entirely and are swept over
 * the whole tree, so the arm that catches "the file nobody thought to look in" is unconditional
 * for every spelling that can only mean this corpus. That arm earned its keep on the first run:
 * `.gitattributes` said eleven `.blp` under `showcases/` and `templates/` where the tree held
 * twelve, in a file no reviewer of a corpus change would ever open.
 */
const CORPUS_OWN_FILES = /^packages\/infra\/blueprint\/|blueprint[\s\-_/]*corpus|corpus[\s\-_/]*blueprint/i;

/**
 * Every claim in a whole file, scanned ACROSS line ends and reported against the line the
 * number falls on. Markdown here is hard-wrapped at about ninety columns, which splits a
 * claim as often as not: the sentence this gate was written for says "and the 19" at the end
 * of one line and "refusals" at the start of the next. A line-at-a-time sweep reads that file
 * as stating no refusal count at all — green, and blind to the exact claim that went stale
 * twice.
 */
/**
 * What may sit between the number and its noun: whitespace at any indent, a hard wrap, a blank
 * line, a markdown table pipe, emphasis marks, a backtick. Never a word, so the gap cannot
 * swallow "N of the M real files" into a claim. It was three characters wide once, and a
 * markdown table cell and a four-space continuation indent both walked through that. One pipe
 * and not two, because `line < 1 || refusal.line` is code and a table cell is not.
 */
const GAP = String.raw`[\s\x60*_]{0,8}\|?[\s\x60*_]{0,8}`;

function claimsIn(text, { loose }) {
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
    for (const [key, category] of Object.entries(CATEGORIES)) {
        const noun = loose ? `${category.plain}|${category.loose}` : category.plain;
        const re = new RegExp(String.raw`\b(${NUMBER_WORD}|\d[\d,\u202f]*)\b${GAP}(?:${noun})\b`, 'gi');
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
    // `-s` because a plain listing hands back gitlinks too — the five reference pools under
    // `refs/` are other people's repositories, and `readFileSync` on one answers EISDIR.
    // Symlinks stay in: one that points at a file is read through, and one that does not is
    // skipped at the read below with its errno named.
    const files = git(['ls-files', '-s'])
        .map((row) => ({ mode: row.slice(0, 6), path: row.slice(row.indexOf('\t') + 1) }))
        .filter(({ mode }) => mode !== '160000')
        .map(({ path }) => path);
    return { counts, files, manifest: { CORPUS_RULES, CORPUS_REAL_FILES, CORPUS_REFUSALS } };
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

    // Every line of every ledger, so this file's own quotations can be skipped ONE LINE AT A
    // TIME. Skipping the whole file was an unbounded blind spot in the one place a reader comes
    // for the explanation; this is bounded by construction — a line is skipped only while it
    // still carries a text the stale-entry arm below is already holding to a line elsewhere.
    const quotations = [...DATED_LINES, ...OTHER_SUBJECT].map((entry) => entry.text);

    for (const file of tree.files) {
        if (BINARY_EXT.test(file)) continue;
        let text;
        try {
            text = readFileSync(join(root, file), 'utf8');
        } catch (error) {
            // A tracked path that is not a readable file: a symlink to a directory, or one
            // whose target is gone. Nothing to sweep, and not this gate's business to fail on.
            if (['EISDIR', 'ELOOP', 'ENOENT', 'EACCES'].includes(error.code)) continue;
            console.error(`check-blueprint-corpus-counts: cannot read ${file}: ${error.message}`);
            return process.exit(2);
        }
        // Binary by content, which is the rule the extension list above only shortcuts.
        if (text.includes('\u0000')) continue;
        const loose = CORPUS_OWN_FILES.test(file);
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
        for (const claim of claimsIn(text, { loose })) {
            const trimmed = lines[claim.line].trim();
            const ledgered = [...DATED_LINES, ...OTHER_SUBJECT].find(
                (entry) => entry.file === file && entry.text === trimmed,
            );
            if (ledgered) {
                usedLedger.add(`line\u0000${file}\u0000${ledgered.text}`);
                continue;
            }
            // Only after the exact-match arm, or an entry recorded against a line OF this file
            // would be skipped here and then report itself stale below.
            if (file === SELF && quotations.some((quoted) => trimmed.includes(quoted))) continue;
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
