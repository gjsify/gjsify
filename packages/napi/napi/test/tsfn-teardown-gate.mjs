// SPDX-License-Identifier: MIT
// @gjsify/napi — TSFN ENV-TEARDOWN GATE (per-claim owner attribution).
//
//   cd packages/napi/napi && node test/tsfn-teardown-gate.mjs [--runs=N] [--verbose]
//
// The regression guard for `finalize_env_tsfns`. It runs test/tsfn-teardown-case.js
// once per claim-owner shape and MEASURES the teardown alone: the case prints
// `READY <shape> <CLOCK_MONOTONIC us>` as its last statement, and this driver
// reads its own CLOCK_MONOTONIC (process.hrtime.bigint, same clock, same kernel)
// the instant the child exits — so gjs startup and addon load are excluded and
// what is left is env teardown.
//
// What it pins down, and why each row is load-bearing:
//
//   shape       claims at teardown              teardown must be   diagnostic
//   ---------   -----------------------------   ----------------   ------------
//   clean       none                            fast               silent
//   self        1, unattributed (JS thread)     fast               warns
//   self-used   1, attributed to the JS thread  fast               warns
//   foreign     1, attributed foreign, parked   ~the 2 s deadline  warns
//   draining    8, attributed foreign, live     fast               silent
//
// `self` / `self-used` are the regression: a claim the JS thread will never hand
// back cannot drain from inside a join the JS thread is blocked in, so before
// per-claim owner attribution both burned the FULL 2 s deadline and then
// force-freed — the pre-#809 use-after-free window, reopened deterministically
// on a legal (if sloppy) N-API shape. Reverting the attribution turns both
// SLOW-rows red here.
//
// `foreign` is the other half of the contract: a claim a foreign thread really
// does hold must STILL be waited for and must STILL warn. A "fix" that just
// skipped the join would pass the fast rows and fail this one.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, '..');
const ADDON = join(PKG, 'test', 'tsfn-addon', 'build', 'Release', 'tsfn.node');
const CASE = join('test', 'tsfn-teardown-case.js');

let runs = 3;
let verbose = false;
for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--runs=')) runs = Math.max(1, Number(arg.slice('--runs='.length)) || 1);
    else if (arg === '--verbose') verbose = true;
    else {
        console.error(`usage: node test/tsfn-teardown-gate.mjs [--runs=N] [--verbose]`);
        process.exit(2);
    }
}

if (!existsSync(ADDON)) {
    console.error(
        `tsfn-teardown-gate: missing ${ADDON}\n  build it: cd test/tsfn-addon && npm exec -- node-gyp rebuild`,
    );
    process.exit(2);
}
if (!existsSync(join(PKG, 'build', 'GjsifyNapi-1.0.typelib'))) {
    console.error(`tsfn-teardown-gate: missing build/GjsifyNapi-1.0.typelib\n  build it: gjsify run build:meson`);
    process.exit(2);
}

// The deadline finalize_env_tsfns joins foreign claims against.
const DEADLINE_MS = 2000;
// A teardown that does not wait finishes in well under a millisecond; the bound
// is loose enough for a loaded CI box and still three orders below the deadline.
const FAST_MS = 500;

const SHAPES = [
    { name: 'clean', speed: 'fast', warn: null },
    { name: 'self', speed: 'fast', warn: /nothing can hand back/ },
    { name: 'self-used', speed: 'fast', warn: /nothing can hand back/ },
    { name: 'foreign', speed: 'deadline', warn: /teardown join timed out/ },
    { name: 'draining', speed: 'fast', warn: null },
];

// dyld reads DYLD_LIBRARY_PATH and ignores the ELF one, so the shim would not
// be found on macOS with a hard-coded LD_LIBRARY_PATH.
const LIB_PATH_VAR = process.platform === 'darwin' ? 'DYLD_LIBRARY_PATH' : 'LD_LIBRARY_PATH';

// One run of one shape → { teardownMs, stderr }. `G_MESSAGES_DEBUG=all` so the
// g_debug disposition lines are visible under --verbose; the warnings this gate
// asserts on are unconditional either way.
function runShape(shape) {
    const child = spawnSync('gjs', [CASE, shape], {
        cwd: PKG,
        encoding: 'utf8',
        timeout: 60000,
        env: {
            ...process.env,
            GI_TYPELIB_PATH: join(PKG, 'build'),
            [LIB_PATH_VAR]: join(PKG, 'build'),
            G_MESSAGES_DEBUG: 'all',
        },
    });
    const exitedAtUs = Number(process.hrtime.bigint() / 1000n);
    if (child.status !== 0) {
        return { error: `exit ${child.status}\n${(child.stderr || '').trim()}` };
    }
    const ready = /^READY \S+ (\d+)$/m.exec(child.stdout ?? '');
    if (!ready) return { error: `no READY marker\n--- stdout ---\n${child.stdout}\n--- stderr ---\n${child.stderr}` };
    return {
        teardownMs: (exitedAtUs - Number(ready[1])) / 1000,
        stderr: child.stderr ?? '',
    };
}

// The shim's own lines out of a child's stderr — everything else is GJS noise.
const napiLines = (stderr) =>
    stderr
        .trim()
        .split('\n')
        .filter((l) => l.includes('gjsify-napi'));

let failures = 0;
const check = (name, cond, detail = '') => {
    if (cond) {
        console.log(`ok   ${name}`);
    } else {
        failures++;
        console.error(`FAIL ${name}${detail ? `\n     ${detail}` : ''}`);
    }
};

console.log(`tsfn-teardown-gate: ${runs} run(s) per shape, deadline ${DEADLINE_MS} ms, fast bound ${FAST_MS} ms\n`);

for (const shape of SHAPES) {
    const times = [];
    let stderrs = [];
    let broke = false;
    for (let i = 0; i < runs; i++) {
        const r = runShape(shape.name);
        if (r.error) {
            check(`${shape.name}: runs`, false, r.error);
            broke = true;
            break;
        }
        times.push(r.teardownMs);
        stderrs.push(r.stderr);
    }
    if (broke) continue;

    const fmt = times.map((t) => t.toFixed(1)).join(' / ');
    const worst = Math.max(...times);
    const best = Math.min(...times);
    console.log(`  ${shape.name}: teardown ${fmt} ms`);
    if (verbose) {
        for (const line of napiLines(stderrs[0])) console.log(`     | ${line}`);
    }

    if (shape.speed === 'fast') {
        check(`${shape.name}: teardown does not wait (worst ${worst.toFixed(1)} ms < ${FAST_MS} ms)`, worst < FAST_MS);
    } else {
        // Must actually spend the deadline — this is the half of the contract a
        // blanket "skip the join" would break.
        check(
            `${shape.name}: teardown still joins to the deadline (best ${best.toFixed(1)} ms >= ${DEADLINE_MS * 0.9} ms)`,
            best >= DEADLINE_MS * 0.9,
        );
        check(
            `${shape.name}: join does not overrun the deadline (worst ${worst.toFixed(1)} ms < ${DEADLINE_MS * 2} ms)`,
            worst < DEADLINE_MS * 2,
        );
    }

    const warned = stderrs.map((s) => /gjsify-napi:.*threadsafe-function/.test(s));
    if (shape.warn) {
        check(`${shape.name}: warns on every run`, warned.every(Boolean));
        check(
            `${shape.name}: the warning names the cause (${shape.warn})`,
            stderrs.every((s) => shape.warn.test(s)),
            napiLines(stderrs.find((s) => !shape.warn.test(s)) ?? '').join('\n'),
        );
    } else {
        check(
            `${shape.name}: no warning`,
            stderrs.every((s) => !/\bWARNING\b.*gjsify-napi/.test(s)),
            napiLines(stderrs.find((s) => /\bWARNING\b.*gjsify-napi/.test(s)) ?? '').join('\n'),
        );
    }
}

if (failures > 0) {
    console.error(`\nTSFN TEARDOWN GATE: FAIL (${failures})`);
    process.exit(1);
}
console.log('\nTSFN TEARDOWN GATE: PASS');
