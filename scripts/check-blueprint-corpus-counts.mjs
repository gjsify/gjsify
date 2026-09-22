#!/usr/bin/env node
// Every Blueprint corpus count stated in live documentation is the count this tree holds.
//
// WHY THIS EXISTS. The corpus sizes — rule files, reality probes, goldens, refusals — are
// restated in prose in several files. Nothing held them to the tree, so every corpus change
// invalidated them in silence. It failed twice in one day: #1698 corrected the counts in
// `status/open-todos.md`, and #1700 added rule files and refusals hours later and left every
// one of them wrong again. #1698 built exactly this gate one file over, for ADR 0053's census;
// this is the same class, and a gate is the only difference between a rule and a preference.
//
// THE NUMBERS ARE MEASURED, NEVER TRANSCRIBED. Each count comes from its own listing in the
// tree, and the fix for a failure here is to re-run the harness and write down what it prints —
// never to edit a digit until the message stops. Editing a digit is how the wrong count got
// there both times.
//
// FIVE VERDICTS, AND EVERY LINE THAT STATES A COUNT GETS ONE.
//
//   LIVE      — `SITES`: every count in the file must equal the tree, and the file must still
//               STATE each count it is listed for. A document that answers a stale number by
//               deleting the sentence has not been corrected, it has been emptied, so a missing
//               claim fails as loudly as a wrong one.
//   SNAPSHOT  — `SNAPSHOTS`: a file whose numbers are a measurement over the tree it was taken
//               against. Scanned like any other, and held to a DIGEST of the lines that stated
//               a count when the entry was written, so a line added to a dated document — which
//               is not itself dated — has to be re-justified. A whole-file skip made exactly
//               that invisible.
//   DATED     — `DATED_LINES`: one line inside a LIVE file whose number is an incident or a
//               quotation rather than a claim about any tree.
//   HISTORY   — `HISTORICAL_LINES`: one line recording what an EVENT made true — "#1694 took the
//               corpus to 47". Not live and not a dated measurement: its anchor is a merged PR,
//               not a revision someone measured at. The entry is written by hand AND the line
//               must NAME the event, so it cannot wave through an unanchored number. Counted
//               apart in the summary for the same reason reports are.
//   ELSEWHERE — `OTHER_SUBJECT`: a FALSE READING — the nouns match something that is not a count
//               at all. Records the whole line by default; for prose too long to re-read, the
//               matched PHRASE instead, which then fails if the file holds a second claim
//               reading the same words. Never a way to excuse a real count.
//   OWNED     — `OWNED_ELSEWHERE`: a file another gate holds to a stricter contract. The entry
//               names that script, fails when it leaves the tree, and is counted SEPARATELY in
//               the summary rather than inside the scanned total.
//   REPORT    — a file under `docs/reports/` whose PREAMBLE anchors it to a base commit. Its
//               numbers were true of the tree it measured and keeping them current would
//               falsify it. The anchor is the condition, not the directory: a report with no
//               base commit is undated prose and is gated like anything else. Counted apart,
//               with the number of counts it leaves unread, because coverage this gate does
//               not have is a fact about the gate.
//
// Both ledgers hold the line's exact text, so editing or deleting the line retires the entry
// instead of silently widening it, and an entry that matches nothing is itself a failure.
//
// AN UNUSED LEDGER ENTRY IS A CHECK, not bookkeeping, and that is not obvious. It says one of
// two things: the line moved, or the line never stated anything to excuse. The second is how
// the `$extern` record was found — its first wording, "took the rules to" a number, reads as
// nothing at all, because `to` is not one of the words that link a noun to its count. The entry
// went unused, the gate said so, and the sentence was respelled to name what it counts. A
// ledger that only ever grows would have called that sentence gated while it stated nothing.
// Anything else that states a count fails as UNGATED — the arm that catches the file nobody
// thought to look in, which is why the sweep reads the tree rather than a list of documents.
// That arm earned its keep on its first run: `.gitattributes` said eleven `.blp` under
// `showcases/` and `templates/` where the tree held twelve.
//
// WHAT INPUT MAKES EACH CHECK FAIL, asked of every one of them because #1698 shipped an
// assertion that could not fail: a digit, a spelled-out number or a thousands-separated one
// moved in a live file; a live file that stops stating a count it owns; a count appearing in
// any tracked file with no verdict; a line with a count added to a dated one; a ledger entry
// whose line no longer reads as recorded; and a corpus that grows or shrinks by one file, which
// moves the tree side of every comparison at once. `rules + probes === goldens` is a claim
// about three independent listings — `corpus/rules/*.blp`, tracked `.blp` minus the corpus, and
// `corpus/*/*.ui` — and no term of it is computed from the others, so the sum can be false. The
// manifest cross-checks have the same shape: the list and the directory are read separately.
//
// WHAT IS READ, EXACTLY — because an arm that promises more than it does is this gate's own
// failure class, one level up, and this paragraph has been wrong before. EVERY tracked file is
// opened: no allow-list of extensions and no deny-list either (an adversarial pass walked a
// stale count through `.sh`, `.py`, `.rs`, `.html`, `.xml`, `.svg`, `.po`, `.rst`, `.jsonc` and
// an extensionless `NOTES` past the allow-list, then through `.mpd` past the deny-list). Binary
// is decided by a NUL byte in the bytes, with nothing in front of it. Gitlinks are dropped by
// mode: the five reference pools under `refs/` are other people's repositories. Two kinds of
// file are then NOT scanned here, and the summary names each rather than folding it into the
// total — files that are not text, dated reports (with the count of what goes unread in them),
// and the one handed to `check-blueprint-census.mjs`, which reads it through the same
// vocabulary this file does. A "swept" number that includes files nothing was looked for in is
// the same lie as a green that checked nothing.
//
// WHERE A CLAIM IS FOUND, and in which spellings, is `blueprint-count-claims.mjs` — shared with
// `check-blueprint-census.mjs`, because the seam between two gates with two vocabularies over
// one file was itself a hole. In short: both orders — a count before its noun and a noun with
// its count after, which is what a table writes — across line ends because this repo hard-wraps,
// plain
// spellings everywhere and loose ones only in regions about this corpus. The cost of that last
// boundary is stated rather than hidden — a bare "rules" count outside such a region is not
// seen, which is why the live documents here were moved to the unambiguous spelling instead of
// being excused. A number with no noun near it at all ("42 of 42 byte-equal") is outside the
// sweep; `corpus/divergences.mjs` carried exactly that and now states no count.
//
// THIS FILE IS SCANNED LIKE ANY OTHER, MINUS THE BYTES IT QUOTES. The ledgers below hold other
// files' lines verbatim, and the stale-entry arm already holds each of those texts to a line in
// the file it names; reading them again here would make the ledger fail for containing what it
// excuses. So each quoted text is BLANKED, in place, before this file is scanned — the rest of
// every line is read exactly as it would be anywhere else, because `line.includes(quoted)` let
// a live count appended to a declaration ride along behind the text it quotes. Found the hard
// way three times: the first version was proved green while still UNTRACKED, so `git ls-files`
// never handed it to its own sweep and it went red the moment it was committed; the second
// excluded itself wholesale and hid twelve lines in the one file a reader opens for the
// explanation; the third skipped whole lines and hid whatever was appended to them.
//
// ADR 0053 IS OWNED BY `check-blueprint-census.mjs`, which holds it to a stricter contract: its
// census section is EMITTED, and a count stated anywhere else in that ADR is refused outright
// rather than compared. One file, one gate, or one failure gets two fixes — and since that gate
// now finds claims through the same module, the ownership is a division of labour rather than a
// second vocabulary with a hole between them.
//
// In CI this runs in `tree-checks`, beside `check-blueprint-census.mjs`: the one job with no
// classifier gate, so a docs-only PR runs it — and a docs-only PR is precisely the one that
// edits these sentences.
//
// Usage: node scripts/check-blueprint-corpus-counts.mjs [--root <dir>]
// Exits 0 when the documents agree with the tree, 1 when they drift, 2 on a usage or read error.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CATEGORIES, findClaims, looseRegions, readText } from './blueprint-count-claims.mjs';

const CORPUS = 'packages/infra/blueprint/corpus';

/** How a reader is told to re-measure, printed with every failure. */
const MEASURE_WITH = 'node scripts/check-blueprint-corpus.mjs';

/**
 * How the TREE answers each count. The spellings that STATE one live in
 * `blueprint-count-claims.mjs`, shared with `check-blueprint-census.mjs`; what is here is the
 * measurement. Every one is its own listing — none is derived from another, which is what lets
 * the partition below be a claim rather than an identity.
 */
const MEASURE = {
    rules: (tree) => tree.lsFiles(`${CORPUS}/rules/*.blp`).length,
    probes: (tree) => tree.lsFiles('*.blp').filter((path) => !path.startsWith(`${CORPUS}/`)).length,
    goldens: (tree) => tree.lsFiles(`${CORPUS}/*/*.ui`).length,
    refusals: (tree) => tree.lsFiles(`${CORPUS}/refused/*.blp`).length,
};

/**
 * A REPORT is a measurement, and keeping its numbers current would falsify it: an event date
 * must be right, a measurement date must not move. But the directory does not make it one — a
 * file under `docs/reports/` that states no base commit is undated prose wearing a
 * measurement's clothes, and it is gated like anything else. The ANCHOR is the condition, and
 * it has to be in the preamble where a reader meets it, not buried on line four hundred.
 *
 * Accepted: "Measured at `<sha>`", "read at `<sha>`", "re-measured against `<sha>`", seven to
 * forty hex digits, within the first twenty lines. `docs/reports/2026-09-16-blueprint-subset-
 * gap.md` opens with exactly that and states the corpus size six times; without this rule its
 * arrival turns the gate red on a document that is right about the tree it measured.
 *
 * SAMPLE SIZE OF ONE, said out loud because the next person to add a report inherits it. A
 * survey of every base-commit anchor in the tree found six files carrying one somewhere and NOT
 * ONE carrying it in a preamble — that report will be the first. So this shape is load-bearing
 * rather than observed: a report that anchors itself further down, or in another spelling, is
 * gated as live prose and the fix is to move its anchor up, not to widen this pattern until it
 * matches whatever was written.
 */
const REPORT = /^docs\/reports\//;
const REPORT_ANCHOR = /\b(?:measured|read|re-measured)\s+(?:at|against)\s+`?[0-9a-f]{7,40}`?/i;
const isDatedReport = (file, text) => REPORT.test(file) && REPORT_ANCHOR.test(text.split('\n').slice(0, 20).join('\n'));

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
 * Files whose numbers are a measurement over the tree they were taken against. A decision record
 * states what was true when the decision was taken; correcting it to today would destroy the
 * evidence the decision rests on.
 *
 * `claims` is a digest of the lines that stated a count when the entry was written — sorted,
 * de-duplicated, sha256, first sixteen hex digits. It is what makes this per LINE rather than a
 * whole-file skip: a line ADDED to a dated document is not itself dated, and until the digest
 * existed a fresh live count appended to either ADR was invisible. The failure prints every
 * counted line, so re-justifying is reading them rather than trusting a hash.
 */
const SNAPSHOTS = [
    {
        file: 'docs/adr/0058-translatable-marking-gets-a-spelling.md',
        claims: 'c51004f9266df25e',
        why: 'its § Context says in as many words to read the numbers "as a date, not as a constant" and tells the reader to re-derive rather than reconcile',
    },
    {
        file: 'docs/adr/0062-the-blueprint-conversion-frontier-is-composition.md',
        claims: 'a9a9c5dcff806020',
        why: "a dated re-derivation of 0058's census, with a § Method naming the revision, the compiler and the `@girs` pin it was taken under",
    },
    {
        file: 'docs/adr/0066-composition-gets-a-spelling-template-and-object-id.md',
        claims: '643b82776b3aa6a4',
        why: 'its before/after table is the measurement that justified the decision, taken at the revision the record names — a later corpus file moves the live count and must not silently rewrite the evidence the decision was made on',
    },
    {
        file: 'docs/adr/0068-style-classes-get-a-field-both-spellings.md',
        claims: '42bb6b46f547e442',
        why: 'the same shape one decision further: its per-kind loss table and its before/after pair are two readings of one tree taken around the change, at the revision its § How the numbers here were obtained names, and a later corpus file must not silently rewrite the evidence the decision rests on',
    },
    {
        file: 'docs/adr/0067-the-translatable-marking-becomes-a-field.md',
        claims: 'e5bfbd579c5d9937',
        why: 'the same shape one decision later, and for the same reason: its tables are two readings of one tree taken before and after the change, and its § How the numbers here were obtained says to read every count as a date',
    },
    {
        file: 'docs/adr/0070-a-blp-reaches-a-renderer-through-a-second-specifier.md',
        claims: 'c2342e6834c38840',
        why: "its § How the numbers here were obtained names the revision, the oracle version and the `@girs` pin it was taken under, and says in as many words to read every count as a date — the table is a re-derivation of ADR 0067's, cited as the evidence the decision was taken on rather than as a claim about any later tree",
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

/**
 * A HISTORICAL RECORD: what an EVENT made true, not what the tree holds. "#1694 took the corpus
 * to 47" is neither a live claim nor a dated measurement — re-deriving it from today's tree
 * would turn a record into a fiction, and anchoring it to a base commit would be wrong too,
 * because its anchor is a merged PR and not a revision anyone measured at.
 *
 * Two conditions, and it needs both. A human writes the entry, so nothing is excused by
 * accident; AND the line must NAME its event — a `#NNNN` or a commit sha — so the entry cannot
 * be used to wave through a number with no anchor at all. A tense test was considered and
 * refused: "took" against "holds" is right until somebody writes "the corpus holds 47 since
 * #1694", and a rule that fails on the first sentence that mixes the two is not a rule.
 */
const EVENT_REF = /#\d{2,5}\b|\b[0-9a-f]{7,40}\b/;

const HISTORICAL_LINES = [
    {
        file: 'status/open-todos.md',
        text: '#1694 took the corpus to 35 rule files and 47 corpus files, which records what that PR did',
        why: 'what #1694 took the corpus to, named on the line; the totals now are measured a paragraph above',
    },
];

/**
 * A line matching the nouns while counting something else entirely — a FALSE READING, never a
 * real count someone would rather not keep current. That distinction is the whole licence for
 * this ledger, and `why` has to carry it: say what the number DOES count, not that it is
 * excused. "Counts rules of the language, not corpus files" is the shape; "known false
 * positive" is not. Presence and substance are different things and only the first is checked
 * here — what the sentence has to SAY is a review property, and this gate cannot read it.
 *
 * TWO FORMS, AND THE WHOLE-LINE ONE IS THE DEFAULT. `text` records the entire trimmed line, so
 * editing the line retires the entry: nothing is excused that a human has not looked at since.
 * `claim` records only the matched phrase, and exists for a line too long for that to mean
 * anything — `corpus/manifest.mjs` carries eight-hundred-character prose strings, and pasting
 * one into this ledger would guarantee that the next person to reword it pastes the new eight
 * hundred characters without reading them. That is a rubber stamp with ceremony, which is the
 * shape this gate exists to refuse.
 *
 * The narrow form is safe only because of the guard below: a `claim` entry FAILS when its file
 * holds more than one claim matching that phrase, so it cannot quietly grow to cover a second
 * one. A narrow form without that is a substring match wearing a schema.
 *
 * If `claim` entries ever outnumber `text` ones, the finding is not about the documents — it is
 * that the matcher has become too eager, and the nouns want narrowing rather than the ledger
 * growing.
 */
const OTHER_SUBJECT = [
    {
        file: 'docs/adr/0060-what-the-cli-borrows-from-yarn.md',
        text: '**Cost, honestly:** small but not zero. One rule file, plus a decision about `scope`',
        why: "a `@gjsify/manifest-conformance` rule file — the registry's unit of work, not the corpus's",
    },
    {
        // The narrow form, because the whole line is 844 characters of prose and a ledger entry
        // nobody re-reads is not a record. One phrase, and the gate refuses it the moment this
        // file holds a second claim reading the same two words.
        file: 'packages/infra/blueprint/corpus/manifest.mjs',
        claim: 'two rules',
        why: 'the two rules of the LANGUAGE that golden tells apart — a namespace whose C identifier prefix IS its name, and one whose is not — the same subject as the `emit-xml.mjs` entry below and never a count of corpus files',
    },
    {
        file: 'packages/infra/blueprint/src/emit-xml.mjs',
        text: '* point at are load-bearing) are three files that would otherwise collapse into one rule.',
        why: 'a rule of the LANGUAGE, which is what a corpus file isolates rather than how many exist',
    },
];

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
    const counts = Object.fromEntries(Object.entries(MEASURE).map(([key, measure]) => [key, measure(ctx)]));
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
    const snapshotClaims = new Map();
    const scanned = [];
    const notText = [];
    const reports = [];
    const widening = [];
    let historical = 0;

    // Quotations of OTHER files' lines, blanked out of this file before it is scanned. Not
    // `line.includes(quoted)`: that skipped the whole line, so a live count appended to a
    // ledger declaration rode along behind the text it quotes. Blanking keeps every byte's
    // offset, so the remainder of the line is scanned exactly as it would be anywhere else: a
    // count APPENDED to a declaration line is read like any other, and only the quoted bytes
    // are silent. This file therefore states no count of its own — its header writes the
    // incident without digits rather than earning an exemption for it.
    const quotations = [...DATED_LINES, ...HISTORICAL_LINES, ...OTHER_SUBJECT]
        .flatMap((entry) => [entry.text, entry.claim])
        .filter(Boolean);
    const mask = (text) => quotations.reduce((out, quoted) => out.split(quoted).join(' '.repeat(quoted.length)), text);

    for (const file of tree.files) {
        const text = readText(join(root, file));
        // Not text at all: a NUL byte in the bytes, a symlink to a directory, a vanished
        // target. Counted and named in the summary, never folded into "swept".
        if (text === null) {
            notText.push(file);
            continue;
        }
        const owned = OWNED_ELSEWHERE.find((entry) => entry.file === file);
        if (owned) {
            usedLedger.add(`owned\u0000${file}`);
            continue;
        }

        const claims = findClaims(file === SELF ? mask(text) : text, looseRegions(file, text));
        // Counted apart from `scanned`, and with the number of counts it leaves unread, because
        // coverage this gate does not have is a fact about the gate. Folding it into the scanned
        // total would repeat the mistake the header made once already.
        if (isDatedReport(file, text)) {
            reports.push({ file, unread: claims.length });
            continue;
        }
        scanned.push(file);
        const lines = text.split('\n');
        const snapshot = SNAPSHOTS.find((entry) => entry.file === file);
        if (snapshot) {
            usedLedger.add(`snapshot\u0000${file}`);
            snapshotClaims.set(file, [...new Set(claims.map((claim) => lines[claim.line].trim()))]);
            continue;
        }

        // The guard that makes the narrow form safe: one phrase, one claim. A second reading of
        // the same words in the same file would otherwise be covered by an entry nobody wrote
        // for it, which is a substring match wearing a schema.
        for (const entry of OTHER_SUBJECT.filter((e) => e.file === file && e.claim)) {
            const matching = claims.filter((c) => c.text.toLowerCase() === entry.claim.toLowerCase());
            if (matching.length > 1) {
                widening.push(
                    `${file} holds ${matching.length} claims reading "${entry.claim}" and the ledger excuses\n` +
                        `    that phrase once (line(s) ${matching.map((c) => c.line + 1).join(', ')}). Record the whole\n` +
                        '    line for each, or narrow the noun that reads them — one entry may not cover two claims.',
                );
            }
        }

        const site = SITES.find((entry) => entry.file === file);
        for (const claim of claims) {
            const trimmed = lines[claim.line].trim();
            const ledgered = [...DATED_LINES, ...HISTORICAL_LINES, ...OTHER_SUBJECT].find(
                (entry) =>
                    entry.file === file &&
                    (entry.text === trimmed || (entry.claim && entry.claim.toLowerCase() === claim.text.toLowerCase())),
            );
            if (ledgered) {
                usedLedger.add(`line\u0000${file}\u0000${ledgered.text ?? ledgered.claim}`);
                if (HISTORICAL_LINES.includes(ledgered)) historical += 1;
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

    const problems = [...treeSelfChecks(tree), ...widening];

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

    for (const entry of HISTORICAL_LINES) {
        if (!EVENT_REF.test(entry.text)) {
            problems.push(
                `a HISTORICAL entry for ${entry.file} names no event on the line it records — a record of\n` +
                    '    what a PR made true has to say which PR, or it is an ungated number with a ledger\n' +
                    `    entry in front of it:\n      ${entry.text}`,
            );
        }
    }
    for (const entry of [...DATED_LINES, ...HISTORICAL_LINES, ...OTHER_SUBJECT]) {
        if (Boolean(entry.text) === Boolean(entry.claim)) {
            problems.push(
                `a ledger entry for ${entry.file} records ${entry.text ? 'both' : 'neither'} a whole line and a\n` +
                    '    phrase — it takes exactly one: `text` by default, `claim` only for a line too long to read.',
            );
            continue;
        }
        if ((entry.why ?? '').trim().length < 20) {
            problems.push(
                `a ledger entry for ${entry.file} has no reason worth reading. Say what the number DOES\n` +
                    '    count, not that it is excused.',
            );
        }
        if (!usedLedger.has(`line\u0000${entry.file}\u0000${entry.text ?? entry.claim}`)) {
            problems.push(
                `a ledger entry for ${entry.file} matches no line any more — re-justify it or remove it:\n` +
                    `    recorded: ${entry.text ?? entry.claim}\n` +
                    `    because:  ${entry.why}`,
            );
        }
    }
    for (const entry of SNAPSHOTS) {
        if (!usedLedger.has(`snapshot\u0000${entry.file}`)) {
            problems.push(
                `\`SNAPSHOTS\` names ${entry.file}, which the sweep never reached — the entry is dead weight`,
            );
            continue;
        }
        // A snapshot is dated as a WHOLE, and a line appended to it tomorrow is not. So the
        // entry records which lines carried a count when it was written, and any change to that
        // set — one added, one edited, one removed — has to be re-justified. The first version
        // skipped these files outright, which made a fresh live count in a decision record
        // invisible: the same unbounded blind spot as excluding this script wholesale.
        const now = snapshotClaims.get(entry.file) ?? [];
        const digest = createHash('sha256')
            .update([...now].sort().join('\n'))
            .digest('hex')
            .slice(0, 16);
        if (digest !== entry.claims) {
            problems.push(
                `${entry.file} is a SNAPSHOT and its counted lines have changed — ${now.length} line(s) now\n` +
                    `    state a count, digest ${digest}, where the entry was written against ${entry.claims}.\n` +
                    '    A line added to a dated document is not itself dated. Re-read them, then either\n' +
                    '    move the new one to a live document or record the new digest:\n' +
                    now.map((line) => `      ${line}`).join('\n'),
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
    // Every number here is what it says: `scanned` counts files a claim was actually looked for
    // in, and the two others are named rather than folded into it. A "swept" total that counts
    // files nothing was looked for in is the same lie as a green that checked nothing.
    const unread = reports.reduce((n, report) => n + report.unread, 0);
    console.log(
        `check-blueprint-corpus-counts: ${scanned.length} file(s) scanned, ${notText.length} not text, ` +
            `${reports.length} dated report(s) holding ${unread} unread count(s), ` +
            `${historical} historical count(s), ` +
            `${OWNED_ELSEWHERE.length} handed to ${OWNED_ELSEWHERE.map((entry) => entry.by).join(', ')}; ` +
            `every stated count is the tree's — ${summary}.`,
    );
    return process.exit(0);
}

// `import.meta.main` is not available on every Node this repo's CI still runs.
if (process.argv[1] && process.argv[1].endsWith('check-blueprint-corpus-counts.mjs')) await main();
