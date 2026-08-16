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

/** Shells `bash -n` can speak for. `python` blocks are someone else's grammar. */
const BASH_LIKE = new Set([undefined, 'bash', 'sh', 'bash -e {0}', 'bash --noprofile --norc -eo pipefail {0}']);

/** Shells PowerShell's own parser can speak for. */
const PWSH_LIKE = new Set(['pwsh', 'powershell', 'pwsh -Command {0}', 'pwsh -File {0}']);

/**
 * Parse a PowerShell script WITHOUT running it.
 *
 * `[Parser]::ParseFile` is PowerShell's own front end — the same one that would reject the
 * script at step start — and it only ever reads. There is no `-WhatIf`-style half-execution
 * here and no dot-sourcing: a syntax error comes back as a diagnostic, not as a side effect.
 *
 * Returns null when the script parses, or the first diagnostics when it does not.
 */
function pwshParse(scriptPath) {
    const probe =
        '$e = $null; ' +
        `[System.Management.Automation.Language.Parser]::ParseFile('${scriptPath}', [ref]$null, [ref]$e) > $null; ` +
        'if ($e.Count -gt 0) { $e | ForEach-Object { $_.Message } ; exit 1 } else { exit 0 }';
    const r = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', probe], { encoding: 'utf-8' });
    if (r.error !== undefined || r.status === null)
        return { message: `pwsh could not run: ${r.error?.message ?? 'no status'}` };
    if (r.status === 0) return null;
    return { message: (r.stdout || r.stderr || '').trim().split('\n').slice(0, 3).join(' / ') };
}

const HAVE_PWSH =
    spawnSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], {
        encoding: 'utf-8',
    }).status === 0;

/**
 * The detector must DISCRIMINATE, or a green run means nothing. Same construction as
 * `check-changelog-references.mjs`: a shape that must be rejected and one that must be
 * accepted, run on every invocation that has an interpreter to run them with.
 */
const PWSH_MUST_REJECT = ['if ($true) { Write-Output "unclosed"', 'foreach ($x in 1..3 { $x }'];
const PWSH_MUST_ACCEPT = ['if ($true) { Write-Output "ok" }', '$a = @(1,2,3); $a | ForEach-Object { $_ * 2 }'];

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

const REQUIRE_PWSH = process.argv.includes('--require-pwsh');
const tmp = mkdtempSync(join(tmpdir(), 'gjsify-run-syntax-'));
const failures = [];
let checked = 0;
let pwshChecked = 0;
/** Blocks no interpreter here can speak for — NAMED, never counted. */
const unparsed = [];

for (const file of workflowFiles()) {
    for (const step of collectRunSteps(readFileSync(file, 'utf-8'))) {
        if (PWSH_LIKE.has(step.shell)) {
            if (!HAVE_PWSH) {
                unparsed.push({ file, name: step.name, shell: step.shell });
                continue;
            }
            const psPath = join(tmp, `step-${pwshChecked}.ps1`);
            writeFileSync(psPath, step.run.replace(GHA_EXPR, EXPR_PLACEHOLDER));
            const bad = pwshParse(psPath);
            pwshChecked++;
            if (bad) failures.push({ file, name: step.name, message: bad.message });
            continue;
        }
        if (!BASH_LIKE.has(step.shell)) {
            unparsed.push({ file, name: step.name, shell: step.shell });
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

// The detector proves it still discriminates, on every run that can run it. A parser
// that accepts everything reports the same green as one that works.
if (HAVE_PWSH) {
    const selfFailures = [];
    for (const [i, src] of PWSH_MUST_REJECT.entries()) {
        const f = join(tmp, `selftest-bad-${i}.ps1`);
        writeFileSync(f, src);
        if (!pwshParse(f)) selfFailures.push(`accepted a broken script: ${src}`);
    }
    for (const [i, src] of PWSH_MUST_ACCEPT.entries()) {
        const f = join(tmp, `selftest-ok-${i}.ps1`);
        writeFileSync(f, src);
        const bad = pwshParse(f);
        if (bad) selfFailures.push(`rejected a valid script: ${src} — ${bad.message}`);
    }
    if (selfFailures.length > 0) {
        console.error('run-syntax: the PowerShell detector does not discriminate — a green run would mean nothing:');
        for (const f of selfFailures) console.error(`  · ${f}`);
        rmSync(tmp, { recursive: true, force: true });
        process.exit(1);
    }
}

rmSync(tmp, { recursive: true, force: true });

// `--require-pwsh` is what a Windows leg passes. Without it this host reports what it
// could not read; with it, being unable to read them IS the failure — otherwise the one
// leg that exists to check PowerShell would pass by skipping all of it, which is the
// shape this repository has paid for most.
if (REQUIRE_PWSH && !HAVE_PWSH) {
    console.error(
        `run-syntax: --require-pwsh was passed and no \`pwsh\` is on PATH, so ${unparsed.length} ` +
            'PowerShell block(s) went unread. This flag exists so that cannot pass quietly.',
    );
    process.exit(1);
}

if (failures.length === 0) {
    const parts = [`${checked} shell`];
    if (pwshChecked > 0) parts.push(`${pwshChecked} PowerShell`);
    console.log(`OK — ${parts.join(' + ')} \`run:\` block(s) parse.`);
    if (unparsed.length > 0) {
        // NAMED, not counted: a bare "52 skipped" reads as housekeeping, and it hid that
        // every `release.yml` PowerShell block is unread on a workflow with no PR trigger.
        const byFile = new Map();
        for (const u of unparsed) {
            const k = u.file.replace(`${ROOT}/`, '');
            byFile.set(k, (byFile.get(k) ?? 0) + 1);
        }
        console.log('   not read by any interpreter on this host:');
        for (const [f, n] of [...byFile].sort()) console.log(`     ${f}: ${n} block(s)`);
    }
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
