#!/usr/bin/env node
// Holds every agent context file to the 32 KiB hard cap, and its GROWTH since the PR
// base to a small tolerance.
//
// Why this is a gate and not a note in AGENTS.md: these files are loaded on EVERY
// agent turn, so their size is a permanent tax on every task in the repo, and nothing
// in the tree pushes back when one grows. The root file reached 277 KB before it was
// split, one defensible paragraph at a time — every paragraph arrived with a reason,
// which is exactly why prose alone could not stop it.
//
// Two limits, different kinds:
//   HARD    32 KiB — `project_doc_max_bytes`. Codex silently truncates the tail past
//           this with no warning, so the end of an oversized file is not "less
//           prominent", it is ABSENT. Never waivable, independent of the growth check
//           below — a file can be under its growth tolerance and still over this.
//   GROWTH  more than `GROWTH_TOLERANCE` bytes above the file's size AT THE PR BASE
//           (or, on a push to `main`/`merge_group`, at the immediate parent commit).
//
// THIS USED TO BE AN EXACT COMMITTED LEDGER (`status/agent-context-budget.json`), one
// line per file, re-baselined by `--update` on every touch — including a touch that
// only SHRANK a file, because the ledger was exact rather than an upper bound. That
// closed the real race #1157 measured (two branches each spending the same slack in
// full, landing `main` over a ceiling neither PR's own run saw), but the ledger line
// became the thing every AGENTS.md edit collided over: it was rewritten in 77 commits
// since 2026-09-01, the overwhelming majority nothing but a byte count following a
// file that shrank.
//
// This check compares against the PR's OWN BASE instead of a shared committed number,
// so it no longer needs a ledger to collide in: a file that shrank needs no companion
// edit (there is no line to it forget to update), and two branches growing the SAME
// file by more than `GROWTH_TOLERANCE` each still fail on THEIR OWN diff — no shared
// state for them to race over. What #1157's shape can still do here is narrower: two
// branches each growing the SAME file by exactly the same amount, both within
// tolerance, merge clean and land a combined jump `main` never measured on either PR.
// The push-to-main run (BASE = the immediate parent, i.e. the commit that just landed)
// is what catches that residual — on the very next commit to touch the file, not
// silently — trading a rare red `main` for removing the ledger PRs were colliding over
// on every ordinary edit. `docs/governance.md` § Agent context budget has the reasoning
// and the arithmetic.
//
// A file that genuinely needs to grow past its tolerance opts in with a commit
// trailer, scanned across every commit in the compared range:
//
//   Context-Budget: grow <path>
//
// one line per file that needs the room. A trailer (not a PR label) because this same
// check runs again on `push` to `main` after the PR that added the trailer has already
// closed — a label lives on the PR object, a trailer survives inside the landed
// commit's own message, which is the only thing both runs can read with plain git and
// no GitHub API call.
//
// Usage:
//   node scripts/check-agent-context-size.mjs                       # print the table
//   node scripts/check-agent-context-size.mjs --check                # gate (CI)
//   node scripts/check-agent-context-size.mjs --check --base <ref>   # explicit base
//
// BASE, when `--base` is not given: `HEAD^` on a `push`/`merge_group` event
// (`GITHUB_EVENT_NAME`), else `origin/$GITHUB_BASE_REF` (a pull request), else
// `origin/main` (local, or any other context). The comparison point is then
// `git merge-base(<that ref>, HEAD)` — same as `scripts/check-doc-revert.mjs` — so a
// shallow clone without that history SKIPS the growth check cleanly (the HARD cap
// still runs; it needs no history) rather than crashing. Deepen first in CI:
// `git fetch --no-tags --quiet --deepen=200 origin <ref>`.
//
// A `CLAUDE.md` that is a real file rather than a symlink to `AGENTS.md` is also an
// error: both get loaded, so the tax doubles and the second copy drifts.

import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';

const HARD_CAP = 32 * 1024;
// Large enough that a typo fix, a link update or a reworded sentence never trips it;
// small enough that a genuine new paragraph does. Not measured the way the ceilings it
// replaces were — those were "what the tree had when last reviewed", which is exactly
// the number a fixed tolerance cannot be, because it must hold for every file at once.
const GROWTH_TOLERANCE = 512;

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
    const i = argv.indexOf(name);
    return i === -1 ? fallback : argv[i + 1];
};
const mode = argv.includes('--check') ? 'check' : 'print';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28 });

function resolveBaseRef(explicit) {
    if (explicit) return explicit;
    const event = process.env.GITHUB_EVENT_NAME;
    if (event === 'push' || event === 'merge_group') return 'HEAD^';
    if (process.env.GITHUB_BASE_REF) return `origin/${process.env.GITHUB_BASE_REF}`;
    return 'origin/main';
}

const baseRef = resolveBaseRef(flag('--base', undefined));

/** Resolved once: null means no usable common history (SKIP growth, not a failure). */
let mergeBase = null;
try {
    // stderr silenced: "no merge base" / "unknown revision" is an EXPECTED answer on a
    // shallow clone or a repo with no parent commit, not a bug in this script.
    mergeBase = execFileSync('git', ['merge-base', baseRef, 'HEAD'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
} catch {
    mergeBase = null;
}

/** Bytes of `file` at `mergeBase`, or `0` if the file did not exist there yet. */
function bytesAtBase(file) {
    try {
        return Buffer.byteLength(
            execFileSync('git', ['show', `${mergeBase}:${file}`], {
                maxBuffer: 1 << 28,
                stdio: ['ignore', 'pipe', 'ignore'],
            }),
        );
    } catch {
        return 0; // new file — its whole size is growth, by construction.
    }
}

/**
 * Every path with a `Context-Budget: grow <path>` trailer in the compared range
 * (`mergeBase..HEAD` — just HEAD's own message when `mergeBase` IS HEAD, e.g. a local
 * `--base HEAD` dry run; git treats `X..X` as an empty, valid range either way).
 */
function approvedPaths() {
    if (mergeBase === null) return new Set();
    const messages = git('log', '--format=%B', `${mergeBase}..HEAD`);
    const approved = new Set();
    for (const m of messages.matchAll(/^Context-Budget:\s*grow\s+(\S+)\s*$/gm)) approved.add(m[1]);
    return approved;
}

const tracked = git('ls-files').trim().split('\n');
const contextFiles = tracked.filter((f) => /(^|\/)AGENTS\.md$/.test(f)).sort();
const claudeFiles = tracked.filter((f) => /(^|\/)CLAUDE\.md$/.test(f));

/** @type {{file: string, bytes: number, base: number|null}[]} */
const rows = contextFiles.map((file) => ({
    file,
    bytes: Buffer.byteLength(readFileSync(file)),
    base: mergeBase === null ? null : bytesAtBase(file),
}));

const approved = approvedPaths();
const failures = [];
const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);

process.stdout.write(
    `${pad('agent context file', 52)}${lpad('bytes', 8)}${lpad('base', 8)}${lpad('Δ', 8)}\n` +
        (mergeBase === null
            ? `(no usable base — comparing "${baseRef}" against HEAD found no common history; growth check SKIPPED, hard cap still runs)\n`
            : ''),
);
for (const r of rows) {
    const overHard = r.bytes > HARD_CAP;
    const delta = r.base === null ? null : r.bytes - r.base;
    const overGrowth = delta !== null && delta > GROWTH_TOLERANCE;
    const isApproved = overGrowth && approved.has(r.file);
    process.stdout.write(
        `${pad(r.file, 52)}${lpad(r.bytes, 8)}${lpad(r.base === null ? '-' : r.base, 8)}${lpad(delta === null ? '-' : (delta >= 0 ? '+' : '') + delta, 8)}` +
            `${overHard ? '  OVER 32 KiB' : overGrowth ? (isApproved ? '  GROWTH (approved)' : '  OVER growth tolerance') : ''}\n`,
    );
    if (overHard) failures.push({ ...r, kind: 'hard' });
    else if (overGrowth && !isApproved) failures.push({ ...r, delta, kind: 'growth' });
}

// A ceiling for a file that no longer exists is a claim nothing checks — the same
// invariant the old ledger held, now against a `Context-Budget:` trailer instead.
for (const path of approved) {
    if (!rows.some((r) => r.file === path)) {
        process.stderr.write(
            `\ncheck-agent-context-size: a commit in range approves growth for "${path}", which is not a ` +
                'tracked agent context file (or no longer exists). Fix the trailer or drop it.\n',
        );
        failures.push({ file: path, bytes: 0, kind: 'stale-trailer' });
    }
}

// A real CLAUDE.md is a SECOND copy of the same instructions, loaded alongside.
for (const file of claudeFiles) {
    if (!lstatSync(file).isSymbolicLink()) {
        process.stderr.write(
            `\ncheck-agent-context-size: '${file}' is a regular file, not a symlink to its AGENTS.md. ` +
                'Both are loaded, so the context tax doubles and the copies drift. Replace it with a symlink.\n',
        );
        failures.push({ file, bytes: 0, kind: 'duplicate' });
    }
}

if (mode !== 'check') process.exit(0);

for (const f of failures) {
    if (f.kind === 'hard') {
        process.stderr.write(
            `\ncheck-agent-context-size: ${f.file} is ${f.bytes} bytes, past the ${HARD_CAP}-byte ` +
                '`project_doc_max_bytes` cap. Codex truncates the tail with NO warning, so the end of this ' +
                'file is not being read at all. Move a section into `docs/` and leave the rule plus one link.\n',
        );
    } else if (f.kind === 'growth') {
        process.stderr.write(
            `\ncheck-agent-context-size: ${f.file} grew by ${f.delta} bytes since ${baseRef} ` +
                `(over the ${GROWTH_TOLERANCE}-byte tolerance). This file is loaded on every agent turn.\n` +
                '  Move the DETAIL into `docs/` and keep the rule plus one link — never delete the incident\n' +
                '  behind a rule, which is what makes the rule survive a future "simplification".\n' +
                '  If the growth is genuinely warranted, add a trailer to a commit in this PR:\n' +
                `    Context-Budget: grow ${f.file}\n`,
        );
    } else if (f.kind === 'stale-trailer') {
        // message already printed above, at the point of discovery.
    }
}

if (failures.length === 0) {
    process.stdout.write(
        mergeBase === null
            ? '\ncheck-agent-context-size: every agent context file is within the 32 KiB hard cap (growth check skipped — no base history).\n'
            : '\ncheck-agent-context-size: every agent context file is within the 32 KiB hard cap and its growth tolerance.\n',
    );
    process.exit(0);
}
process.exit(1);
