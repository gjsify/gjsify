#!/usr/bin/env node
// Every `run:` block in every workflow is valid shell.
//
// THE INCIDENT. `release-cut.yml`'s publish dispatch passed its script as
// `node --input-type=module -e '…'`, and a comment inside it read "v0.31.0's cut and
// publish". That apostrophe closed the single-quoted SHELL string early, so node received
// a truncated program and died with `SyntaxError: Unexpected end of input`. v0.38.0 was
// bumped, committed, tagged, released and its assets uploaded — and never dispatched to
// npm. The comment that caused it was the one describing v0.31.0's half-release.
//
// Nothing in CI could see it. `actionlint` runs with `-shellcheck=` deliberately empty, and
// it parses workflow SYNTAX rather than the shell inside `run:`. The release dry run cannot
// help either: that step is `if: ${{ !inputs.dry_run }}`, so the one step a dry run always
// skips is the one that publishes.
//
// `bash -n` on the extracted script catches it — measured on the broken revision: rc=2,
// "syntax error near unexpected token `}'". This runs it on every `run:` block in the tree,
// which costs milliseconds and covers the whole class rather than that one apostrophe.
//
// `${{ … }}` is substituted before parsing: it is a GitHub expression, not shell, and `${{`
// is not valid parameter expansion. The substitute is a bare word, so it stands where the
// expression's VALUE would — which is how the runner treats it too.
//
// NO YAML LIBRARY, deliberately. The job that runs this states its own constraint two
// steps up: it does no install and no build, because a CLI route would have to boot the
// committed bundle and reintroduce the staleness circularity `verify-committed-bundles.mjs`
// exists to break. Importing `yaml` cost one red PR before that sentence was believed. A
// `run:` block is a YAML BLOCK SCALAR, whose rule is one line long — everything indented
// deeper than the key belongs to it — so the extractor below is the whole parser needed.
//
// Usage: node scripts/check-workflow-run-syntax.mjs [--root <dir>]

import { readdirSync, readFileSync, existsSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const rootIndex = args.indexOf('--root');
const ROOT = rootIndex === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..') : args[rootIndex + 1];

/** `${{ inputs.x }}` → a bare word: the runner substitutes a VALUE there, not shell. */
const GHA_EXPR = /\$\{\{[^}]*\}\}/g;
const EXPR_PLACEHOLDER = 'GHA_EXPR';

/** Shells `bash -n` can speak for. `pwsh`/`python` blocks are someone else's grammar. */
const BASH_LIKE = new Set([undefined, 'bash', 'sh', 'bash -e {0}', 'bash --noprofile --norc -eo pipefail {0}']);

function workflowFiles() {
    const out = [];
    const wfDir = join(ROOT, '.github', 'workflows');
    if (existsSync(wfDir)) {
        for (const name of readdirSync(wfDir)) {
            if (name.endsWith('.yml') || name.endsWith('.yaml')) out.push(join(wfDir, name));
        }
    }
    const actionsDir = join(ROOT, '.github', 'actions');
    if (existsSync(actionsDir)) {
        for (const name of readdirSync(actionsDir)) {
            const f = join(actionsDir, name, 'action.yml');
            if (existsSync(f)) out.push(f);
        }
    }
    return out.sort();
}

/** The indentation of a line, or -1 for a blank one (blanks belong to any block). */
function indentOf(line) {
    if (line.trim() === '') return -1;
    return line.length - line.trimStart().length;
}

/**
 * Every `run:` block in a workflow, with the step `name:` and `shell:` that share its
 * mapping. Block scalars only need the one rule: the body is every following line indented
 * deeper than the key, with that indentation stripped. A folded `>` body is joined, which
 * is what the runner hands the shell.
 */
function collectRunSteps(text) {
    const lines = text.split('\n');
    const steps = [];
    for (let i = 0; i < lines.length; i++) {
        const m = /^(\s*)run:\s*(\|[-+]?|>[-+]?)?\s*(.*)$/.exec(lines[i]);
        if (!m) continue;
        const [, indent, style, inline] = m;
        const keyIndent = indent.length;

        let body;
        if (!style) {
            if (inline.trim() === '') continue; // `run:` with nothing on it — not a script
            body = inline;
        } else {
            const collected = [];
            let j = i + 1;
            let bodyIndent = null;
            for (; j < lines.length; j++) {
                const ind = indentOf(lines[j]);
                if (ind === -1) {
                    collected.push('');
                    continue;
                }
                if (ind <= keyIndent) break;
                if (bodyIndent === null) bodyIndent = ind;
                collected.push(lines[j].slice(Math.min(bodyIndent, ind)));
            }
            body = style.startsWith('>') ? collected.join(' ') : collected.join('\n');
            i = j - 1;
        }

        // `name:` and `shell:` are siblings of `run:` — same indentation, same step. Walk
        // out to the step's own `-` bullet so a key BELOW `run:` is found too.
        let name = '<unnamed>';
        let shell;
        for (let k = i; k >= 0; k--) {
            const ind = indentOf(lines[k]);
            if (ind === -1) continue;
            if (ind < keyIndent && /^\s*-\s/.test(lines[k])) {
                const bullet = /^\s*-\s+(name|uses):\s*(.*)$/.exec(lines[k]);
                if (bullet && bullet[1] === 'name') name = bullet[2].trim();
                break;
            }
            if (ind !== keyIndent) continue;
            const nameKey = /^\s*name:\s*(.*)$/.exec(lines[k]);
            if (nameKey) name = nameKey[1].trim();
            const shellKey = /^\s*shell:\s*(.*)$/.exec(lines[k]);
            if (shellKey) shell = shellKey[1].trim();
        }
        for (let k = i + 1; k < lines.length; k++) {
            const ind = indentOf(lines[k]);
            if (ind === -1) continue;
            if (ind < keyIndent) break;
            if (ind !== keyIndent) continue;
            const shellKey = /^\s*shell:\s*(.*)$/.exec(lines[k]);
            if (shellKey) shell = shellKey[1].trim();
            const nameKey = /^\s*name:\s*(.*)$/.exec(lines[k]);
            if (nameKey && name === '<unnamed>') name = nameKey[1].trim();
        }

        steps.push({ name, shell, run: body });
    }
    return steps;
}

const tmp = mkdtempSync(join(tmpdir(), 'gjsify-run-syntax-'));
const failures = [];
let checked = 0;
let skipped = 0;

for (const file of workflowFiles()) {
    for (const step of collectRunSteps(readFileSync(file, 'utf-8'))) {
        if (!BASH_LIKE.has(step.shell)) {
            skipped++;
            continue;
        }
        const script = step.run.replace(GHA_EXPR, EXPR_PLACEHOLDER);
        const scriptPath = join(tmp, `step-${checked}.sh`);
        writeFileSync(scriptPath, script);
        const r = spawnSync('bash', ['-n', scriptPath], { encoding: 'utf-8' });
        checked++;
        if (r.status !== 0) {
            failures.push({
                file,
                name: step.name,
                message: (r.stderr || '').trim().split('\n').slice(0, 3).join(' / '),
            });
        }
    }
}

rmSync(tmp, { recursive: true, force: true });

if (failures.length === 0) {
    console.log(`OK — ${checked} \`run:\` block(s) parse as shell (${skipped} non-bash block(s) skipped).`);
    process.exit(0);
}

for (const f of failures) {
    console.error(`\n${f.file.replace(`${ROOT}/`, '')} — step "${f.name}"`);
    console.error(`  ${f.message}`);
}
console.error(
    '\nA `run:` block that is not valid shell fails at the moment it runs, which for a release\n' +
        "step is after the tag exists. Passing a script as `-e '…'` is the usual cause: one\n" +
        'apostrophe in a comment closes the string. Use a QUOTED heredoc instead —\n' +
        '`cat > "$RUNNER_TEMP/x.mjs" <<\'JS\' … JS` — which ends only on its own delimiter.',
);
process.exit(1);
