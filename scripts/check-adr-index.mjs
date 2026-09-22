#!/usr/bin/env node
// Every ADR on disk is in the index, and every index row describes it correctly.
//
// THE INCIDENT
//
// `0017-native-package-distribution.md` sat on disk, load-bearing (the platform-package
// split that `generate-platform-packages.mjs`, the `platform-packages` conformance rule
// and `commit-prebuilds` all implement) and ABSENT from the index table in
// docs/adr/README.md, because nothing compared the two. The mirror-image cost landed the
// same session: an agent reading a pre-fix checkout filed an issue asserting 0018 did not
// exist, hours after it had. An index nobody checks omits what exists and is trusted anyway.
//
// WHAT IT CHECKS, four directions
//
//   1. an ADR file on disk with no index row              → FAIL (the incident)
//   2. an index row whose file does not exist             → FAIL (stale row)
//   3. a row whose Status disagrees with the file's own   → FAIL (second copy drifting)
//   4. a Status outside the vocabulary README declares    → FAIL
//   5. two ADR FILES claiming the same number             → FAIL (the second incident)
//   6. two index ROWS claiming the same number            → FAIL
//   7. an ADR whose own `# NN.` heading is not its number → FAIL
//
// (3) pays off repeatedly: the index Status column copies each ADR's own
// `- **Status:**` line, so promoting Proposed → Accepted touches two files and
// forgetting the second is silent today.
//
// THE SECOND INCIDENT — why (5), (6) and (7) exist
//
// The ADR number is a COUNTER SHARED ACROSS OPEN BRANCHES, and nothing hands it out.
// Four parallel branches each read `docs/adr/` on the day they were cut, each took the
// next free number, and every one of them was right at the time. The collision is created
// by the first MERGE, not by the branch: on 2026-09-22 three landed at once — 0067 twice,
// 0068 twice, 0069 twice — and every one was found by a human reading a rebase conflict in
// this index. Two of them would have merged clean had the conflict fallen elsewhere.
//
// This check cannot prevent that: it sees one branch, and the other number does not exist
// yet in this tree. What it CAN do is refuse the state that results — two files, or two
// rows, wearing one number — so a rebase that merges the table without noticing is caught
// before the push rather than by the next reader.
//
// (6) needed a shape change. The rows were parsed into a `Map` keyed by number, which made
// a duplicate row OVERWRITE the first and disappear; the check that was supposed to see the
// collision was the thing hiding it. Rows are collected as a list now and the Map is built
// afterwards, from a list that has been checked for duplicates.
//
// (7) is the renaming half. A number is carried in three places — the FILENAME, the index
// ROW, and the document's own `# NN. Title` heading — and `git mv` moves exactly one of
// them. Renumbering a branch to resolve a collision is precisely when the heading is left
// behind, so the check that guards the collision also guards its repair.
//
// Usage: node scripts/check-adr-index.mjs [--root <dir>]

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const rootIndex = args.indexOf('--root');
const ROOT = rootIndex === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..') : args[rootIndex + 1];

const ADR_DIR = join(ROOT, 'docs', 'adr');
const INDEX = join(ADR_DIR, 'README.md');

/** The statuses docs/adr/README.md § Format declares. `Superseded by NNNN` carries a number. */
const STATUS_PATTERN = /^(Proposed|Accepted|Rejected|Superseded by \d{4})$/;

function fail(lines) {
    console.error(`check-adr-index: ${lines.join('\n  ')}`);
    process.exit(1);
}

let indexText;
try {
    indexText = readFileSync(INDEX, 'utf8');
} catch (error) {
    fail([`cannot read ${INDEX}: ${error.message}`]);
}

/** ADR files on disk: NNNN-<slug>.md, excluding README.md. */
let onDisk;
try {
    onDisk = readdirSync(ADR_DIR)
        .filter((name) => /^\d{4}-.+\.md$/.test(name))
        .sort();
} catch (error) {
    fail([`cannot read ${ADR_DIR}: ${error.message}`]);
}
if (onDisk.length === 0) fail([`no ADR files under ${ADR_DIR} — the check is measuring nothing.`]);

/**
 * Index rows: | [NNNN](file.md) | Title | Status |
 *
 * Collected as a LIST first. Keying a Map by the number while parsing is what let a
 * duplicate row overwrite its twin and vanish — see (6) in the header.
 */
const parsedRows = [];
for (const line of indexText.split('\n')) {
    const match = line.match(/^\|\s*\[(\d{4})\]\(([^)]+)\)\s*\|(.+)\|([^|]+)\|\s*$/);
    if (match) parsedRows.push({ number: match[1], file: match[2].trim(), status: match[4].trim() });
}
if (parsedRows.length === 0) {
    fail([`no ADR rows parsed from ${INDEX} — the table shape changed, so this check is blind.`]);
}
const rows = new Map(parsedRows.map((row) => [row.number, row]));

/**
 * The status an ADR declares about ITSELF. Three header shapes exist in the tree and all
 * three are legitimate MADR (`## Status` section, `- Status:` bullet, `- **Status:**`
 * bullet with the date inline); this compares the CLAIM, not the formatting, rather than
 * failing settled documents over layout.
 */
function declaredStatus(file) {
    const text = readFileSync(join(ADR_DIR, file), 'utf8');
    const bullet = text.match(/^-\s*(?:\*\*)?Status:?(?:\*\*)?:?\s*(.+)$/m);
    const section = text.match(/^##\s*Status\s*$\n+(.+)$/m);
    const raw = bullet?.[1] ?? section?.[1];
    if (raw === undefined) return null;
    // The status is the LEADING token: several ADRs qualify it in the same line with a
    // date, an amendment pointer or a graduation note, which is prose about the decision
    // rather than a different status.
    const leading = raw
        .replace(/\*\*/g, '')
        .trim()
        .match(/^(Proposed|Accepted|Rejected|Superseded by \d{4})/);
    return leading ? leading[1] : raw.replace(/\*\*/g, '').trim();
}

/**
 * The number an ADR gives ITSELF, in its title heading.
 *
 * Three shapes exist in the tree and all three are in use: `# ADR 0001 — Title`,
 * `# 0064 — Title` and `# 68. Title`. Like {@link declaredStatus}, this compares the CLAIM
 * and not the formatting — measured on the 68 ADRs present, 28 would fail a check written
 * for the newest shape alone, and normalising 28 settled documents to satisfy a numbering
 * check would be a second decision smuggled in behind the first.
 *
 * Returned without leading zeroes: the headings are written `# 7.` and `# 0064 —` while the
 * filenames are always padded to four.
 */
function headingNumber(file) {
    const text = readFileSync(join(ADR_DIR, file), 'utf8');
    const match = text.match(/^#\s*(?:ADR\s+)?(\d{1,4})\s*(?:\.|—|–|-)\s/m);
    return match ? String(Number(match[1])) : null;
}

const problems = [];

// 5. Two FILES wearing one number. Listed together so the message names both — the whole
//    point is that neither is obviously the intruder, and picking one is the author's call.
const byNumber = new Map();
for (const file of onDisk) {
    const number = file.slice(0, 4);
    const seen = byNumber.get(number);
    if (seen) seen.push(file);
    else byNumber.set(number, [file]);
}
for (const [number, files] of [...byNumber].sort()) {
    if (files.length > 1) {
        problems.push(
            `ADR number ${number} is claimed by ${files.length} files: ${files.join(', ')}. ` +
                'The number is a counter shared across open branches and nothing hands it out, so ' +
                'two branches that were each right on the day they were cut collide on the first ' +
                'merge. Renumber the one that has not landed to the next free number, and carry it ' +
                "into the index row and the document's own heading.",
        );
    }
}

// 6. Two ROWS wearing one number — the index half of the same collision, and reachable on
//    its own: a rebase that keeps both table lines leaves the files correct and the index not.
const rowsByNumber = new Map();
for (const row of parsedRows) {
    const seen = rowsByNumber.get(row.number);
    if (seen) seen.push(row.file);
    else rowsByNumber.set(row.number, [row.file]);
}
for (const [number, files] of [...rowsByNumber].sort()) {
    if (files.length > 1) {
        problems.push(
            `docs/adr/README.md has ${files.length} rows for ADR ${number}: ${files.join(', ')}. ` +
                'A merged index table kept both — renumber one and fix its row.',
        );
    }
}

// 1. On disk, no row.
for (const file of onDisk) {
    const number = file.slice(0, 4);
    if (!rows.has(number)) {
        problems.push(
            `docs/adr/${file} has no row in docs/adr/README.md. Add it — an ADR missing from the ` +
                'index is invisible to every reader who trusts the index, which is how 0017 was lost.',
        );
    }
}

for (const [number, row] of [...rows].sort()) {
    // 2. Row, no file.
    if (!existsSync(join(ADR_DIR, row.file))) {
        problems.push(
            `docs/adr/README.md links ADR ${number} to "${row.file}", which does not exist. ` +
                'Fix the link or delete the row.',
        );
        continue;
    }
    if (!row.file.startsWith(number)) {
        problems.push(`docs/adr/README.md row ${number} links to "${row.file}", whose number differs.`);
    }
    // 7. The document's own heading. `git mv` renames the file and nothing else, so a
    //    renumbering leaves this behind — exactly when a collision is being repaired.
    const heading = headingNumber(row.file);
    if (heading === null) {
        problems.push(`docs/adr/${row.file} has no "# NN. Title" heading, so its own number cannot be verified.`);
    } else if (heading !== String(Number(number))) {
        problems.push(
            `docs/adr/${row.file} calls itself ADR ${heading} in its "# " heading, but its filename ` +
                `and index row say ${number}. Renumbering touches three places: the filename, the ` +
                'index row and the heading.',
        );
    }
    // 4. Status vocabulary.
    if (!STATUS_PATTERN.test(row.status)) {
        problems.push(
            `docs/adr/README.md row ${number} has status "${row.status}", which is not one of ` +
                'Proposed / Accepted / Rejected / "Superseded by NNNN" (§ Format).',
        );
    }
    // 3. Row status vs the ADR's own.
    const own = declaredStatus(row.file);
    if (own === null) {
        problems.push(`docs/adr/${row.file} has no "- **Status:**" line, so the index row cannot be verified.`);
    } else if (own !== row.status) {
        problems.push(
            `ADR ${number}: docs/adr/README.md says "${row.status}", docs/adr/${row.file} says "${own}". ` +
                "The index Status is a copy of the ADR's own line — update both, or the copy drifts.",
        );
    }
}

if (problems.length > 0) fail(problems);

console.log(
    `check-adr-index: ${onDisk.length} ADR(s) indexed, statuses agree; ${byNumber.size} distinct ` +
        `number(s) across ${onDisk.length} file(s) and ${parsedRows.length} row(s), none claimed twice; ` +
        `${onDisk.length} heading(s) name their own number.`,
);
