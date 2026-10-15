#!/usr/bin/env node
// THE DUAL RUN of ADR 0110 § 3 — the same suite, on the device, once per engine.
//
// Step 3 of that ADR asks for the app-level and storybook tests to run on the Android emulator
// under BOTH the real-Gio engine and the pure-JS subset, beside the conformance vectors that
// already run both subjects. That is what this is: two full legs of `run-on-device.mjs`, each
// with `--engine` named explicitly, built from one set of sources with one define different.
//
// BOTH LEGS ALWAYS RUN, even after the first one fails. The dual run exists to COMPARE two
// engines; stopping at the first failure would answer "real-gio broke" and leave "and does
// pure-js still work?" — the question that says whether the defect is in the engine or in the
// door above it — unasked until someone runs the second leg by hand.
//
// WHAT IT DOES NOT DO: build the payload (`build-gi-runtime-android.mjs`), start an emulator, or
// run the two showcase APKs per engine. See README.md § "Not wired into CI".
//
// Usage: node scripts/run-dual.mjs [--keep] [--engine <name> …]   (extra args go to both legs)
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const runner = join(root, 'scripts', 'run-on-device.mjs');
const ENGINES = ['real-gio', 'pure-js'];

// `--engine` on THIS script selects which legs to run (both by default) — handy for re-running a
// single one after a fix without losing the `[ns-gi:dual]` framing. Everything else is handed to
// both legs untouched, so `--keep` and friends keep working through this door.
const picked = [];
const extra = [];
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--engine') picked.push(argv[++i]);
    else if (argv[i].startsWith('--engine=')) picked.push(argv[i].slice('--engine='.length));
    else if (argv[i] !== 'android') extra.push(argv[i]);
}
const unknown = picked.find((name) => !ENGINES.includes(name));
if (unknown !== undefined) {
    console.error(`[ns-gi:dual] unknown engine '${String(unknown)}' — one of: ${ENGINES.join(', ')}`);
    process.exit(1);
}
const legs = picked.length > 0 ? picked : ENGINES;

const say = (text) => console.log(`[ns-gi:dual] ${text}`);

// The child must not inherit a `GJSIFY_GI_OPT_IN` that contradicts the `--engine` we pass it:
// the runner would refuse the leg, which is correct of it and useless here.
const { GJSIFY_GI_OPT_IN: _dropped, ...childEnv } = process.env;

const results = [];
for (const engine of legs) {
    say(`leg ${results.length + 1}/${legs.length}: --engine ${engine}`);
    const status = spawnSync('node', [runner, 'android', '--engine', engine, ...extra], {
        stdio: 'inherit',
        cwd: root,
        env: childEnv,
    }).status;
    results.push({ engine, ok: status === 0 });
}

for (const { engine, ok } of results) say(`${ok ? '✔' : '✘'} ${engine}`);
const failed = results.filter((r) => !r.ok);
if (failed.length > 0) {
    say(`${failed.length}/${results.length} leg(s) FAILED: ${failed.map((r) => r.engine).join(', ')}`);
    process.exit(1);
}
say(`✔ the suite passed on both engines (${results.map((r) => r.engine).join(', ')}).`);
