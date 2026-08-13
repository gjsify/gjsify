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
// Usage: node scripts/check-workflow-run-syntax.mjs [--root <dir>]

import { readdirSync, readFileSync, existsSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

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

/** Every `{ name, shell, run }` a document carries, at any depth. */
function collectRunSteps(node, path = []) {
    const found = [];
    if (Array.isArray(node)) {
        node.forEach((item, i) => found.push(...collectRunSteps(item, [...path, String(i)])));
        return found;
    }
    if (node && typeof node === 'object') {
        if (typeof node.run === 'string') {
            found.push({ name: node.name ?? path.join('.'), shell: node.shell, run: node.run });
        }
        for (const [key, value] of Object.entries(node)) {
            if (key === 'run') continue;
            found.push(...collectRunSteps(value, [...path, key]));
        }
    }
    return found;
}

const tmp = mkdtempSync(join(tmpdir(), 'gjsify-run-syntax-'));
const failures = [];
let checked = 0;
let skipped = 0;

for (const file of workflowFiles()) {
    let doc;
    try {
        doc = YAML.parse(readFileSync(file, 'utf-8'));
    } catch (err) {
        failures.push({ file, name: '<document>', message: `not parseable as YAML: ${err.message}` });
        continue;
    }
    for (const step of collectRunSteps(doc)) {
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
