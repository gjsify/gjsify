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

import { CATEGORIES, findClaims } from './blueprint-count-claims.mjs';
import { blueprintCensus, renderAdrBlock } from './report-blueprint-census.mjs';

/** The decision record whose evidence this gate holds to the tree. */
const ADR = 'docs/adr/0053-blueprint-parsed-in-repo.md';

/** The heading the emitted census section opens with, which is what locates it. */
const HEADING = /^### What the [\w-]+ `\.blp` files actually use$/;

/** The table's header row — used only to catch a SECOND, stale copy of the table. */
const TABLE_HEADER = '| Blueprint | count | `SharedNode` | GIR-derived? |';

/**
 * WHAT COUNTS AS A COUNT IS NOT DECIDED HERE. `blueprint-count-claims.mjs` decides it, and
 * `check-blueprint-corpus-counts.mjs` reads through the same module — because this gate and
 * that one are the two halves of one question and each used to carry its own vocabulary. That
 * seam was a hole: this gate matched line-at-a-time against a shorter noun list, so a claim
 * WRAPPED across two lines, or spelled as `negative cases`, passed here AND passed there,
 * since that gate hands this file over to this one. A wrap is the exact shape #1698 was
 * written for. Two vocabularies over one file is the defect, not either regex.
 *
 * Outside the emitted block a count is ungated and free to rot — which is how this ADR failed
 * before: the table was fixed and the paragraph under it went on asserting "twelve real" where
 * nothing looked, and "38 goldens, 37 byte-equal" sat there through the repair after that.
 */

/**
 * The census section as the ADR carries it, located by its heading and taken to the length
 * the reporter emits. Structural rather than line-numbered, so editing above it cannot move
 * the gate off its target.
 */
function adrBlock(text, expectedLines) {
    const lines = text.split('\n');
    const start = lines.findIndex((line) => HEADING.test(line));
    if (start === -1) throw new Error(`${ADR} has no census section — expected a heading matching ${HEADING}`);
    if (lines.slice(start + 1).some((line) => HEADING.test(line))) {
        throw new Error(`${ADR} has more than one census heading — a second copy is a second thing to drift`);
    }

    // A stale duplicate of the table further down would otherwise sit unchecked, because
    // the block is located by its heading and the comparison would never reach it.
    const tables = lines.reduce((at, line, i) => (line === TABLE_HEADER ? [...at, i + 1] : at), []);
    if (tables.length !== 1) {
        throw new Error(`${ADR} holds ${tables.length} census tables (lines ${tables.join(', ')}) — there must be one`);
    }

    return { text: lines.slice(start, start + expectedLines).join('\n'), line: start + 1 };
}

/** Every line OUTSIDE the block that states a `.blp` count, which nothing would check. */
function ungatedCountClaims(text, block) {
    // By OFFSET, not by line text: the emitted block is a contiguous run, and comparing line
    // strings would also excuse an identical line copied anywhere else in the file.
    const from = text.indexOf(block.text);
    const to = from + block.text.length;
    const lines = text.split('\n');
    // The whole ADR is about this corpus, end to end, so the loose spellings are read
    // throughout it — this is the one file where "rules" cannot mean a lint registry.
    return findClaims(text, [[0, text.length]])
        .filter((claim) => claim.index < from || claim.index >= to)
        .map((claim) => ({ line: lines[claim.line], at: claim.line + 1, claim }));
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

    let adr;
    let committed;
    let measured;
    let report;
    let ungated;
    try {
        adr = readFileSync(join(root, ADR), 'utf-8');
        report = blueprintCensus('HEAD');
        measured = renderAdrBlock(report);
        committed = adrBlock(adr, measured.split('\n').length);
        ungated = ungatedCountClaims(adr, committed);
    } catch (error) {
        console.error(`check-blueprint-census: ${error.message}`);
        return process.exit(2);
    }

    if (ungated.length > 0) {
        console.error(
            `check-blueprint-census: ${ungated.length} corpus count(s) stated outside the emitted block,\n` +
                '  where nothing checks them — the failure this gate exists to end, one paragraph down.\n' +
                '  Say it without the number and point at the census, or move the sentence into the block.\n',
        );
        for (const { at, line, claim } of ungated) {
            console.error(`  ${ADR}:${at}: ${line.trim()}`);
            console.error(`    reads as: ${claim.stated} ${CATEGORIES[claim.key].label}(s)`);
        }
        return process.exit(1);
    }

    if (committed.text === measured) {
        console.log(
            `check-blueprint-census: ADR 0053's census matches the tree — ` +
                `${report.paths.length} real .blp, namespaces ${report.namespaces.join(', ')}, ` +
                `${report.counts.propsScalar} + ${report.counts.propsAnonymousObject} = ${report.counts.propsAll} properties.`,
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
