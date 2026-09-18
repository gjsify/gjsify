#!/usr/bin/env node
// ADR 0053's census table still says what the tree says.
//
// WHY THIS EXISTS. The table in ADR 0053 § Context was measured by hand once and went
// stale the moment #1690 added a twelfth `.blp`. Nothing failed. It stayed wrong through
// two reviews, and the first repair introduced a fresh error of its own — a delta sentence
// that was reasoned rather than measured, because the original count could not be re-run.
// The PR that fixed all of it argued that a decision record's evidence must be
// re-derivable from the tree. An argument with no gate behind it is a preference, and this
// is the gate: the ADR's table must be, byte for byte, what
// `report-blueprint-census.mjs --markdown` emits at HEAD.
//
// SO THE TABLE IS NEVER TRANSCRIBED. The reporter owns all four columns, not just the
// counts, and the fix for a failure here is to paste its `--markdown` output over the
// block — never to edit a number by hand. Hand-copying is what lost the substitute markers
// on the way into the ADR the one time it was tried.
//
// IT GATES THE TREE, NOT A REVISION. Always HEAD: the question is whether the ADR
// committed alongside this tree describes this tree. `report-blueprint-census.mjs` takes a
// tree-ish for the other question, which is what an older revision measured.
//
// Usage: node scripts/check-blueprint-census.mjs [--root <dir>]
// Exits 0 when they agree, 1 when they drift, 2 on a usage or read error.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { blueprintCensus, renderAdrBlock } from './report-blueprint-census.mjs';

/** The decision record whose evidence this gate holds to the tree. */
const ADR = 'docs/adr/0053-blueprint-parsed-in-repo.md';

/** The table's header row, which is what locates the block inside the ADR. */
const HEADER = '| Blueprint | count | `SharedNode` | GIR-derived? |';

/**
 * The census block as the ADR currently carries it: the table, one blank line, and the
 * sentence stating the three zeros. Read structurally rather than by line number, so
 * ordinary editing above it cannot silently move the gate off its target.
 */
function adrBlock(text) {
    const lines = text.split('\n');
    const start = lines.indexOf(HEADER);
    if (start === -1) throw new Error(`${ADR} has no census table — expected a row reading:\n  ${HEADER}`);

    let end = start;
    while (end < lines.length && lines[end].startsWith('|')) end += 1;
    if (lines[end] !== '') throw new Error(`${ADR}: the census table is not followed by a blank line`);

    const zeros = end + 1;
    if (!lines[zeros] || lines[zeros].startsWith('|')) {
        throw new Error(`${ADR}: the census table is not followed by the sentence stating the zero counts`);
    }
    return { text: [...lines.slice(start, end), '', lines[zeros]].join('\n'), line: start + 1 };
}

function main() {
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) {
        console.log('usage: node scripts/check-blueprint-census.mjs [--root <dir>]');
        return process.exit(0);
    }
    // A mistyped flag must not read as its own absence — see `check-blueprint-corpus.mjs`.
    const rootFlag = args.indexOf('--root');
    const root = rootFlag === -1 ? process.cwd() : args[rootFlag + 1];
    const stray = args.filter((arg, i) => arg !== '--root' && !(rootFlag !== -1 && i === rootFlag + 1));
    if (stray.length > 0 || (rootFlag !== -1 && typeof root !== 'string')) {
        const why = stray.length > 0 ? `unknown argument(s): ${stray.join(', ')}` : '--root needs a directory';
        console.error(
            `check-blueprint-census: ${why}\n  usage: node scripts/check-blueprint-census.mjs [--root <dir>]`,
        );
        return process.exit(2);
    }

    let committed;
    let measured;
    let report;
    try {
        committed = adrBlock(readFileSync(join(root, ADR), 'utf-8'));
        report = blueprintCensus('HEAD');
        measured = renderAdrBlock(report);
    } catch (error) {
        console.error(`check-blueprint-census: ${error.message}`);
        return process.exit(2);
    }

    if (committed.text === measured) {
        console.log(
            `check-blueprint-census: ADR 0053's census matches the tree — ` +
                `${report.paths.length} real .blp, namespaces ${report.namespaces.join(', ')}.`,
        );
        return process.exit(0);
    }

    // Both halves are printed, because "they differ" without the two texts is the kind of
    // failure people fix by editing the number the error happens to mention.
    const committedLines = committed.text.split('\n');
    const measuredLines = measured.split('\n');
    console.error(`check-blueprint-census: ${ADR}:${committed.line} no longer matches the tree.\n`);
    for (let i = 0; i < Math.max(committedLines.length, measuredLines.length); i += 1) {
        if (committedLines[i] !== measuredLines[i]) {
            console.error(`  ADR:  ${committedLines[i] ?? '(missing)'}`);
            console.error(`  tree: ${measuredLines[i] ?? '(missing)'}\n`);
        }
    }
    console.error(
        '  Fix by replacing the block with the measurement, never by editing a number:\n' +
            '    node scripts/report-blueprint-census.mjs --markdown',
    );
    return process.exit(1);
}

// `import.meta.main` is not available on every Node this repo's CI still runs.
if (process.argv[1] && process.argv[1].endsWith('check-blueprint-census.mjs')) main();
