// E2E regression test: under GJS, `process.exit()` must not come back.
//
// THE DEFECT THIS PINS
//
// `exitProcess` used to schedule `imports.system.exit()` on a `GLib.idle_add`
// source and then RETURN a forever-pending Promise cast to `never`. A Promise is
// not a `never`, so the caller's synchronous control flow continued: everything
// after `process.exit(3)` ran, and the process died with the right code some
// statements later. `scripts/bootstrap-native-facades.mjs` still carries a
// boolean return threaded through its call chain because of it, and its comment
// records the damage — "a failed facade build still printed done in 3.09s …
// Right exit code, every following line a lie".
//
// WHY THE OBVIOUS FIX IS WRONG, AND WHY THAT IS TESTED HERE TOO
//
// Calling `system.exit()` directly is what Node does and what the old header
// warned against. The warning is correct and the last case below MEASURES it: on
// gjs 1.88, with a main-loop hook armed, a direct `system.exit()` from a
// microtask never fires and the process hangs — SIGKILLed at the timeout. That
// case asserts the HANG. It is the discriminator: without it, every assertion
// here would also pass against the naive implementation, and the suite would be
// proving nothing about the design it is here to protect.
//
// `GLib.main_depth()` is not a way out either. Measured, it reads 0 for a plain
// script where a direct exit works, 0 for the hanging shape, and 1 inside a
// dispatched callback where a direct exit works again — the safe and unsafe
// cases are indistinguishable through it.
//
// WHAT THE CURRENT IMPLEMENTATION DOES
//
// Schedules the same idle source, then DRIVES the default main context itself,
// so the exit fires from inside a dispatch — the one position measured to
// terminate in every arrangement — and the function never returns to its caller.
//
// NOT COVERED HERE: a real `Adw.Application`. Exiting from a GTK timeout under
// one was measured by hand (exit code preserved, nothing after it ran), but it
// needs a display and this suite runs in the headless batch. The mechanism it
// exercises is the "hook armed" case below.
//
// Parallel-safe: per-run `mkdtemp`, no ports, no global state.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXIT_MODULE = fileURLToPath(new URL('../../../packages/node/process/lib/esm/internal/exit.js', import.meta.url));

const gjsPresent = (() => {
    try {
        return spawnSync('gjs', ['--version'], { stdio: 'ignore' }).status === 0;
    } catch {
        return false;
    }
})();

// The built module, not the source: this asserts what ships. A missing build is
// a SKIP with its own reason rather than a failure — the batch runs after
// `gjsify run build`, and a suite that fails when its subject was never built
// reports the wrong thing.
const SKIP = !gjsPresent
    ? 'no gjs on PATH'
    : !existsSync(EXIT_MODULE)
      ? '@gjsify/process is not built (run `gjsify workspace @gjsify/process run build`)'
      : false;

const TIMEOUT_MS = 15_000;
const dirs = [];

after(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/**
 * Run one GJS script and report how it ended.
 *
 * `timedOut` is a first-class answer, not an error: one case below EXPECTS the
 * hang, and a harness that threw on it could not express that.
 */
function runGjs(source, { timeoutMs = TIMEOUT_MS } = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'process-exit-'));
    dirs.push(dir);
    const file = join(dir, 'probe.js');
    writeFileSync(file, source);
    const result = spawnSync('gjs', ['-m', file], { encoding: 'utf8', timeout: timeoutMs });
    return {
        status: result.status,
        stdout: result.stdout ?? '',
        timedOut: result.signal === 'SIGTERM' || result.error?.code === 'ETIMEDOUT',
    };
}

/** Every probe imports the SHIPPED module by file URL — no bundler in the loop. */
const IMPORT_EXIT = `import { exitProcess } from 'file://${EXIT_MODULE}';`;

describe('process.exit() under GJS terminates and does not return', { skip: SKIP, timeout: 90_000 }, () => {
    it('exits a plain script without running the next statement', () => {
        const run = runGjs(`${IMPORT_EXIT}
print('BEFORE');
exitProcess(3);
print('AFTER');
`);
        assert.equal(run.timedOut, false, 'exiting a loop-free script must not hang');
        assert.equal(run.status, 3);
        assert.match(run.stdout, /BEFORE/);
        assert.doesNotMatch(run.stdout, /AFTER/, 'the statement after process.exit() must not run');
    });

    it('exits from a microtask with a main-loop hook armed', () => {
        // The shape every CLI reaches after `await parseAsync()`, and the one a
        // direct `system.exit()` hangs on — see the last case.
        const run = runGjs(`import GLib from 'gi://GLib?version=2.0';
${IMPORT_EXIT}
const loop = new GLib.MainLoop(null, false);
loop.runAsync().catch(() => {});
await Promise.resolve();
print('BEFORE depth=' + GLib.main_depth());
exitProcess(3);
print('AFTER');
`);
        assert.equal(run.timedOut, false, 'exiting with a hook armed must not hang');
        assert.equal(run.status, 3);
        assert.match(run.stdout, /BEFORE depth=0/, 'main_depth is 0 here — the reason it cannot be the discriminator');
        assert.doesNotMatch(run.stdout, /AFTER/);
    });

    it('exits from inside a callback someone else dispatched', () => {
        const run = runGjs(`import GLib from 'gi://GLib?version=2.0';
${IMPORT_EXIT}
const loop = new GLib.MainLoop(null, false);
GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
    print('BEFORE depth=' + GLib.main_depth());
    exitProcess(4);
    print('AFTER');
    return GLib.SOURCE_REMOVE;
});
loop.runAsync().catch(() => {});
`);
        assert.equal(run.timedOut, false);
        assert.equal(run.status, 4);
        assert.match(run.stdout, /BEFORE depth=1/);
        assert.doesNotMatch(run.stdout, /AFTER/);
    });

    it('preserves exit code 0 and the output written before it', () => {
        // Zero is the code a wrapper is most likely to invent when the real one
        // is lost, so it has to be asserted as a value rather than assumed.
        const run = runGjs(`${IMPORT_EXIT}
for (let i = 0; i < 200; i++) print('line-' + i);
exitProcess(0);
print('AFTER');
`);
        assert.equal(run.timedOut, false);
        assert.equal(run.status, 0);
        assert.equal(run.stdout.split('\n').filter((l) => l.startsWith('line-')).length, 200);
        assert.doesNotMatch(run.stdout, /AFTER/);
    });

    it('still hangs on a DIRECT system.exit(), which is why the implementation does not use one', () => {
        // The discriminator. Every assertion above would also hold for an
        // implementation that just called `system.exit()`; this is the case that
        // separates them, and it must keep FAILING to terminate. If it ever
        // starts exiting cleanly, gjs has changed and `exitProcess` can be
        // simplified — delete this case then, and only then.
        // A short timeout on purpose: this case is PAID FOR on every run, and
        // the working cases above finish in about a tenth of a second, so five
        // seconds separates "hung" from "slow runner" with room to spare.
        const run = runGjs(
            `import GLib from 'gi://GLib?version=2.0';
import system from 'system';
const loop = new GLib.MainLoop(null, false);
loop.runAsync().catch(() => {});
await Promise.resolve();
print('BEFORE');
system.exit(3);
print('AFTER');
`,
            { timeoutMs: 5_000 },
        );
        assert.equal(run.timedOut, true, 'a direct system.exit() with a hook armed is expected to hang on gjs 1.88');
        assert.match(run.stdout, /BEFORE/);
    });
});
