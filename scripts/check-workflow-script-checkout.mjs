#!/usr/bin/env node
// A job that RUNS a repo script must CHECK OUT the repo.
//
// THE INCIDENT (v0.48.0). `release.yml`'s `dispatch-cross-platform-probe` job had no
// `actions/checkout` step and ran `node scripts/report-probe-outcome.mjs`. The dispatch it
// reports on succeeded; the REPORTER died with
//
//     Error: Cannot find module '/home/runner/work/gjsify/gjsify/scripts/report-probe-outcome.mjs'
//
// and turned the job red — a job whose own header states that "a failed dispatch must not
// fail a publish that already succeeded". The reporter's own docblock says a reporter must
// never fail the job it reports on. Both rules were right; the deployment broke them,
// because a step cannot report anything from a workspace that does not contain it.
//
// WHY NOTHING SAW IT. `check-probe-outcomes-read.mjs` (#1560) demands that every
// `continue-on-error` step has an `id` and that something READS its outcome. It got a
// reader. It could not ask whether the reader can RUN — that is a property of the JOB, and
// that checker is deliberately file-scoped. And `release.yml` runs only on `release` and
// `workflow_dispatch`, so no pull request ever executed the step. The first time it ran was
// the release it was meant to report on.
//
// WHAT IT CHECKS. Per JOB, in every workflow: if any step's `run:` invokes a path inside the
// repository — `node scripts/x.mjs`, `gjs -m packages/…`, `bash .github/…`, `./scripts/…` — or
// the job `uses:` a LOCAL composite action, then the job must contain a step whose `uses:` is
// `actions/checkout`. A job that only calls binaries (`gh`, `npm`, `docker`) needs no checkout
// and is not asked for one.
//
// THE LOCAL ACTION IS PART OF THE RULE because the invariant is already written down one file
// away: `.github/actions/gjsify-setup/action.yml` says "The calling job MUST run
// `actions/checkout` first — a local composite action can only be resolved once the repo
// (incl. this file) is on disk." A rule stated in prose beside the thing it governs is the
// shape this repository turns into a check.
//
// COMMENTS ARE NOT CODE, ON BOTH SIDES. A `#`-comment mentioning `node scripts/x.mjs` is not a
// call, and a commented-out `- uses: actions/checkout@v6` is not a checkout. The first version
// applied that reasoning to the payload and not to the checkout, so a job with its checkout
// commented out passed — a false GREEN in the exact class this file exists to refuse.
//
// LEXICAL, like every workflow reader in this directory: the audit job that runs these does
// no install and no build, so no YAML library is available. Jobs are the keys one indent
// under `jobs:`; a job's body is everything indented deeper. Block scalars are blanked
// first, so a `run:` payload is never read as structure — the same rule
// `check-probe-outcomes-read.mjs` and `check-workflow-run-syntax.mjs` apply.
//
// Usage: node scripts/check-workflow-script-checkout.mjs [--root <dir>]

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const rootIndex = args.indexOf('--root');
const ROOT = rootIndex === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..') : args[rootIndex + 1];
const WORKFLOWS = join(ROOT, '.github', 'workflows');

/**
 * Blank out every BLOCK SCALAR body, so a `run:` script is never read as YAML.
 *
 * Everything indented deeper than the key introducing the scalar belongs to it. Lines are
 * replaced by empty ones rather than removed, so every index still names the line it did.
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

/** A line with its `#` comment removed, honouring neither quotes nor escapes — enough here. */
function withoutComment(line) {
    return line.replace(/(^|\s)#.*$/, '$1');
}

/**
 * Every job in a workflow, as `{ name, start, end }` line spans.
 *
 * `jobs:` sits at column 0 and each job key one indent in. The span ends at the next key at
 * that same indent, or at the next column-0 key — a workflow with a top-level key AFTER
 * `jobs:` is legal YAML and would otherwise swallow the rest of the file into the last job.
 */
export function jobSpans(lines) {
    const jobsAt = lines.findIndex((l) => /^"?jobs"?:\s*(?:#.*)?\r?$/.test(l));
    if (jobsAt === -1) return [];
    const body = lines.slice(jobsAt + 1);
    const first = body.find((l) => l.trim() !== '' && !/^\s*#/.test(l));
    if (first === undefined) return [];
    const indent = (first.match(/^\s*/) ?? [''])[0].length;
    // A quoted key is a job like any other, and a QUOTED top-level key still ends the block —
    // `/^[A-Za-z]/` alone let `"defaults":` leak its nested keys in as another job.
    const key = new RegExp(`^\\s{${indent}}"?([A-Za-z0-9_-]+)"?:\\s*(?:#.*)?\\r?$`);
    const spans = [];
    for (let i = jobsAt + 1; i < lines.length; i += 1) {
        const line = lines[i];
        if (/^["'A-Za-z]/.test(line)) break;
        const match = key.exec(line);
        if (match === null) continue;
        if (spans.length > 0) spans[spans.length - 1].end = i;
        spans.push({ name: match[1], start: i, end: lines.length });
    }
    return spans;
}

/**
 * Every top-level directory a workflow could invoke something out of.
 *
 * ONE list, read by both branches below — they were two lists and disagreed, `website` being in
 * the interpreter branch and not the bare-path one. Derived from the tree rather than
 * remembered: `showcases`, `examples`, `templates`, `flatpak` and `status` are all real, and all
 * were missing.
 */
const REPO_DIRS = String.raw`scripts|\.github|tests|packages|website|showcases|examples|templates|flatpak|status|docs`;

/** Whitespace, a shell separator, or a QUOTE — see {@link invokesRepoPath}. */
const BOUNDARY = String.raw`(?:^|[\s;&|("'` + '`' + String.raw`])`;

/**
 * Does this `run:` line invoke something that lives in the repository?
 *
 * The interpreter forms this repo actually writes, plus a bare relative path. A bare command
 * (`gh`, `npm`, `docker`) is NOT one: those resolve on PATH and need no workspace.
 *
 * `gjs` IS ONE OF THEM, and leaving it out left out the interpreter this project bootstraps
 * from (ADR 0002) — `gjs -m packages/infra/cli/dist/affected.gjs.mjs` is live in `main.yml`.
 * And the boundary before the interpreter accepts a QUOTE as well as whitespace, because this
 * repo's dominant idiom wraps the real command in one: dozens of
 * `su testuser -c "cd … && gjs -m dist/cli.gjs.mjs …"` lines, none of which a whitespace-only
 * boundary can see inside.
 *
 * NOT covered, deliberately: `npm run x` / `gjsify run x`, where the script name is a manifest
 * key rather than a path. Naming those would mean resolving manifests, and a job that runs one
 * installs first — which needs the tree anyway, through a path this check already sees.
 */
export function invokesRepoPath(text) {
    return (
        new RegExp(
            `${BOUNDARY}(?:node|gjs|bash|sh|python3?)\\s+(?:-{1,2}[\\w-]+(?:=\\S+)?\\s+)*(?:\\./)?(?:${REPO_DIRS})/`,
        ).test(text) || new RegExp(`${BOUNDARY}\\./(?:${REPO_DIRS})/`).test(text)
    );
}

const problems = [];
let jobsRead = 0;
let jobsNeedingCheckout = 0;
const unreadable = [];

const files = readdirSync(WORKFLOWS).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
if (files.length === 0) {
    console.error('check-workflow-script-checkout: no workflow files found — that is a broken scan.');
    process.exit(1);
}

for (const file of files.sort()) {
    const path = join(WORKFLOWS, file);
    const raw = readFileSync(path, 'utf8').split('\n');
    const structure = withoutBlockScalars(raw);

    const spans = jobSpans(structure);
    // A FILE THIS READER CANNOT SEE INTO IS THE FAILURE, not a file with nothing to say. The
    // sibling states the rule and the reason: "being unable to read them IS the failure —
    // otherwise the one leg that exists to check PowerShell would pass by skipping all of it"
    // (`check-workflow-run-syntax.mjs`). Measured shapes that yield nothing: a flow-style
    // `jobs: {…}`, and a file whose job keys this lexer does not recognise.
    if (spans.length === 0) {
        unreadable.push(relative(ROOT, path));
        continue;
    }

    for (const span of spans) {
        jobsRead += 1;
        const structureBody = structure.slice(span.start, span.end).map(withoutComment).join('\n');

        // A job that only CALLS another workflow has no steps of its own, and the called
        // workflow checks out for itself. Job-level `uses:` sits one indent under the job key;
        // a STEP's `uses:` is deeper, and that one is handled below.
        // Four spaces: a job key sits two in under `jobs:`, its own keys two deeper.
        if (/^\s{4}uses:\s*\S/m.test(structureBody)) continue;

        // `run:` bodies, comment-stripped: a repo path inside a `#` comment or an `echo` of a
        // reproduction hint is not a call, and reading raw lines made both of them one. The
        // blast radius was measured at 0 live jobs — this keeps it there.
        const runs = [];
        for (let i = span.start; i < span.end; i += 1) {
            const line = raw[i];
            const inline = /^\s*(?:-\s+)?run:\s*(\S.*?)\r?$/.exec(line);
            if (inline !== null && !/^[|>]/.test(inline[1])) {
                runs.push(withoutComment(inline[1]));
                continue;
            }
            if (!/^\s*(?:-\s+)?run:\s*[|>][-+0-9]*\s*(?:#.*)?\r?$/.test(line)) continue;
            const keyIndent = (line.match(/^\s*/) ?? [''])[0].length;
            for (let j = i + 1; j < span.end; j += 1) {
                if (raw[j].trim() === '') continue;
                if ((raw[j].match(/^\s*/) ?? [''])[0].length <= keyIndent) break;
                runs.push(withoutComment(raw[j]));
            }
        }

        const calls = runs.filter((r) => invokesRepoPath(r));
        // A LOCAL composite action needs the repo on disk before it can even be resolved, and
        // `.github/actions/gjsify-setup/action.yml` says so in its own header. A step-level
        // `uses: ./…` is therefore a call like any other.
        const localAction = /^\s+-?\s*uses:\s*\.\//m.exec(structureBody);
        if (calls.length === 0 && localAction === null) continue;
        jobsNeedingCheckout += 1;

        if (/uses:\s*actions\/checkout@/.test(structureBody)) continue;

        const what =
            calls.length > 0
                ? `first call: ${calls[0].trim().slice(0, 100)}`
                : `local action: ${localAction[0].trim()}`;
        problems.push(
            `${relative(ROOT, path)}: job \`${span.name}\` needs the repository on disk and never checks it out.\n` +
                `    ${what}\n` +
                '    The step will die with `Cannot find module` on a runner whose workspace is empty — and if it is\n' +
                '    a probe READER, it fails the job it exists to report on. Add `uses: actions/checkout@v6`.',
        );
    }
}

if (unreadable.length > 0) {
    console.error(
        `check-workflow-script-checkout: ${unreadable.length} workflow(s) whose jobs this reader could not see:\n` +
            unreadable.map((f) => `  - ${f}`).join('\n') +
            '\n\n  A file that reads as "no jobs" passes every rule below by having nothing to check. Fix the\n' +
            '  reader — a skip nobody counts is how a checker that stopped understanding a shape reads exactly\n' +
            '  like a repository with nothing to answer for.',
    );
    process.exit(1);
}

if (problems.length > 0) {
    console.error(
        `check-workflow-script-checkout: ${problems.length} job(s) need the repository and never check it out:\n`,
    );
    for (const p of problems) console.error(`  - ${p}\n`);
    process.exit(1);
}

console.log(
    `check-workflow-script-checkout: ${jobsRead} job(s) across ${files.length} workflow(s); ` +
        `${jobsNeedingCheckout} run a repository script, and every one of them checks the repository out.`,
);
