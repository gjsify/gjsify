#!/usr/bin/env node
// Holds every agent context file at or below a committed byte ceiling.
//
// Why this is a gate and not a note in AGENTS.md: these files are loaded on EVERY
// agent turn, so their size is a permanent tax on every task in the repo, and nothing
// in the tree pushes back when one grows. The root file reached 277 KB before it was
// split, one defensible paragraph at a time — every paragraph arrived with a reason,
// which is exactly why prose alone could not stop it.
//
// Two limits, different kinds:
//   HARD  32 KiB — `project_doc_max_bytes`. Codex silently truncates the tail past
//         this with no warning, so the end of an oversized file is not "less
//         prominent", it is ABSENT. Never waivable.
//   SOFT  the measured ceiling in `status/agent-context-budget.json` — what each file
//         was when last reviewed. Two files are over the 20 KB target AGENTS.md sets
//         for itself, so a flat 20 KB gate would have failed on arrival and been
//         waived; a per-file ratchet fails only on REGROWTH, which is the thing worth
//         catching. `--update` after a cleanup lowers a ceiling; raising one is a
//         reviewed line in the same commit as the prose that needed it.
//
//   node scripts/check-agent-context-size.mjs            # print the table
//   node scripts/check-agent-context-size.mjs --check    # gate (CI)
//   node scripts/check-agent-context-size.mjs --update   # re-baseline
//
// A `CLAUDE.md` that is a real file rather than a symlink to `AGENTS.md` is also an
// error: both get loaded, so the tax doubles and the second copy drifts.

import { readFileSync, writeFileSync, existsSync, lstatSync } from 'node:fs';
import { execSync } from 'node:child_process';

const BUDGET_FILE = 'status/agent-context-budget.json';
const HARD_CAP = 32 * 1024;

const tracked = execSync('git ls-files', { maxBuffer: 1 << 28 })
    .toString()
    .trim()
    .split('\n');
const contextFiles = tracked.filter((f) => /(^|\/)AGENTS\.md$/.test(f)).sort();
const claudeFiles = tracked.filter((f) => /(^|\/)CLAUDE\.md$/.test(f));

const mode = process.argv.includes('--check') ? 'check' : process.argv.includes('--update') ? 'update' : 'print';

/** @type {{file: string, bytes: number}[]} */
const rows = contextFiles.map((file) => ({ file, bytes: Buffer.byteLength(readFileSync(file)) }));

if (mode === 'update') {
    /** @type {Record<string, number>} */
    const out = {};
    for (const r of rows) out[r.file] = r.bytes;
    writeFileSync(BUDGET_FILE, `${JSON.stringify(out, null, 4)}\n`);
    process.stdout.write(`check-agent-context-size: wrote ${BUDGET_FILE} (${rows.length} files)\n`);
    process.exit(0);
}

if (!existsSync(BUDGET_FILE)) {
    process.stderr.write(`check-agent-context-size: ${BUDGET_FILE} is missing. Run with --update to baseline it.\n`);
    process.exit(2);
}

/** @type {Record<string, number>} */
const budget = JSON.parse(readFileSync(BUDGET_FILE, 'utf8'));

const failures = [];
const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);
process.stdout.write(`${pad('agent context file', 52)}${lpad('bytes', 8)}${lpad('ceiling', 9)}\n`);
for (const r of rows) {
    const ceiling = budget[r.file];
    const overHard = r.bytes > HARD_CAP;
    const overSoft = ceiling !== undefined && r.bytes > ceiling;
    process.stdout.write(
        `${pad(r.file, 52)}${lpad(r.bytes, 8)}${lpad(ceiling === undefined ? '-' : ceiling, 9)}` +
            `${overHard ? '  OVER 32 KiB' : overSoft ? '  OVER' : ''}\n`,
    );
    if (overHard) failures.push({ ...r, ceiling, kind: 'hard' });
    else if (overSoft) failures.push({ ...r, ceiling, kind: 'soft' });
    else if (ceiling === undefined) failures.push({ ...r, ceiling, kind: 'unbudgeted' });
}

// A ceiling for a file that no longer exists is a claim nothing checks.
for (const file of Object.keys(budget)) {
    if (!rows.some((r) => r.file === file)) {
        process.stderr.write(
            `\ncheck-agent-context-size: ${BUDGET_FILE} budgets '${file}', which is not tracked. ` +
                'Remove the entry or fix the path.\n',
        );
        failures.push({ file, bytes: 0, kind: 'stale' });
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
    } else if (f.kind === 'soft') {
        process.stderr.write(
            `\ncheck-agent-context-size: ${f.file} grew to ${f.bytes} bytes, over its committed ceiling of ` +
                `${f.ceiling} (+${f.bytes - f.ceiling}). This file is loaded on every agent turn.\n` +
                '  Move the DETAIL into `docs/` and keep the rule plus one link — never delete the incident\n' +
                '  behind a rule, which is what makes the rule survive a future "simplification".\n' +
                `  If the growth is genuinely warranted, raise the ceiling in ${BUDGET_FILE} in the same\n` +
                '  commit, so the increase is reviewed rather than accumulated.\n',
        );
    } else if (f.kind === 'unbudgeted') {
        process.stderr.write(
            `\ncheck-agent-context-size: ${f.file} has no ceiling in ${BUDGET_FILE}. Run --update to baseline it.\n`,
        );
    }
}

if (failures.length === 0) {
    process.stdout.write('\ncheck-agent-context-size: every agent context file is within its committed ceiling.\n');
    process.exit(0);
}
process.exit(1);
