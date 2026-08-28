#!/usr/bin/env node
// Holds each source tree's comment-to-code ratio at or below a committed ceiling.
//
// What this is for: comment volume has no natural limit. Nothing failed while
// `packages/infra/cli/src/cli-fail.ts` grew a 47-line yargs research diary above a
// 3-line function (ratio 9.3), while `rolldown-plugin-gjsify` reached one comment
// line per code line, or while `scripts/` reached 0.77 — and the cost lands on
// every reader and every agent context afterwards. A cleanup without a ratchet
// grows straight back; this is the ratchet.
//
// The ceilings in `status/comment-budget.json` are MEASURED, not chosen: each is
// what that tree actually had when it was last cleaned. A ratio rather than a line
// count, because new code arrives with proportionate comments and a line budget
// would block a new package while a ratio does not.
//
// REPORTED IN CI, NOT GATED, and that is a deliberate exception to this repo's own
// rule — `reportUnusedDisableDirectives` in `.oxlintrc.json` records what it learned
// about checks that only warn, and the rule holds for checks that assert a FACT. This
// one scores a PROXY, and three measurements decided it:
//
//   - The proxy is satisfiable without removing a word. Classification is by how a
//     line STARTS, so moving a full-line comment to the end of a code line drops the
//     comment count and leaves the code count untouched. ~1670 trailing comments are
//     already invisible to it.
//   - As a whole-tree aggregate behind a required check it is a shared counter every
//     branch contends for (#1157), and `--update` re-baselines to exactly the measured
//     value, so trees sit at zero headroom.
//   - It is a ratio, so a commit that only DELETES code raises it. A pure cleanup can
//     turn a green branch red for a reason unrelated to it.
//
// Blocking power over unrelated work is more than that earns. The table still prints
// every run and each over-ceiling tree raises a visible warning, so drift stays
// observable; the ledger's own integrity (a stale or missing ceiling) still fails,
// because that is a fact rather than a score.
//
//   node scripts/check-comment-budget.mjs            # print the table
//   node scripts/check-comment-budget.mjs --warn     # report + annotate (CI)
//   node scripts/check-comment-budget.mjs --check    # gate (local, cleanup commits)
//   node scripts/check-comment-budget.mjs --update   # re-baseline after a cleanup
//   node scripts/check-comment-budget.mjs --files    # the files it counts
//   node scripts/check-comment-budget.mjs --scope    # the tracked files it is ABOUT,
//                                                    # before the extension question
//
// Raising a ceiling is a reviewed, one-line commit. Lowering one is free, and
// `--update` after a cleanup does it — so the budget only tightens.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

import {
    CODE_SOURCE_EXTENSIONS,
    isDeclarationFile,
    sourcePathspecs,
} from '../packages/infra/manifest-conformance/lib/source-extensions.mjs';

const BUDGET_FILE = 'status/comment-budget.json';

// Not ours to shape: vendored upstream sources, generator output, build products.
const EXCLUDED = [
    /^refs\//,
    /^packages\/infra\/tsc\/lib\//,
    /\/(lib|dist|node_modules)\//,
    /devtools-cdp\/src\/spec-data\.ts$/,
    /gtk-host\/src\/generated\//,
    /adwaita-icons\/(actions|categories|devices|emotes|index|legacy|mimetypes|places|status|ui)\.ts$/,
];

// One row per tree that owns its own commenting culture. First match wins, so a
// more specific prefix must precede the pillar it sits in.
const AREAS = [
    'packages/infra/cli',
    'packages/infra',
    'packages/node-gi',
    'packages/napi',
    'packages/node',
    'packages/web',
    'packages/dom',
    'packages/framework',
    'packages/nativescript-bridge',
    'packages/gjs',
    'tests',
    'scripts',
    'examples',
    'showcases',
    'website',
];

/** The area a path is budgeted under, or `undefined` if it is outside every tree. */
const areaOf = (file) => AREAS.find((a) => file.startsWith(`${a}/`));

/**
 * Tracked files this budget is ABOUT, before any extension question is asked —
 * `scripts/check-source-visibility.mjs` reads this through `--scope` and asks the
 * shared vocabulary which of them are source, so the two halves of that check are
 * this script's own scoping and one repository-wide extension list, never a second
 * copy of either.
 *
 * @param {readonly string[] | null} pathspecs
 */
function trackedFiles(pathspecs) {
    const spec = pathspecs === null ? '' : ` -- ${pathspecs.map((p) => `'${p}'`).join(' ')}`;
    return execSync(`git ls-files${spec}`, { maxBuffer: 1 << 28 })
        .toString()
        .trim()
        .split('\n')
        .filter((f) => f && !isDeclarationFile(f) && !EXCLUDED.some((r) => r.test(f)) && areaOf(f) !== undefined);
}

/**
 * The files this budget counts.
 *
 * The extension list used to be five literals here — `'*.ts' '*.mts' '*.mjs' '*.js'
 * '*.cjs'` — written before the tree had a `.tsx` file in it. Measured on 2026-08-28:
 * 19 tracked `.tsx` files went uncounted, 12 in `packages/framework` and 7 in
 * `showcases/gtk`, and folding them in moves `showcases` from 0.153 to 0.170 against a
 * ceiling of 0.158 that had been reading as 78 lines of headroom. A budget that does
 * not open a file cannot hold it to anything.
 */
function sourceFiles() {
    return trackedFiles(sourcePathspecs(CODE_SOURCE_EXTENSIONS));
}

/**
 * Comment and code line counts, classified by how the trimmed line STARTS.
 *
 * This used to claim the ratio "cannot be gamed by moving a comment onto a code line
 * — that line then counts as code and the tree's code total rises with it". Measured,
 * it does not: the code line was ALREADY code, so appending a trailing comment leaves
 * the code count unchanged and only drops the comment count. `// why` above
 * `doThing();` scores 1/1; `doThing(); // why` scores 0/1. Trailing comments are free
 * here, which is one of the reasons this is a report rather than a gate.
 *
 * @param {string} src
 */
function countLines(src) {
    let code = 0;
    let comment = 0;
    let inBlock = false;
    for (const raw of src.split('\n')) {
        const t = raw.trim();
        if (inBlock) {
            comment++;
            if (t.includes('*/')) inBlock = false;
            continue;
        }
        if (!t) continue;
        if (t.startsWith('/*')) {
            comment++;
            if (!t.includes('*/')) inBlock = true;
            continue;
        }
        if (t.startsWith('//')) {
            comment++;
            continue;
        }
        code++;
    }
    return { code, comment };
}

function measure() {
    const totals = new Map(AREAS.map((a) => [a, { code: 0, comment: 0, files: 0 }]));
    for (const file of sourceFiles()) {
        const area = areaOf(file);
        if (!area) continue;
        let src;
        try {
            src = readFileSync(file, 'utf8');
        } catch {
            continue;
        }
        const { code, comment } = countLines(src);
        const t = totals.get(area);
        t.code += code;
        t.comment += comment;
        t.files++;
    }
    return totals;
}

/** @param {{code: number, comment: number}} t */
const ratio = (t) => (t.code === 0 ? 0 : t.comment / t.code);

// One part in 2000, absorbing the rounding in the committed ceiling so a
// re-baselined tree does not fail its own value.
const TOLERANCE = 0.0005;

/**
 * The most comment lines a tree may hold and still pass — the ONE number both the
 * verdict and the advice are read off, so they cannot disagree.
 *
 * They did: the gate compared the ratio against `ceiling + TOLERANCE` while the
 * advice reported against `ceiling * code`, so the message asked for a cut the gate
 * did not require, by a margin that scaled with the tree — 6 lines on
 * `packages/infra`, 44 on `packages/node`. The message directly below names what
 * has to survive a trim (the incident behind a rule, GI quirks, error text); an
 * inflated number is spent on exactly that material.
 *
 * @param {number} ceiling @param {number} code
 */
const allowedComments = (ceiling, code) => Math.floor((ceiling + TOLERANCE) * code);

/**
 * The other side of the same ratio: the code total at which today's comments fit. Printed
 * next to the cut because a message that only ever says "cut N" teaches that deletion is
 * the safe direction, and it is not — #1156 lost 27 lines of headroom by removing ~10
 * code lines and adding no comment at all. Read by both surfaces, so they cannot drift
 * into advising half of a two-sided quantity.
 * @param {number} comment @param {number} ceiling
 */
const codeToFit = (comment, ceiling) => Math.ceil(comment / (ceiling + TOLERANCE));

/**
 * Answer a visibility probe and stop, before anything is measured — these are what
 * `check-source-visibility.mjs` diffs, and a probe that had to run the whole budget
 * first would make that gate pay for this one's file reads.
 *
 * `writeFileSync(1, …)` and NOT `process.stdout.write`: on Linux a piped stdout is an
 * ASYNC stream, so `process.exit()` beside it drops whatever has not drained. Measured
 * here — the 5097-line `--scope` answer came back truncated at a different point on
 * different runs, and the reader differenced a complete `--files` list against a partial
 * scope and reported the tail as files the walker reads outside its own scope. A
 * truncated answer is the same defect this whole gate is about, one layer down: the
 * consumer cannot tell "not in scope" from "you stopped talking".
 *
 * @param {string[]} files
 */
function answerProbe(files) {
    writeFileSync(1, files.length === 0 ? '' : `${files.join('\n')}\n`);
    process.exit(0);
}

if (process.argv.includes('--files')) answerProbe(sourceFiles());
if (process.argv.includes('--scope')) answerProbe(trackedFiles(null));

const mode = process.argv.includes('--check')
    ? 'check'
    : process.argv.includes('--update')
      ? 'update'
      : process.argv.includes('--warn')
        ? 'warn'
        : 'print';

const totals = measure();

if (mode === 'update') {
    /** @type {Record<string, number>} */
    const previous = existsSync(BUDGET_FILE) ? JSON.parse(readFileSync(BUDGET_FILE, 'utf8')) : {};
    /** @type {Record<string, number>} */
    const out = {};
    const moved = [];
    for (const area of AREAS) {
        const t = totals.get(area);
        if (t.files === 0) continue;
        // ONLY EVER TIGHTENS, as the header has always promised and the code did not do:
        // it wrote the measured value unconditionally, so `--update` on a GROWN tree
        // raised the ceiling to fit — measured here, `scripts` 0.586 -> 0.591, blessing
        // the exact drift the ratchet exists to catch. Raising stays possible as a
        // reviewed edit to the ledger, in the commit that needs it.
        const measured = Number(ratio(t).toFixed(3));
        const stored = previous[area];
        out[area] = stored === undefined ? measured : Math.min(stored, measured);
        if (out[area] !== stored) moved.push(`${area}: ${stored === undefined ? 'new' : stored} -> ${out[area]}`);
    }
    writeFileSync(BUDGET_FILE, `${JSON.stringify(out, null, 4)}\n`);
    process.stdout.write(`check-comment-budget: wrote ${BUDGET_FILE} (${Object.keys(out).length} areas)\n`);
    for (const m of moved) process.stdout.write(`  ${m}\n`);
    process.exit(0);
}

if (!existsSync(BUDGET_FILE)) {
    process.stderr.write(`check-comment-budget: ${BUDGET_FILE} is missing. Run with --update to baseline it.\n`);
    process.exit(2);
}

/** @type {Record<string, number>} */
const budget = JSON.parse(readFileSync(BUDGET_FILE, 'utf8'));

const rows = [];
const failures = [];
for (const area of AREAS) {
    const t = totals.get(area);
    if (t.files === 0) continue;
    const have = ratio(t);
    const ceiling = budget[area];
    // Compared in LINES, not in ratios, so the verdict and the "cut N lines" advice
    // are the same statement. Exactly equivalent to `have > ceiling + TOLERANCE`.
    const allowed = ceiling === undefined ? Number.POSITIVE_INFINITY : allowedComments(ceiling, t.code);
    const over = t.comment > allowed;
    rows.push({ area, ...t, have, ceiling, allowed, over });
    if (over) failures.push({ area, have, ceiling, comment: t.comment, code: t.code, allowed });
}

const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);
// `spare` is printed while PASSING too, and that is the point: it is the number a
// reader wants before spending it, and the obvious way to work it out by hand —
// `ceiling * code` — is the very formula this script stopped using, so leaving it
// unprinted invites the wrong arithmetic. Both authors of the change that added it
// computed a margin by hand and both got it too low.
process.stdout.write(
    `${pad('area', 32)}${lpad('files', 6)}${lpad('code', 9)}${lpad('comment', 9)}${lpad('ratio', 8)}${lpad('ceiling', 9)}${lpad('spare', 7)}\n`,
);
for (const r of rows) {
    const spare = Number.isFinite(r.allowed) ? r.allowed - r.comment : '-';
    process.stdout.write(
        `${pad(r.area, 32)}${lpad(r.files, 6)}${lpad(r.code, 9)}${lpad(r.comment, 9)}` +
            `${lpad(r.have.toFixed(3), 8)}${lpad(r.ceiling === undefined ? '-' : r.ceiling.toFixed(3), 9)}` +
            `${lpad(spare, 7)}${r.over ? '  OVER' : ''}\n`,
    );
}

// A ceiling for a tree with no source files is a claim nothing checks.
const stale = Object.keys(budget).filter((a) => !rows.some((r) => r.area === a));
for (const area of stale) {
    process.stderr.write(
        `\ncheck-comment-budget: ${BUDGET_FILE} budgets '${area}', which has no source files. ` +
            'Remove the entry or fix the path.\n',
    );
}

// A tree with no ceiling is unbudgeted — the gate would pass by saying nothing.
const unbudgeted = rows.filter((r) => r.ceiling === undefined).map((r) => r.area);
for (const area of unbudgeted) {
    process.stderr.write(
        `\ncheck-comment-budget: '${area}' has source files but no ceiling in ${BUDGET_FILE}. ` +
            'Run --update to baseline it.\n',
    );
}

// `--warn` is what CI runs: the table above plus one Actions warning per tree that
// is over, so drift stays observable without the power to stop an unrelated branch.
// Structural problems (a stale or missing ceiling) still fail, because those are
// facts about the ledger rather than a score.
if (mode === 'warn') {
    for (const f of failures) {
        process.stdout.write(
            `::warning title=comment budget: ${f.area}::at ${f.have.toFixed(3)} per code line, over its ` +
                `ceiling of ${f.ceiling.toFixed(3)} by ${f.comment - f.allowed} comment line(s). Cut that many, ` +
                `or reach ${codeToFit(f.comment, f.ceiling)} code lines — it is a RATIO, so DELETING CODE raises ` +
                'it and a commit that removes dead code without adding a comment can land here. ' +
                'Reported, not gated — run --check locally before a cleanup commit.\n',
        );
    }
    process.exit(stale.length + unbudgeted.length > 0 ? 1 : 0);
}

if (mode !== 'check') process.exit(stale.length + unbudgeted.length > 0 ? 1 : 0);

for (const f of failures) {
    process.stderr.write(
        `\ncheck-comment-budget: ${f.area} is at ${f.have.toFixed(3)} comment lines per code line, ` +
            `over its committed ceiling of ${f.ceiling.toFixed(3)} — ${f.comment} comment lines against ` +
            `${f.code} code lines, ${f.comment - f.allowed} more than the ${f.allowed} that ceiling allows. ` +
            `Cutting ${f.comment - f.allowed} passes; cutting more than that is spending headroom you do not owe.\n` +
            `  Two levers, because it is a RATIO: CUT ${f.comment - f.allowed} COMMENT LINES, or reach\n` +
            `  ${codeToFit(f.comment, f.ceiling)} CODE LINES (currently ${f.code}). Read backwards, that is why DELETING CODE\n` +
            '  raises it: a commit that only removes dead code, adding no comment at all, can land\n' +
            '  here. Check the code column before assuming a deletion is the safe direction.\n' +
            '  Comment WHY, not WHAT: a comment that restates the code is a second copy that drifts.\n' +
            '  What usually has to go: restatement, narrative history ("previously we…", "ported from…"),\n' +
            '  upstream source coordinates a reader cannot act on, and change-log entries git already has.\n' +
            '  What stays: the incident behind a rule, GI/GNOME quirks, spec links, error text,\n' +
            '  and the reason a kept `catch` is kept.\n' +
            `  If the tree genuinely needs more commentary, raise its ceiling in ${BUDGET_FILE}\n` +
            '  in the same commit, so the increase is reviewed rather than accumulated.\n',
    );
}

if (failures.length + stale.length + unbudgeted.length === 0) {
    process.stdout.write('\ncheck-comment-budget: every tree is within its committed ceiling.\n');
    process.exit(0);
}
process.exit(1);
