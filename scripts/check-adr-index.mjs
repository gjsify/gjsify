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
//
// (3) pays off repeatedly: the index Status column copies each ADR's own
// `- **Status:**` line, so promoting Proposed → Accepted touches two files and
// forgetting the second is silent today.
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

/** Index rows: | [NNNN](file.md) | Title | Status | */
const rows = new Map();
for (const line of indexText.split('\n')) {
    const match = line.match(/^\|\s*\[(\d{4})\]\(([^)]+)\)\s*\|(.+)\|([^|]+)\|\s*$/);
    if (match) rows.set(match[1], { file: match[2].trim(), status: match[4].trim() });
}
if (rows.size === 0) fail([`no ADR rows parsed from ${INDEX} — the table shape changed, so this check is blind.`]);

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

const problems = [];

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

console.log(`check-adr-index: ${onDisk.length} ADR(s) indexed, statuses agree.`);
