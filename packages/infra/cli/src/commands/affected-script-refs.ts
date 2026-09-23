// SPDX-License-Identifier: MIT
// Who READS a root `scripts/*` file — the edge the `affected` closure walk has no way to see.
//
// WHY THIS EXISTS. `scripts/` belongs to no workspace, so every change there used to land in
// `unmatched` and buy a FULL `main.yml` run. Measured over the 60 PRs before #1774: 33 went
// full for that reason alone, and most of them touched only a website or gallery gate that
// `audit-runtimes.yml` runs and `main.yml` never opens. The full run was never wrong — it was
// the classifier saying "I cannot tell" about a question the tree answers: a script matters to
// `main.yml` exactly when something `main.yml` builds or runs names it.
//
// So a changed root script is REPLACED by the files that name it, and those go through the
// ordinary IGNORE → GLOBAL → workspace mapping. A spec that imports it seeds its workspace; a
// workspace build script that runs it seeds that workspace; a sibling workflow that runs it is
// IGNOREd like the workflow itself; `.github/actions`, `tests/e2e/**` or anything else the
// classifier does not model still forces the full run. A script that names another script
// hands the question on (`affected-classify.ts` walks that recursively).
//
// THE MATCH IS DELIBERATELY LOOSE, because it may only fail towards running MORE. It is the
// script's file name (stem plus a JS/TS extension, `.d.mts` included), not an import
// statement: `join(root, 'scripts', 'x.mjs')` and `node scripts/x.mjs` are both reads, and a
// parser for "is this an import" would miss the first. The price is that an error message
// naming a script counts as a reader too — measured, that turns some script changes back
// into full runs, which is the direction this is allowed to be wrong in. Comment lines are
// dropped first; without that, the prose cross-references in this repository chain every
// script to every other one and the whole mechanism collapses back into "run everything".
//
// TWO READERS ARE NARROWED, and each narrowing is a claim about `main.yml`'s shape:
//   · `main.yml` itself counts only from a job that (transitively) `needs: changes`. A job
//     that does not — `tree-checks` today — runs on every PR whatever this classifier says,
//     so a script it runs cannot be skipped by anything decided here.
//   · the root `package.json` counts only when the script is named outside `scripts`, or by
//     a lifecycle/build/test entry, or by an entry another root script or a gated `main.yml`
//     job runs. The `check:*` conveniences that only a person or a sibling workflow invokes
//     are not `main.yml` inputs.
//
// NOT SEEN, stated so nobody reads this as more: a reader that builds the file name at run
// time, and a tool that walks `scripts/` as a directory. The second shape exists
// (`generate-status.mjs`, `check-comment-budget.mjs`) but only in jobs outside `main.yml`'s
// gated set. Push-to-main and the nightly still run the FULL suite.

import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';

/** Every file that names `scriptPath`, as repo-relative paths. */
export type ScriptReferrers = (scriptPath: string) => readonly string[];

const MAIN_WORKFLOW = '.github/workflows/main.yml';
const ROOT_MANIFEST = 'package.json';

/** Larger files are data (lockfile, generated corpora), never a script's reader. */
const MAX_TEXT_BYTES = 2 * 1024 * 1024;

/**
 * A root package.json entry whose run is part of installing, building or testing the tree.
 * Not `check:*`: those are single-gate conveniences (`node scripts/check-….mjs`), and the
 * one `main.yml` does run (`check:examples`) is caught by name in the workflow instead.
 */
const LIFECYCLE_SCRIPT = /^(pre|post)?(install|prepare|build|test)(:|$)/;

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Comment lines out: `#` for YAML, shell, git and Docker files, `//` + block-comment lines
 * for everything else. `#` is not stripped from JS, where a line may open with a private
 * field.
 */
function stripCommentLines(path: string, text: string): string {
    const hashComments = /\.(ya?ml|sh|bash|py|toml)$|(^|\/)\.git[a-z]*$|Dockerfile$/.test(path);
    const comment = hashComments ? /^\s*#/ : /^\s*(\/\/|\/\*|\*)/;
    return text
        .split('\n')
        .filter((line) => !comment.test(line))
        .join('\n');
}

/**
 * The file-name pattern for a script: `adwaita-elements.mjs` is also read as
 * `adwaita-elements.d.mts` (a TS import of the `.mjs` resolves to its declaration) and a
 * `.d.mts` change is read through its `.mjs`. The leading boundary excludes `-` so
 * `value-types.mjs` does not match `generate-value-types.mjs`.
 */
export function scriptNamePattern(scriptPath: string): RegExp {
    // A git path, always `/`-separated whatever the host: POSIX basename, not the host's.
    const base = posix.basename(scriptPath);
    const js = /^(.*?)(\.d)?\.[mc]?[jt]sx?$/.exec(base);
    const tail = js ? `${escapeRe(js[1]!)}(\\.d)?\\.[mc]?[jt]sx?\\b` : `${escapeRe(base)}\\b`;
    return new RegExp(`(^|[^\\w.-])${tail}`);
}

interface WorkflowLine {
    job: string | undefined;
    text: string;
}

/**
 * Jobs of `main.yml` that depend, directly or through `needs:`, on the `changes` job — the
 * ones the classifier can switch off. Comment lines are already gone: `setup`'s comments
 * NAME `needs.changes.outputs.*`, and counting that made `tree-checks` look gated.
 */
function gatedJobs(lines: readonly WorkflowLine[]): Set<string> {
    const needs = new Map<string, string[]>();
    const mentionsChanges = new Set<string>();
    for (const { job, text } of lines) {
        if (!job) continue;
        if (!needs.has(job)) needs.set(job, []);
        const n = /^ {4}needs:\s*\[(.*)\]/.exec(text) ?? /^ {4}needs:\s*([A-Za-z0-9_-]+)\s*$/.exec(text);
        if (n)
            needs.set(
                job,
                n[1]!
                    .split(',')
                    .map((d) => d.trim())
                    .filter(Boolean),
            );
        // A block-list `needs:` is a spelling this parse does not read, so the job counts
        // as gated: misreading one here could only ever skip less.
        if (/needs\.changes\b/.test(text) || /^ {4}needs:\s*$/.test(text)) mentionsChanges.add(job);
    }
    const gated = new Set<string>(['changes', ...mentionsChanges]);
    let grew = true;
    while (grew) {
        grew = false;
        for (const [j, deps] of needs) {
            if (!gated.has(j) && deps.some((d) => gated.has(d))) {
                gated.add(j);
                grew = true;
            }
        }
    }
    // `changes` itself runs the classifier; it is not switched off by it.
    gated.delete('changes');
    return gated;
}

function workflowLines(text: string): WorkflowLine[] {
    const lines = text.split('\n');
    const out: WorkflowLine[] = [];
    let job: string | undefined;
    let inJobs = false;
    for (const line of lines) {
        if (/^jobs:\s*$/.test(line)) inJobs = true;
        else if (/^\S/.test(line)) inJobs = false;
        const key = inJobs ? /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line) : null;
        if (key) job = key[1];
        if (/^\s*#/.test(line)) continue;
        out.push({ job: inJobs ? job : undefined, text: line });
    }
    return out;
}

/**
 * Build the reader lookup over `texts` (repo-relative path → raw content). Pure: the command
 * feeds it `git ls-files`, the spec feeds it a fixture map.
 */
export function buildScriptReferrers(texts: ReadonlyMap<string, string>): ScriptReferrers {
    const stripped = new Map<string, string>();
    for (const [path, text] of texts) {
        if (path === MAIN_WORKFLOW || path === ROOT_MANIFEST) continue;
        stripped.set(path, stripCommentLines(path, text));
    }

    const workflowText = texts.get(MAIN_WORKFLOW);
    const workflow = workflowText === undefined ? [] : workflowLines(workflowText);
    const gated = gatedJobs(workflow);
    // Top-level workflow keys (`env:`) reach every job, so they count as gated too.
    const gatedWorkflowNames = (re: RegExp): boolean =>
        workflow.some((l) => re.test(l.text) && (l.job === undefined || gated.has(l.job)));

    let manifest: { scripts?: Record<string, string>; [k: string]: unknown } | undefined;
    const manifestText = texts.get(ROOT_MANIFEST);
    if (manifestText !== undefined) manifest = JSON.parse(manifestText) as typeof manifest;

    const manifestReads = (re: RegExp): boolean => {
        if (!manifest) return false;
        for (const [k, v] of Object.entries(manifest)) {
            if (k !== 'scripts' && re.test(JSON.stringify(v))) return true;
        }
        const scripts = manifest.scripts ?? {};
        for (const [key, value] of Object.entries(scripts)) {
            if (!re.test(value)) continue;
            if (LIFECYCLE_SCRIPT.test(key)) return true;
            const byName = new RegExp(`(^|[\\s"'])${escapeRe(key)}($|[\\s"'&;|])`);
            if (Object.entries(scripts).some(([other, v]) => other !== key && byName.test(v))) return true;
            if (gatedWorkflowNames(byName)) return true;
        }
        return false;
    };

    return (scriptPath) => {
        const re = scriptNamePattern(scriptPath);
        const readers: string[] = [];
        for (const [path, text] of stripped) {
            if (path !== scriptPath && re.test(text)) readers.push(path);
        }
        if (gatedWorkflowNames(re)) readers.push(MAIN_WORKFLOW);
        if (manifestReads(re)) readers.push(ROOT_MANIFEST);
        return readers.sort();
    };
}

/**
 * Every tracked text file under `rootDir`, for {@link buildScriptReferrers}. Throws when git
 * cannot list the tree — the caller then classifies without the lookup, which is the old,
 * conservative behaviour (a root script lands in `unmatched`).
 */
export function readTrackedTexts(rootDir: string): Map<string, string> {
    const r = spawnSync('git', ['ls-files', '-z'], { cwd: rootDir, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ls-files failed (${r.status}): ${String(r.stderr).trim()}`);
    const texts = new Map<string, string>();
    for (const path of r.stdout.split('\0')) {
        if (!path || path.startsWith('refs/')) continue;
        const abs = join(rootDir, path);
        // A gitlink (submodule) is listed but is a directory; a deleted-but-staged path is
        // listed and absent. Neither can name a script.
        const st = statSync(abs, { throwIfNoEntry: false });
        if (!st?.isFile() || st.size > MAX_TEXT_BYTES) continue;
        const text = readFileSync(abs, 'utf8');
        if (text.includes('\0')) continue;
        texts.set(path, text);
    }
    return texts;
}
