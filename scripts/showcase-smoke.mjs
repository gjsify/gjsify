#!/usr/bin/env node
// Launch every showcase that DECLARES a runtime, on that runtime, and fail on the
// ones that do not come up.
//
// THE GAP (#999). `gjsify.example.runtimes` is a per-showcase PROMISE — "this
// showcase ships an artifact for this runtime and it runs there" — and nothing in
// CI ever launched one. `verify-package-outputs.mjs --scope examples` holds the
// declaration to a FILE existing; a bundle that exists and dies on its first
// `gi://` import satisfies that check completely — and that is not hypothetical:
// launched without the typelib env `gjsify run` builds, most of the gjs showcases
// die at import on "Typelib file for namespace 'Gwebgl' not found".
//
// THE MATRIX IS DERIVED, never listed. `packagesUnder(showcases/)` is the same
// substrate every conformance rule reads, and the runtime vocabulary is IMPORTED
// from the CLI (`utils/runtimes.js`) rather than re-spelled — a second spelling of
// the four runtimes is a second truth, and the one that drifts is the one CI reads.
//
// WHAT "IT CAME UP" MEANS HERE, stated plainly so nobody reads more into a green
// run than it holds: the process either exited 0 on its own (a self-completing
// showcase like webrtc-loopback), or was still alive after `--dwell` seconds, and
// in neither case printed a fatal marker. It does NOT assert that a window mapped
// — no X client tool is baked into the CI image, and per-showcase application-ids
// would be a hand-written list. What it does catch is every way the measured
// showcases actually break: a missing typelib, a throw at import, a throw inside a
// GLib callback, a rejected promise nobody caught.
//
// WHY NOT "stderr is non-empty → fail". Because it is flaky by construction, and
// the baseline says so. On a HEALTHY run under Xvfb the showcases print, on
// stderr: `[@gjsify/webgl] GL is rasterised on the CPU by "llvmpipe …"`,
// `[ALSOFT] (EE) Failed to connect PipeWire event context`, `[Warn] : Scene root
// already exists overwriting`, `Bubblewrap does not work inside of this container`.
// Three of those four contain "error"/"fail"/"warn" in some spelling, so a keyword
// grep is no better. The FATAL set below is the complement: markers GJS itself
// emits for a JS-level failure, measured absent from every healthy run.
//
// WHY THE EXIT CODE IS NOT ENOUGH. Measured on gjs 1.88: a `throw` from inside a
// GLib idle callback prints `Gjs-CRITICAL **: … JS ERROR: …` and the process
// CONTINUES and exits 0. So does an unhandled promise rejection. A GTK showcase is
// one long callback chain — the exit code sees almost none of it.
//
// XVFB MERGES THE STREAMS — do not wrap the individual showcases. Fedora's
// `xvfb-run` ends in `DISPLAY=:N XAUTHORITY=… "$@" 2>&1`, so a child launched
// THROUGH it has no separate stderr at all. Wrapping each showcase in its own
// `xvfb-run` made every `.err` come back 0 bytes and the gate green on a crash —
// the first version of this measurement did exactly that. The display therefore
// belongs OUTSIDE this script (one `xvfb-run` around the whole invocation, as the
// `examples` job does); the pipes below are this process's own, and are unmerged.
//
// Usage — `node scripts/showcase-smoke.mjs` with:
//   --runtime <gjs>   the column to launch (default gjs; see BOOTSTRAPPED_COLUMNS)
//   --dwell <seconds> how long a long-running showcase must survive (default 10)
//   --only <name>     narrow to one showcase, repeatable. CI never passes it — the
//                     point of the gate is that its set is derived, not curated.

import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

import { packagesUnder, readManifest } from '../packages/infra/manifest-conformance/lib/context.mjs';
import {
    EXAMPLE_RUNTIMES,
    RUNTIMES,
    isRuntimeAvailable,
    readDeclaredRuntimes,
} from '../packages/infra/cli/lib/utils/runtimes.js';
import { computeNativeEnvForBundle } from '../packages/infra/cli/lib/utils/run-gjs.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The columns of the #999 matrix this script actually launches. The other three
 * are DECLARED by the showcases and still unlaunched; they are printed as such on
 * every run rather than quietly resolving to a pass, because a smoke gate that
 * reports a column it never ran is the defect it exists to prevent.
 */
const BOOTSTRAPPED_COLUMNS = ['gjs'];

/**
 * Markers that mean the showcase's JavaScript failed, as GJS itself spells them.
 *
 * Every one was measured ABSENT from every healthy showcase run and PRESENT on a
 * deliberately broken one. They are scoped to the `Gjs` log domain and to GJS's
 * two JS-level markers on purpose: a `Gtk-CRITICAL` is a C-level assertion inside
 * a toolkit we do not own, and folding it in here would make the gate report GTK's
 * housekeeping as a showcase defect.
 *
 * `JS ERROR` and `Unhandled promise rejection` are the load-bearing two — both
 * leave the exit code at 0, so nothing else in CI can see them.
 */
const FATAL_PATTERNS = [/\bJS ERROR\b/, /\bUnhandled promise rejection\b/, /\bGjs-CRITICAL\b/];

const argv = process.argv.slice(2);

function flag(name, fallback) {
    const i = argv.indexOf(`--${name}`);
    return i === -1 ? fallback : argv[i + 1];
}

const runtime = flag('runtime', 'gjs');
const dwellSeconds = Number(flag('dwell', '10'));
const only = argv.flatMap((a, i) => (a === '--only' && argv[i + 1] ? [argv[i + 1]] : []));

if (!EXAMPLE_RUNTIMES.includes(runtime)) {
    console.error(`showcase-smoke: --runtime must be one of ${EXAMPLE_RUNTIMES.join(' | ')} (got "${runtime}")`);
    process.exit(2);
}
if (!BOOTSTRAPPED_COLUMNS.includes(runtime)) {
    console.error(
        `showcase-smoke: the "${runtime}" column of the showcase matrix is not wired yet (#999).\n` +
            `  Wired today: ${BOOTSTRAPPED_COLUMNS.join(', ')}.\n` +
            '  Refusing rather than reporting a column nobody launched.',
    );
    process.exit(2);
}
if (!Number.isFinite(dwellSeconds) || dwellSeconds <= 0) {
    console.error(`showcase-smoke: --dwell must be a positive number of seconds (got "${flag('dwell', '')}")`);
    process.exit(2);
}

// A missing interpreter is a HARD failure, never a skip: "gjs was not on PATH so
// nothing ran" is indistinguishable from "everything passed" in a job summary, and
// this gate exists because that difference went unnoticed for the whole matrix.
if (!isRuntimeAvailable(runtime)) {
    console.error(`showcase-smoke: ${RUNTIMES[runtime].probe} is not on PATH — the ${runtime} column cannot run here.`);
    process.exit(1);
}

/** The `--app gjs` bundle a showcase ships, i.e. what `gjsify showcase` launches. */
function entryFor(pkg) {
    const main = pkg.manifest.gjsify?.main;
    return typeof main === 'string' && main.length > 0 ? main : null;
}

/**
 * Run one showcase and decide whether it came up.
 *
 * The verdict reads the stderr captured UP TO the dwell deadline, not up to the
 * child's death: we are the one sending SIGTERM, and teardown noise provoked by
 * our own signal says nothing about the run.
 */
async function launch(pkg, entryRel) {
    const entryAbs = join(pkg.dir, entryRel);
    const [bin, args] = RUNTIMES[runtime].launch(entryAbs);
    const { env: nativeEnv } = computeNativeEnvForBundle(entryAbs, pkg.dir);

    const child = spawn(bin, args, {
        cwd: pkg.dir,
        env: { ...process.env, ...nativeEnv },
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf-8');
    child.stderr.setEncoding('utf-8');
    child.stdout.on('data', (chunk) => {
        stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
        stderr += chunk;
    });

    const exited = new Promise((resolveExit) => {
        child.on('close', (code, signal) => resolveExit({ code, signal }));
        child.on('error', (err) => resolveExit({ code: null, signal: null, spawnError: err }));
    });

    let timer;
    const deadline = new Promise((resolveDeadline) => {
        timer = setTimeout(() => resolveDeadline('dwell'), dwellSeconds * 1000);
    });

    const first = await Promise.race([exited, deadline]);
    clearTimeout(timer);

    let outcome;
    if (first === 'dwell') {
        // Alive at the deadline: the long-running case. Freeze the evidence, then
        // take the process down — SIGKILL after a grace period, because a GTK app
        // that ignores SIGTERM would otherwise hold the job open.
        outcome = { alive: true, stderrAtVerdict: stderr };
        child.kill('SIGTERM');
        const killer = setTimeout(() => child.kill('SIGKILL'), 5000);
        await exited;
        clearTimeout(killer);
    } else {
        outcome = { alive: false, stderrAtVerdict: stderr, ...first };
    }

    const fatal = FATAL_PATTERNS.filter((p) => p.test(outcome.stderrAtVerdict));

    if (outcome.spawnError)
        return { ok: false, why: `could not spawn ${bin}: ${outcome.spawnError.message}`, stdout, stderr };
    if (!outcome.alive && outcome.signal) {
        return { ok: false, why: `died on ${outcome.signal} after less than ${dwellSeconds}s`, stdout, stderr };
    }
    if (!outcome.alive && outcome.code !== 0) {
        return { ok: false, why: `exited ${outcome.code} after less than ${dwellSeconds}s`, stdout, stderr };
    }
    if (fatal.length > 0) {
        return { ok: false, why: `printed ${fatal.map((p) => p.source).join(' + ')} on stderr`, stdout, stderr };
    }
    return { ok: true, why: outcome.alive ? `still up after ${dwellSeconds}s` : 'exited 0', stdout, stderr };
}

const showcases = packagesUnder(join(ROOT, 'showcases'))
    .sort()
    .map((dir) => ({ dir, manifest: readManifest(dir) }))
    .filter((p) => typeof p.manifest?.name === 'string');

if (showcases.length === 0) {
    console.error('showcase-smoke: no package.json found under showcases/ — the matrix cannot be derived.');
    process.exit(1);
}

const skipped = [];
const selected = [];

for (const pkg of showcases) {
    const label = basename(pkg.dir);
    const declared = readDeclaredRuntimes(pkg.manifest);

    if (declared === null) {
        skipped.push([label, 'declares no gjsify.example.runtimes — nothing is promised, nothing is held']);
        continue;
    }
    const otherColumns = declared.filter((rt) => rt !== runtime);
    if (otherColumns.length > 0) {
        skipped.push([`${label} × ${otherColumns.join(',')}`, `not this invocation's column (--runtime ${runtime})`]);
    }
    if (!declared.includes(runtime)) continue;

    const entryRel = entryFor(pkg);
    if (entryRel === null) {
        // Not a skip: declaring a runtime with no `gjsify.main` to launch is the
        // declaration being unfulfillable, which is the failure this gate is for.
        selected.push({ pkg, label, entryRel: null });
        continue;
    }
    selected.push({ pkg, label, entryRel });
}

console.log(
    `showcase-smoke: ${showcases.length} showcase(s) under showcases/, ${selected.length} declare "${runtime}".`,
);
console.log(`  runtime ${runtime} → ${RUNTIMES[runtime].launch('<entry>').flat().join(' ')}, dwell ${dwellSeconds}s`);
for (const [what, why] of skipped) console.log(`  skipped ${what}: ${why}`);
for (const rt of EXAMPLE_RUNTIMES.filter((r) => !BOOTSTRAPPED_COLUMNS.includes(r))) {
    console.log(`  column ${rt}: declared by showcases, NOT launched by any job yet (#999)`);
}

const failures = [];
let launched = 0;

for (const { pkg, label, entryRel } of selected) {
    if (only.length > 0 && !only.includes(label)) {
        console.log(`  skipped ${label}: --only ${only.join(',')}`);
        continue;
    }
    launched += 1;
    if (entryRel === null) {
        failures.push([label, `declares "${runtime}" but its package.json has no gjsify.main to launch`]);
        console.log(`FAIL ${label}: no gjsify.main`);
        continue;
    }
    if (!existsSync(join(pkg.dir, entryRel))) {
        failures.push([
            label,
            `declares "${runtime}" but ${relative(ROOT, join(pkg.dir, entryRel))} does not exist — build it first`,
        ]);
        console.log(`FAIL ${label}: ${entryRel} missing`);
        continue;
    }

    const started = Date.now();
    const result = await launch(pkg, entryRel);
    const seconds = ((Date.now() - started) / 1000).toFixed(1);

    if (result.ok) {
        console.log(`ok   ${label} (${runtime}) — ${result.why} [${seconds}s]`);
        continue;
    }
    failures.push([label, result.why]);
    console.log(`FAIL ${label} (${runtime}) — ${result.why} [${seconds}s]`);
    // The whole captured output, not a head: what makes a showcase failure
    // diagnosable from a CI log is the stack, and it is the last thing printed.
    if (result.stdout.trim()) console.log(`     ── ${label} stdout ──\n${indent(result.stdout)}`);
    if (result.stderr.trim()) console.log(`     ── ${label} stderr ──\n${indent(result.stderr)}`);
}

function indent(text) {
    return text
        .trimEnd()
        .split('\n')
        .map((l) => `     ${l}`)
        .join('\n');
}

if (failures.length > 0) {
    console.error(`\nshowcase-smoke: ${failures.length} showcase(s) did not come up on ${runtime}:`);
    for (const [label, why] of failures) console.error(`  · ${label}: ${why}`);
    process.exit(1);
}

console.log(`\nshowcase-smoke: ${launched} showcase(s) launched on ${runtime}, all came up.`);
