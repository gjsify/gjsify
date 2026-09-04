#!/usr/bin/env node
// Every `continue-on-error` step must be ADDRESSABLE and must be READ.
//
// THE CLASS (#1552). A `continue-on-error: true` step reports its conclusion as
// `success` whatever it did, so the PR page, `gh pr checks` and every API reader
// see green. `steps.<id>.outcome` is the only record — and a step with no `id`
// does not even have that. Measured by this check on the tree that introduced it:
// 18 such steps across 6 workflows (plus one JOB-level flag, below), of which 10
// — `cli-cross-platform.yml`'s diagnostic sweep — already carried ids and a
// summary table, and 8 did not. Three probes were red on the run that prompted
// the issue, two of them for a defect nobody had counted (#1556).
//
// SO TWO THINGS ARE CHECKED, and the first is what makes the second possible:
//
//   1. the step has an `id`;
//   2. the workflow reads `steps.<id>.outcome` somewhere.
//
// FILE SCOPE, NOT JOB SCOPE, for the reason the neighbouring workflow checks give:
// no YAML library is available here. The audit job that runs this does no install
// and no build — importing `yaml` cost one red PR before that constraint was
// believed — so every reader in `scripts/` is lexical. A step id is unique within
// its job, and a reference from a DIFFERENT job would be a workflow that does not
// run; that is a mistake this check would miss and `actionlint` catches, because
// an unknown `steps.<id>` context is an error there.
//
// WHAT IT DOES NOT DO: demand that the outcome FAIL anything. These probes are
// `continue-on-error` because something below them is knowably broken, each with a
// written retirement condition in the workflow. The rule is that what they
// measured is visible, not that it gates.
//
// Usage: node scripts/check-probe-outcomes-read.mjs [--root <dir>]

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const rootIndex = args.indexOf('--root');
const ROOT = rootIndex === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..') : args[rootIndex + 1];
const WORKFLOWS = join(ROOT, '.github', 'workflows');

/** `  - name: x` / `    id: y` → the key, whether or not the line opens the item. */
const KEY = /^\s*(?:-\s+)?([A-Za-z-]+):/;

/**
 * Blank out every BLOCK SCALAR body, so a `run:` script is never read as YAML.
 *
 * Measured against this checker: a `run: |` body containing an indented
 * `- name: fake step` / `continue-on-error: true` was parsed as a step and
 * refused, and an `id:` inside a heredoc won over the step's real one. Both are
 * the same mistake — reading a payload as structure — and both are why the
 * neighbouring workflow checks extract these bodies rather than skim past them.
 *
 * The rule is one line long and the same one `check-workflow-run-syntax.mjs`
 * uses: everything indented deeper than the key introducing the scalar belongs
 * to it. Lines are replaced by empty ones rather than removed, so every index
 * still names the line it did before.
 */
function withoutBlockScalars(lines) {
    const out = [...lines];
    for (let i = 0; i < out.length; i += 1) {
        if (!/^\s*(?:-\s+)?[A-Za-z-]+:\s*[|>][-+0-9]*\s*(?:#.*)?$/.test(out[i])) continue;
        const keyIndent = (out[i].match(/^\s*/) ?? [''])[0].length;
        for (let j = i + 1; j < out.length; j += 1) {
            if (out[j].trim() === '') continue;
            const indent = (out[j].match(/^\s*/) ?? [''])[0].length;
            if (indent <= keyIndent) break;
            out[j] = '';
        }
    }
    return out;
}

/**
 * The step block a line belongs to.
 *
 * A step's keys all sit at ONE indent, and exactly one of them is prefixed by the
 * list dash. So the block runs from the nearest `- ` line at that indent, up to
 * the next one or the first line indented less — which is the whole grammar
 * needed, and the same one `check-workflow-run-syntax.mjs` reads `run:` blocks
 * with.
 */
function stepBlockAround(lines, index) {
    const indent = (lines[index].match(/^\s*/) ?? [''])[0].length;
    let start = index;
    while (start > 0) {
        const line = lines[start];
        if (line.startsWith(`${' '.repeat(indent - 2)}- `)) break;
        start -= 1;
    }
    // Not in a list at all → not a step. `jobs.<id>.continue-on-error` is the
    // other spelling and a different question: a job marked that way reports
    // `success` to `needs` too, and there is no `steps.<id>` to read because the
    // failure belongs to the job. What stands in its place is the job's own
    // verdict line — `release-cut.yml`'s bootstrap canary prints one in BOTH
    // outcomes for exactly this reason — so this check keeps to steps and says so
    // rather than inventing a rule it cannot express.
    if (start === 0) return null;
    let end = index + 1;
    while (end < lines.length) {
        const line = lines[end];
        if (line.trim() === '' || line.trim().startsWith('#')) {
            end += 1;
            continue;
        }
        const lineIndent = (line.match(/^\s*/) ?? [''])[0].length;
        if (lineIndent < indent) break;
        if (lineIndent === indent - 2 && line.trim().startsWith('- ')) break;
        end += 1;
    }
    return lines.slice(start, end);
}

/** The value of `key` in a step block, unquoted, or `undefined`. */
function valueOf(block, key) {
    for (const line of block) {
        const match = line.match(KEY);
        if (!match || match[1] !== key) continue;
        const raw = line.slice(line.indexOf(':') + 1).trim();
        return raw.replace(/^['"]|['"]$/g, '');
    }
    return undefined;
}

const failures = [];
let probes = 0;

const files = readdirSync(WORKFLOWS)
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .sort();

for (const name of files) {
    const path = join(WORKFLOWS, name);
    const text = readFileSync(path, 'utf8');
    const lines = withoutBlockScalars(text.split('\n'));
    const rel = relative(ROOT, path);

    for (let i = 0; i < lines.length; i += 1) {
        // ANY value but a literal `false`, because an EXPRESSION is the shape that
        // hides best: `continue-on-error: ${{ github.event_name == 'push' }}` is
        // sometimes true, and a check keyed on the literal counted it as gating and
        // walked past it. `false` is the one value that cannot swallow a failure.
        const flag = /^\s*continue-on-error:\s*(.+?)\s*(?:#.*)?$/.exec(lines[i]);
        if (!flag || flag[1] === 'false') continue;
        const block = stepBlockAround(lines, i);
        if (block === null) continue;
        probes += 1;
        const label = valueOf(block, 'name') ?? `line ${i + 1}`;
        const id = valueOf(block, 'id');
        if (id === undefined) {
            failures.push(
                `${rel}: the continue-on-error step "${label}" has no \`id\`, so its OUTCOME is not addressable ` +
                    'at all — the only record of what it did is a log nobody opens.',
            );
            continue;
        }
        if (!text.includes(`steps.${id}.outcome`)) {
            failures.push(
                `${rel}: nothing reads \`steps.${id}.outcome\` ("${label}"). GitHub forces this step's ` +
                    'CONCLUSION to success, so the PR reads green whatever it did. Report it with ' +
                    '`scripts/report-probe-outcome.mjs`.',
            );
        }
    }
}

if (failures.length > 0) {
    console.error(`check-probe-outcomes-read: ${failures.length} unreported probe(s).\n`);
    for (const failure of failures) console.error(`  ${failure}`);
    console.error(
        '\n  A continue-on-error step is a measurement whose result GitHub throws away.\n' +
            '  Give it an `id`, and add a step that reports `steps.<id>.outcome`:\n\n' +
            '      - name: Probe outcome — <what ran>\n' +
            '        if: always()\n' +
            '        env:\n' +
            '          PROBE_LABEL: <what ran>\n' +
            '          PROBE_OUTCOME: ${{ steps.<id>.outcome }}\n' +
            '        run: node scripts/report-probe-outcome.mjs\n',
    );
    process.exit(1);
}

console.log(`check-probe-outcomes-read: ${probes} continue-on-error step(s), every outcome addressable and read.`);
