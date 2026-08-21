#!/usr/bin/env node
// Refuse a release upload whose `files:` globs without `fail_on_unmatched_files`.
//
// THE INCIDENT — measured, not hypothetical
//
// `release-cut.yml`'s "Upload installer + bootstrap bundle to the release" step
// hardcodes `packages/infra/cli/ship/out/*.deb` and `*.rpm` into
// `softprops/action-gh-release`. That action's default for
// `fail_on_unmatched_files` is FALSE, so a glob matching nothing uploads nothing and
// exits 0: rename `gjsify.ship.outDir`, change an artifact filename, add a format that
// silently stops being written — and the release carries no installable packages with
// the cut job green. The gate that runs immediately after ("Assert the documented
// install URLs resolve") checks only `install.mjs` and `cli.gjs.mjs`, so nothing else
// in the pipeline can notice either.
//
// What it would cost: `gjsify self-update` REFUSES to run from a system prefix,
// because writing the XDG prefix there would leave the user with two installs, and it
// points at `releases/latest` instead — `utils/install-provenance.ts` says the release
// assets "are the one answer that is true on every distribution". An empty upload
// makes that sentence false for everyone who installed the `.deb` or the `.rpm`.
//
// The convention already exists everywhere else and this one upload does not use it:
// `if-no-files-found: error` appears 33 times across `.github/workflows/`, while
// `fail_on_unmatched_files` appeared 0 times in the whole repository before this check.
//
// WHAT IT CHECKS
//
// For every step using `softprops/action-gh-release`: if any `files:` entry contains a
// glob metacharacter (`*`, `?`, `[`), the same step must carry
// `fail_on_unmatched_files: true`. A literal file list needs no flag — a missing
// literal path is already an error in that action — so the check is scoped to the one
// shape whose failure is silent.
//
// No YAML parsing, by the same reasoning as `check-workflow-inline-scripts.mjs`: the
// defect is lexical (one absent key beside one glob), a parser is a dependency this
// script would have to justify, and the step boundaries are readable from indentation
// alone. The cost is that a `files:` value produced by an expression is invisible to
// it; that is a deliberate under-reach, not an oversight — a check with false
// positives gets disabled, and then protects nothing.
//
// Usage: node scripts/check-workflow-release-globs.mjs [--root <dir>]
// Exits 1 and names file:line + the offending entry on any finding.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const args = process.argv.slice(2);
const rootIndex = args.indexOf('--root');
const root = rootIndex === -1 ? process.cwd() : args[rootIndex + 1];
const workflowDir = join(root, '.github', 'workflows');

const RELEASE_ACTION = /uses:\s*softprops\/action-gh-release(?:[@\s]|$)/;
const GLOB = /[*?[]/;

/** Leading-space count; a line that is only whitespace has no meaningful indent. */
function indentOf(line) {
    return line.length - line.trimStart().length;
}

function isBlank(line) {
    const trimmed = line.trim();
    return trimmed === '' || trimmed.startsWith('#');
}

/**
 * The line range of the step containing `usesLine`.
 *
 * A step is a YAML sequence item, so its first line is the nearest `- ` at an indent
 * BELOW the keys it contains, and it ends at the next line that is not indented past
 * that marker. Both bounds are read from the file rather than assumed, because
 * `.github/workflows/` in this repo indents steps under both `jobs.<id>.steps` and
 * inside composite `runs.steps`.
 */
function stepRange(lines, usesLine) {
    const usesIndent = indentOf(lines[usesLine]);
    let start = usesLine;
    let markerIndent = usesIndent;
    if (!lines[usesLine].trimStart().startsWith('- ')) {
        for (let i = usesLine - 1; i >= 0; i--) {
            if (isBlank(lines[i])) continue;
            const indent = indentOf(lines[i]);
            if (indent < usesIndent && lines[i].trimStart().startsWith('- ')) {
                start = i;
                markerIndent = indent;
                break;
            }
            if (indent < usesIndent && !lines[i].trimStart().startsWith('- ')) break;
        }
    }
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
        if (isBlank(lines[i])) continue;
        if (indentOf(lines[i]) <= markerIndent) {
            end = i;
            break;
        }
    }
    return { start, end };
}

/** The `files:` entries of a step, as `{ line, text }`, inline and block forms alike. */
function filesEntries(lines, start, end) {
    const entries = [];
    for (let i = start; i < end; i++) {
        const match = /^\s*files:\s*(.*)$/.exec(lines[i]);
        if (!match) continue;
        const inline = match[1].trim();
        if (inline !== '' && inline !== '|' && inline !== '>' && !inline.startsWith('|') && !inline.startsWith('>')) {
            entries.push({ line: i + 1, text: inline });
            continue;
        }
        const blockIndent = indentOf(lines[i]);
        for (let j = i + 1; j < end; j++) {
            if (lines[j].trim() === '') continue;
            if (indentOf(lines[j]) <= blockIndent) break;
            if (lines[j].trim().startsWith('#')) continue;
            entries.push({ line: j + 1, text: lines[j].trim() });
        }
    }
    return entries;
}

const findings = [];

function checkFile(path) {
    const rel = relative(root, path);
    const lines = readFileSync(path, 'utf-8').split('\n');
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim().startsWith('#')) continue;
        if (!RELEASE_ACTION.test(lines[i])) continue;

        const { start, end } = stepRange(lines, i);
        const globbed = filesEntries(lines, start, end).filter((entry) => GLOB.test(entry.text));
        if (globbed.length === 0) continue;

        const flag = lines.slice(start, end).find((line) => line.includes('fail_on_unmatched_files:'));
        const value = flag === undefined ? undefined : /fail_on_unmatched_files:\s*(\S+)/.exec(flag)?.[1];
        if (value === 'true') continue;

        for (const entry of globbed) {
            findings.push({
                file: rel,
                line: entry.line,
                detail:
                    value === undefined
                        ? 'globbed release asset with no `fail_on_unmatched_files` — a glob matching nothing uploads nothing and exits 0'
                        : `globbed release asset with \`fail_on_unmatched_files: ${value}\` — only \`true\` turns an empty match into a failure`,
                text: entry.text,
            });
        }
    }
}

let files;
try {
    files = readdirSync(workflowDir).filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'));
} catch (error) {
    console.error(`check-workflow-release-globs: cannot read ${workflowDir}: ${error.message}`);
    process.exit(1);
}

for (const name of files.sort()) checkFile(join(workflowDir, name));

if (findings.length) {
    console.error(`check-workflow-release-globs: ${findings.length} silent-empty release upload(s)\n`);
    for (const finding of findings) {
        console.error(`  ${finding.file}:${finding.line} — ${finding.detail}`);
        console.error(`    ${finding.text}\n`);
    }
    console.error(
        'Fix by adding `fail_on_unmatched_files: true` beside `files:` in that step. A release\n' +
            'that silently loses an asset is not visible anywhere downstream: the install-URL gate\n' +
            'checks a fixed list, and `gjsify self-update` sends system-prefix installs to exactly\n' +
            'the assets that were not uploaded.',
    );
    process.exit(1);
}

console.log(`check-workflow-release-globs: ${files.length} workflow(s) clean.`);
