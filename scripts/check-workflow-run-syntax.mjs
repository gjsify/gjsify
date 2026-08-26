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
// WHICH shell a block belongs to is itself a claim, and this file got it wrong for 69
// blocks: a step with no `shell:` key was read as bash, when on a Windows runner GitHub
// hands it to `pwsh` (or to whatever `defaults.run.shell` says). See
// `RUNNER_DEFAULT_SHELL` for the measurement and the precedence now resolved. Answering
// with the wrong grammar is not a smaller version of not answering: `bash -n` accepts the
// cmd.exe batch `where sh 2>nul && (echo FAIL & exit /b 1)` and reported it as a parsed
// block.
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
const BASH_LIKE = new Set(['bash', 'sh', 'bash -e {0}', 'bash --noprofile --norc -eo pipefail {0}']);

/** Shells PowerShell's own parser can speak for. */
const PWSH_LIKE = new Set(['pwsh', 'powershell', 'pwsh -Command {0}', 'pwsh -File {0}']);

/**
 * NO `shell:` KEY IS NOT `bash`. It is whatever the RUNNER defaults to, and this set used
 * to hold `undefined` — so every block on a Windows runner that relies on the default was
 * parsed with `bash -n`.
 *
 * Measured 2026-08-26 over `.github/workflows/`: 51 blocks default to `pwsh` on a Windows
 * runner (35 in `audit-runtimes.yml`'s own `check-windows` job, which is where THIS check
 * runs from) and 19 more inherit `defaults.run.shell: cmd` from `windows-suites.yml`'s
 * `node-suites`. All 70 were read as bash. `bash -n` accepts the cmd.exe batch
 * `where sh 2>nul && (echo FAIL & exit /b 1)` without complaint, so the answer was not
 * merely unhelpful — it was a green from the wrong grammar, which is the exact shape this
 * file was written against one layer up.
 *
 * The precedence GitHub applies, and therefore the one resolved here: step `shell:` →
 * job `defaults.run.shell` → workflow `defaults.run.shell` → the runner's default (`pwsh`
 * on windows-*, `bash` elsewhere). A runner this cannot pin down — a matrix expression
 * whose candidate labels span OSes, or none that look like a label — yields NO shell, and
 * the block is NAMED as unread rather than guessed at. Every such job in the tree today
 * declares a shell (`cli-cross-platform.yml` spans both OSes and says `bash`), so the
 * honest gap is empty; a new one announces itself instead of picking up a grammar.
 */
const RUNNER_DEFAULT_SHELL = { windows: 'pwsh', linux: 'bash', macos: 'bash' };

/** A runner label's OS, by the only thing a label reliably carries — its name. */
function labelOs(label) {
    if (/windows/i.test(label)) return 'windows';
    if (/macos|mac-/i.test(label)) return 'macos';
    if (/ubuntu|linux/i.test(label)) return 'linux';
    return null;
}

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
        // Kept before the block body advances `i`: the job this step belongs to is decided
        // by where its `run:` KEY sits, not by where its script ends.
        const keyLine = i;

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

        steps.push({ name, shell, run: body, line: keyLine });
    }
    return steps;
}

/** The lines of the block under `<key>:` at `keyIndent`, or `[]` when the key is absent. */
function blockUnder(lines, key, keyIndent) {
    const at = lines.findIndex((line) => indentOf(line) === keyIndent && new RegExp(`^\\s*${key}:\\s*$`).test(line));
    if (at < 0) return [];
    const out = [];
    for (let i = at + 1; i < lines.length; i++) {
        if (indentOf(lines[i]) === -1) continue;
        if (indentOf(lines[i]) <= keyIndent) break;
        out.push(lines[i]);
    }
    return out;
}

/** `defaults:\n  run:\n    shell: X` under a key at `keyIndent`. A trailing `# …` is not shell. */
function defaultShellIn(lines, keyIndent) {
    for (const line of blockUnder(lines, 'defaults', keyIndent)) {
        const shell = /^\s*shell:\s*(.*)$/.exec(line);
        if (shell) return shell[1].trim().replace(/\s+#.*$/, '');
    }
    return undefined;
}

/**
 * Per-job context: the line span, the job's own `defaults.run.shell`, and the OS its
 * `runs-on` resolves to. `runs-on` is either a literal label or an expression, and for an
 * expression the candidates are the runner-shaped strings in the job's own `strategy:`
 * block — the only place a `${{ matrix.runner }}` can come from. Scoped to `strategy:`
 * rather than the whole job on purpose: a first version scanned the job body and found the
 * word "windows" in step comments, so thirty perfectly determinate jobs came out `null`.
 *
 * `null` OS means NOT PINNED DOWN, which the caller must treat as unread rather than as
 * bash. Indentation is DERIVED, never assumed — `cancel-pr-runs.yml` is written with
 * four-space job keys, and a hard-coded two made its one job invisible.
 */
function jobContexts(text) {
    const lines = text.split('\n');
    const jobsAt = lines.findIndex((line) => /^jobs:\s*$/.test(line));
    if (jobsAt < 0) return [];
    let jobIndent = null;
    const starts = [];
    for (let i = jobsAt + 1; i < lines.length; i++) {
        const ind = indentOf(lines[i]);
        if (ind === -1 || lines[i].trimStart().startsWith('#')) continue;
        if (ind === 0) break;
        if (jobIndent === null) jobIndent = ind;
        if (ind === jobIndent && /^\s*[A-Za-z0-9_-]+:\s*$/.test(lines[i])) starts.push(i);
    }
    return starts.map((from, index) => {
        const to = starts[index + 1] ?? lines.length;
        const body = lines.slice(from, to);
        // The job's own keys sit one level in; everything deeper belongs to a step.
        const keyIndent = Math.min(
            ...body
                .slice(1)
                .map(indentOf)
                .filter((ind) => ind > jobIndent),
        );
        const runsOn =
            body
                .find((line) => /^\s*runs-on:\s*/.test(line))
                ?.replace(/^\s*runs-on:\s*/, '')
                .trim() ?? '';
        const labels = runsOn.includes('${{')
            ? [
                  ...blockUnder(body, 'strategy', keyIndent)
                      .join('\n')
                      .matchAll(/\b((?:ubuntu|windows|macos)[-\w.]*)/gi),
              ].map((m) => m[1])
            : [runsOn.replace(/^['"]|['"]$/g, '')];
        const oses = new Set(labels.map(labelOs).filter(Boolean));
        return {
            from,
            to,
            defaultShell: defaultShellIn(body, keyIndent),
            os: oses.size === 1 ? [...oses][0] : null,
        };
    });
}

/**
 * The shell a step's script will actually be handed to, or `undefined` when nothing in the
 * file pins it down. See `RUNNER_DEFAULT_SHELL` for the precedence and what it cost.
 */
function effectiveShell(step, jobs, workflowDefault) {
    if (step.shell) return step.shell;
    const job = jobs.find((j) => step.line >= j.from && step.line < j.to);
    if (job?.defaultShell) return job.defaultShell;
    if (workflowDefault) return workflowDefault;
    // A composite `action.yml` has no jobs and no runner of its own; GitHub REQUIRES an
    // explicit `shell:` there, so a missing one is a workflow error, not a default.
    return job?.os ? RUNNER_DEFAULT_SHELL[job.os] : undefined;
}

const REQUIRE_PWSH = process.argv.includes('--require-pwsh');
const tmp = mkdtempSync(join(tmpdir(), 'gjsify-run-syntax-'));
const failures = [];
let checked = 0;
let pwshChecked = 0;
/** Blocks no interpreter here can speak for — NAMED, never counted. */
const unparsed = [];

for (const file of workflowFiles()) {
    const text = readFileSync(file, 'utf-8');
    const jobs = jobContexts(text);
    const workflowDefault = defaultShellIn(text.split('\n'), 0);
    for (const step of collectRunSteps(text)) {
        const shell = effectiveShell(step, jobs, workflowDefault);
        if (PWSH_LIKE.has(shell)) {
            if (!HAVE_PWSH) {
                unparsed.push({ file, name: step.name, shell });
                continue;
            }
            const psPath = join(tmp, `step-${pwshChecked}.ps1`);
            writeFileSync(psPath, step.run.replace(GHA_EXPR, EXPR_PLACEHOLDER));
            const bad = pwshParse(psPath);
            pwshChecked++;
            if (bad) failures.push({ file, name: step.name, shell, message: bad.message });
            continue;
        }
        if (!BASH_LIKE.has(shell)) {
            unparsed.push({ file, name: step.name, shell: shell ?? '<no shell resolvable>' });
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
                shell,
                message: (r.stderr || '').trim().split('\n').slice(0, 3).join(' / '),
            });
        }
    }
}

// THE SHELL ATTRIBUTION MUST DISCRIMINATE TOO, and unlike the PowerShell parser this
// costs no interpreter, so it runs on EVERY invocation. It is the half that was wrong: the
// resolver answering `bash` for everything is exactly what this file did until 2026-08-26,
// and it reported a clean green over 69 blocks it had read with the wrong grammar. Cases 1,
// 3, 5 and 6 are each red under that resolver.
const ATTRIBUTION_CASES = [
    ['a Windows runner with no shell key defaults to PowerShell', 'windows-latest', undefined, undefined, 'pwsh'],
    ['a Linux runner with no shell key defaults to bash', 'ubuntu-latest', undefined, undefined, 'bash'],
    ['a job default beats the runner default', 'windows-latest', 'cmd', undefined, 'cmd'],
    ['an explicit step shell beats both', 'windows-latest', 'cmd', 'bash', 'bash'],
    ['a macOS runner defaults to bash', 'macos-latest', undefined, undefined, 'bash'],
];

function attributionFailures() {
    const bad = [];
    for (const [label, runsOn, jobDefault, stepShell, want] of ATTRIBUTION_CASES) {
        const yaml = [
            'name: Probe',
            'on:',
            '  push:',
            'jobs:',
            '  probe:',
            `    runs-on: ${runsOn}`,
            ...(jobDefault ? ['    defaults:', '      run:', `        shell: ${jobDefault}`] : []),
            '    steps:',
            '      - name: Step',
            ...(stepShell ? [`        shell: ${stepShell}`] : []),
            '        run: echo hi',
            '',
        ].join('\n');
        const jobs = jobContexts(yaml);
        const [step] = collectRunSteps(yaml);
        const got = effectiveShell(step, jobs, defaultShellIn(yaml.split('\n'), 0));
        if (got !== want) bad.push(`${label}: expected ${want}, resolved ${got ?? '<none>'}`);
    }
    // A runner the file cannot pin down must resolve to NOTHING, so the block is named as
    // unread instead of silently handed to bash. `cli-cross-platform.yml` is the real
    // cross-OS matrix and it declares a shell; this is the shape that would not.
    const mixed = [
        'name: Probe',
        'on:',
        '  push:',
        'jobs:',
        '  probe:',
        '    strategy:',
        '      matrix:',
        '        os: [ubuntu-latest, windows-latest]',
        '    runs-on: ${{ matrix.os }}',
        '    steps:',
        '      - name: Step',
        '        run: echo hi',
        '',
    ].join('\n');
    const [step] = collectRunSteps(mixed);
    const got = effectiveShell(step, jobContexts(mixed), undefined);
    if (got !== undefined) bad.push(`a cross-OS matrix with no declared shell resolved to ${got}, not to nothing`);
    return bad;
}

const attributionBad = attributionFailures();
if (attributionBad.length > 0) {
    console.error('run-syntax: the shell attribution is wrong, so every verdict below is about the wrong grammar:');
    for (const f of attributionBad) console.error(`  · ${f}`);
    rmSync(tmp, { recursive: true, force: true });
    process.exit(1);
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
        // NAMED, not counted, and named WITH ITS SHELL: a bare "52 skipped" reads as
        // housekeeping, and it hid that every `release.yml` PowerShell block is unread on a
        // workflow with no PR trigger. The shell is what separates a gap this host merely
        // cannot fill today (`pwsh` on Linux) from a permanent one — `cmd.exe` has no
        // parse-only mode anywhere, so `windows-suites.yml`'s batch steps stay unread even
        // on the Windows leg, and saying so is the only honest report available.
        const byGroup = new Map();
        for (const u of unparsed) {
            const k = `${u.file.replace(`${ROOT}/`, '')} (shell: ${u.shell})`;
            byGroup.set(k, (byGroup.get(k) ?? 0) + 1);
        }
        console.log('   not read by any interpreter on this host:');
        for (const [f, n] of [...byGroup].sort()) console.log(`     ${f}: ${n} block(s)`);
    }
    process.exit(0);
}

for (const f of failures) {
    console.error(`\n${f.file.replace(`${ROOT}/`, '')} — step "${f.name}" (shell: ${f.shell})`);
    console.error(`  ${f.message}`);
}
console.error(
    '\nA `run:` block that is not valid shell fails at the moment it runs, which for a release\n' +
        "step is after the tag exists. Passing a script as `-e '…'` is the usual cause: one\n" +
        'apostrophe in a comment closes the string. Use a QUOTED heredoc instead —\n' +
        '`cat > "$RUNNER_TEMP/x.mjs" <<\'JS\' … JS` — which ends only on its own delimiter.',
);
process.exit(1);
