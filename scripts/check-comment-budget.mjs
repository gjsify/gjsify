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
// would block a new package while a ratio does not. A gate rather than a warning,
// because `reportUnusedDisableDirectives` in `.oxlintrc.json` already records what
// this repo learned about checks that only warn.
//
//   node scripts/check-comment-budget.mjs            # print the table
//   node scripts/check-comment-budget.mjs --check    # gate (CI)
//   node scripts/check-comment-budget.mjs --update   # re-baseline after a cleanup
//
// Raising a ceiling is a reviewed, one-line commit. Lowering one is free, and
// `--update` after a cleanup does it — so the budget only tightens.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const BUDGET_FILE = 'status/comment-budget.json';

// Not ours to shape: vendored upstream sources, generator output, build products.
const EXCLUDED = [
    /^refs\//,
    /^packages\/infra\/tsc\/lib\//,
    /\/(lib|dist|node_modules)\//,
    /devtools-cdp\/src\/spec-data\.ts$/,
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

function sourceFiles() {
    return execSync("git ls-files -- '*.ts' '*.mts' '*.mjs' '*.js' '*.cjs'", { maxBuffer: 1 << 28 })
        .toString()
        .trim()
        .split('\n')
        .filter((f) => f && !f.endsWith('.d.ts') && !EXCLUDED.some((r) => r.test(f)));
}

/**
 * Comment and code line counts. Every non-blank line is one or the other, so the
 * ratio cannot be gamed by moving a comment onto a code line — that line then
 * counts as code and the tree's code total rises with it.
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
        const area = AREAS.find((a) => file.startsWith(`${a}/`));
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

const mode = process.argv.includes('--check')
    ? 'check'
    : process.argv.includes('--update')
      ? 'update'
      : 'print';

const totals = measure();

if (mode === 'update') {
    /** @type {Record<string, number>} */
    const out = {};
    for (const area of AREAS) {
        const t = totals.get(area);
        if (t.files > 0) out[area] = Number(ratio(t).toFixed(3));
    }
    writeFileSync(BUDGET_FILE, `${JSON.stringify(out, null, 4)}\n`);
    process.stdout.write(`check-comment-budget: wrote ${BUDGET_FILE} (${Object.keys(out).length} areas)\n`);
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
    // Tolerance of one part in 2000 absorbs the rounding in the committed value,
    // so a re-baselined tree does not fail its own ceiling.
    const over = ceiling !== undefined && have > ceiling + 0.0005;
    rows.push({ area, ...t, have, ceiling, over });
    if (over) failures.push({ area, have, ceiling, comment: t.comment, code: t.code });
}

const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);
process.stdout.write(
    `${pad('area', 32)}${lpad('files', 6)}${lpad('code', 9)}${lpad('comment', 9)}${lpad('ratio', 8)}${lpad('ceiling', 9)}\n`,
);
for (const r of rows) {
    process.stdout.write(
        `${pad(r.area, 32)}${lpad(r.files, 6)}${lpad(r.code, 9)}${lpad(r.comment, 9)}` +
            `${lpad(r.have.toFixed(3), 8)}${lpad(r.ceiling === undefined ? '-' : r.ceiling.toFixed(3), 9)}` +
            `${r.over ? '  OVER' : ''}\n`,
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

if (mode !== 'check') process.exit(stale.length + unbudgeted.length > 0 ? 1 : 0);

for (const f of failures) {
    const allowed = Math.floor(f.ceiling * f.code);
    process.stderr.write(
        `\ncheck-comment-budget: ${f.area} is at ${f.have.toFixed(3)} comment lines per code line, ` +
            `over its committed ceiling of ${f.ceiling.toFixed(3)} — ${f.comment} comment lines against ` +
            `${f.code} code lines, about ${f.comment - allowed} more than the ceiling allows.\n` +
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
