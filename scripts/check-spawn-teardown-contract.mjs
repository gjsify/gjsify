#!/usr/bin/env node
// CLI source must not reach for an async `spawn` behind the GJS teardown contract.
//
// THE INVARIANT
//
// `packages/infra/cli/src/utils/spawn.ts` owns the contract and states it in a table:
// under GJS an async `spawn` arms a GLib main loop (`ensureMainLoop`) that nothing but
// `process.exit()` quits, so a command that spawns a child and then RETURNS parks at 0%
// CPU after the child has already exited and been reaped.
// `SpawnToCompletionOptions.completion` is a REQUIRED field for that reason — a new call
// site has to say which row it is on rather than inherit the arming default.
//
// THE INCIDENT (#1010, #1012)
//
// That requirement binds only code that USES the helper. `utils/run-lifecycle-script.ts`
// wrote `import { spawn } from 'node:child_process'` instead, for years, while its own
// header asserted the opposite ("no GLib-mainloop intermingling"). The cost was `gjsify
// pack` parking for 5m30s after finishing its work on any package with a `prepack` —
// including the production `gjsify run publish:app` chain. The fix was one call site; the
// class was open until this check.
//
// WHAT IT CHECKS — four directions, so neither half can rot
//
//   1. a value import of async `spawn` from `node:child_process` under the scanned root,
//      not in the ledger                                                        → FAIL
//   2. a ledger entry whose file no longer imports it (self-retiring)           → FAIL
//   3. a ledger entry whose stated precondition is gone — it stopped being a spec, or
//      its package grew a GJS test leg (self-retiring)                          → FAIL
//   4. an access to `node:child_process` this check cannot read                 → FAIL
//
// Direction 4 matters as much as the first: a check that silently skips what it cannot
// parse reports "clean" on the one shape nobody reviewed.
//
// DELIBERATELY NARROW
//
// Async `spawn` only. `spawnSync` blocks and arms nothing. `exec`/`execFile` also call
// `ensureMainLoop()` in `@gjsify/child_process`, so on paper they arm it too — but only
// the async `spawn` path is MEASURED to hang, and `gjsify gsettings` (an `execFile`
// command) compiles a schema and exits in 0.45 s. A rule written on an axis nobody has
// measured is worse than none, so those stay out until that is explained.
//
// Usage: node scripts/check-spawn-teardown-contract.mjs [--root <dir>]

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const rootFlag = args.indexOf('--root');
const ROOT = rootFlag === -1 ? fileURLToPath(new URL('..', import.meta.url)) : args[rootFlag + 1];

const SCAN_ROOT = join(ROOT, 'packages', 'infra', 'cli', 'src');
const SKIP_DIRS = new Set(['node_modules', 'lib', 'dist', '.git', 'build', 'out', 'coverage']);

/**
 * The module that IMPLEMENTS the contract, and therefore the one place that must spawn by
 * hand. Exempt in the SCRIPT and not in the ledger: the ledger records "the GJS side cannot
 * apply here", a different claim from "this file is the rule". Without it the check flags
 * its own fix — the same reasoning as `OWNS_THE_ANSWER` in `check-posix-path-slice.mjs`.
 */
const OWNS_THE_CONTRACT = 'packages/infra/cli/src/utils/spawn.ts';

/** A single-line `import … from 'node:child_process'`, with the clause captured. */
const IMPORT = /^\s*import\s+(type\s+)?([^;]*?)\s+from\s+['"]node:child_process['"]\s*;?\s*$/;

const ledgerPath = join(ROOT, 'scripts', 'spawn-teardown-exceptions.mjs');
const { SPAWN_TEARDOWN_EXCEPTIONS } = await import(pathToFileURL(ledgerPath).href);

function* walk(dir) {
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name)) continue;
            yield* walk(full);
        } else if (/\.(?:m?ts|m?js)$/.test(entry.name)) {
            yield full;
        }
    }
}

/** The nearest `package.json` at or above `file`, without leaving `ROOT`. */
function nearestPackageJson(file) {
    let dir = dirname(file);
    for (;;) {
        const candidate = join(dir, 'package.json');
        if (existsSync(candidate)) return candidate;
        const up = dirname(dir);
        if (up === dir || !dir.startsWith(ROOT)) return null;
        dir = up;
    }
}

const findings = [];
const unreadable = [];
/** Ledger keys seen importing async `spawn`, so a stale entry can be told from a live one. */
const ledgerHits = new Set();

for (const file of walk(SCAN_ROOT)) {
    const key = relative(ROOT, file).split(sep).join('/');
    if (key === OWNS_THE_CONTRACT) continue;
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
        // Stripping BLOCK comments first is what a naive version does, and it misses
        // imports: a `@gjsify/*` inside a `//` line comment opens a bogus `/*` and the
        // stripper then eats everything to the next `*/`. Measured — that hid two of the
        // real hits. Per LINE, and skipping lines that ARE comment body, cannot do that.
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
        const code = line.replace(/\/\/.*$/, '');
        if (!code.includes('node:child_process')) return;

        const match = IMPORT.exec(code);
        if (!match) {
            unreadable.push({ key, line: i + 1, text: trimmed });
            return;
        }
        // `import type { … }` binds no value, so it cannot spawn anything.
        if (match[1]) return;
        // Strip inline `type X` specifiers, then look for the binding itself. `\b` already
        // excludes `spawnSync`: `spawn` and `Sync` are both word characters.
        const clause = match[2].replace(/\btype\s+[A-Za-z_$][\w$]*/g, '');
        if (!/\bspawn\b/.test(clause)) return;

        if (key in SPAWN_TEARDOWN_EXCEPTIONS) {
            ledgerHits.add(key);
            return;
        }
        findings.push({ key, line: i + 1, text: trimmed });
    });
}

// The self-retiring halves. An entry whose file no longer imports async `spawn` has
// outlived its cause; an entry whose stated precondition is gone was reviewed against a
// tree that no longer exists. A ledger nobody prunes is how the next one of these hides.
const stale = [];
for (const key of Object.keys(SPAWN_TEARDOWN_EXCEPTIONS)) {
    const abs = join(ROOT, ...key.split('/'));
    if (key === OWNS_THE_CONTRACT) {
        stale.push(`${key} owns the contract — it is exempt in the script, never in the ledger.`);
        continue;
    }
    if (!existsSync(abs)) {
        stale.push(`${key} does not exist — delete the entry.`);
        continue;
    }
    if (!ledgerHits.has(key)) {
        stale.push(`${key} no longer imports async \`spawn\` from node:child_process — delete the entry.`);
        continue;
    }
    const reason = SPAWN_TEARDOWN_EXCEPTIONS[key];
    if (typeof reason !== 'string' || reason.trim().length < 60) {
        stale.push(`${key} carries no reason worth reviewing — say why the GJS rows cannot apply.`);
        continue;
    }
    // The precondition behind every entry the ledger holds today: a spec whose package has
    // no GJS test leg, so the GJS rows of the table are unreachable for it.
    if (!/\.spec\.m?[tj]s$/.test(key)) {
        stale.push(
            `${key} is not a spec file, so the ledger's stated precondition does not cover it — ` +
                'widen this check deliberately rather than adding the entry.',
        );
        continue;
    }
    const pkg = nearestPackageJson(abs);
    if (!pkg) {
        stale.push(`${key} has no owning package.json, so its "no GJS test leg" claim cannot be checked.`);
        continue;
    }
    let scripts = {};
    try {
        scripts = JSON.parse(readFileSync(pkg, 'utf8')).scripts ?? {};
    } catch {
        stale.push(`${key}: ${relative(ROOT, pkg)} is unreadable, so its test legs cannot be checked.`);
        continue;
    }
    if (scripts['test:gjs'] || scripts['build:test:gjs']) {
        stale.push(
            `${key}: ${relative(ROOT, pkg)} now declares a GJS test leg, so this spec DOES run ` +
                'under GJS — re-judge the site against the teardown table.',
        );
    }
}

try {
    if (!statSync(SCAN_ROOT).isDirectory()) throw new Error('not a directory');
} catch {
    console.error(`[check-spawn-teardown-contract] cannot read ${SCAN_ROOT} — nothing was checked.`);
    process.exit(1);
}

if (findings.length === 0 && stale.length === 0 && unreadable.length === 0) {
    const count = ledgerHits.size;
    console.log(
        `[check-spawn-teardown-contract] ok — no CLI source bypasses the GJS teardown contract ` +
            `(${count} declared ${count === 1 ? 'exception' : 'exceptions'}, all still live).`,
    );
    for (const key of [...ledgerHits].sort()) {
        console.log(`  declared: ${key} — ${SPAWN_TEARDOWN_EXCEPTIONS[key]}`);
    }
    process.exit(0);
}

if (findings.length > 0) {
    console.error(
        `[check-spawn-teardown-contract] ${findings.length} ` +
            `${findings.length === 1 ? 'site imports' : 'sites import'} async \`spawn\` directly:\n`,
    );
    for (const f of findings) {
        console.error(`  ${f.key}:${f.line}`);
        console.error(`    ${f.text}`);
        console.error(
            '    → use `spawnToCompletion` from `utils/spawn.js` and declare `completion` — the ' +
                "table is in that file's header. A command that SUPERVISES a long-lived child " +
                "declares `completion: 'daemon'` and takes the handle through `onSpawn`. If the " +
                'GJS rows genuinely cannot apply, add an entry to ' +
                'scripts/spawn-teardown-exceptions.mjs saying why.\n',
        );
    }
}

if (unreadable.length > 0) {
    console.error(
        `[check-spawn-teardown-contract] ${unreadable.length} ` +
            `${unreadable.length === 1 ? 'access' : 'accesses'} to node:child_process this check cannot read:\n`,
    );
    for (const u of unreadable) {
        console.error(`  ${u.key}:${u.line}`);
        console.error(`    ${u.text}`);
        console.error(
            '    → keep the import on ONE line, or route it through utils/spawn.js. This check ' +
                'refuses to skip what it cannot parse: a silent miss is how the rule stops holding.\n',
        );
    }
}

if (stale.length > 0) {
    console.error(
        `[check-spawn-teardown-contract] ${stale.length} stale ledger ` +
            `${stale.length === 1 ? 'entry' : 'entries'}:\n`,
    );
    for (const s of stale) console.error(`  ${s}\n`);
}

console.error('See the header of this script for the incident behind the rule.');
process.exit(1);
