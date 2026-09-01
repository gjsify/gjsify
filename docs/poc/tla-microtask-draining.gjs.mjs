#!/usr/bin/env -S gjs -m
// SPDX-License-Identifier: MIT OR LGPL-2.0-or-later
//
// Reproduction harness for the "top-level await + GLib main loop" interaction
// on GJS. Companion to docs/poc/tla-microtask-draining.md — read that for the
// full root-cause analysis.
//
// Runs purely on raw `gjs -m` (only `gi://GLib` + `gi://Gio`, no @gjsify
// bundle) so it is reproducible in any GJS checkout independent of the gjsify
// bundler. Each scenario is a self-contained subprocess so a deadlock in one
// cannot mask the others.
//
//   gjs -m docs/poc/tla-microtask-draining.gjs.mjs            # run all scenarios
//   gjs -m docs/poc/tla-microtask-draining.gjs.mjs <name>     # run one scenario as a child
//
// Exit code 0 = every scenario behaved as documented on this GJS; non-zero =
// a scenario regressed (the expectation no longer holds on this runtime).

import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';

const system = imports.system;

// ---------------------------------------------------------------------------
// Scenarios. Each is a function executed in a *child* `gjs` process. It must
// exit the process itself with the documented code. The parent compares the
// observed child exit code against `expectExit`.
//
// Key:
//   PASS  child exited with `expectExit` within the timeout
//   FAIL  wrong exit code OR timed out (timeout is treated as the "stall" code)
// ---------------------------------------------------------------------------

const STALL = 124; // parent maps a timed-out child to this code

const scenarios = {
    // 1. BASELINE — microtasks scheduled from a GLib source drain while a
    //    top-level await is pending. Expectation: drains, clean exit 0.
    //    Proves the modern GJS PromiseJobDispatcher GSource (priority -1000 on
    //    the thread-default context) runs jobs during eval_module's spin().
    'tla-microtask-drains': async () => {
        let drained = false;
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 30, () => {
            Promise.resolve().then(() => {
                drained = true;
                print('[drains] microtask ran inside source callback');
                // Use the gjsify-safe teardown (idle-scheduled), see scenario 4.
                GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    system.exit(drained ? 0 : 1);
                    return GLib.SOURCE_REMOVE;
                });
            });
            return GLib.SOURCE_REMOVE;
        });
        print('[drains] entering top-level await (pending forever)');
        await new Promise(() => {});
    },

    // 2. BASELINE — a chained Promise continuation (async/await desugaring)
    //    started from a real Gio async I/O callback drains under TLA.
    //    Expectation: drains, clean exit 0.
    'tla-gio-async-chain': async () => {
        const file = Gio.File.new_for_path('/etc/hostname');
        file.load_contents_async(null, (src, res) => {
            try {
                src.load_contents_finish(res);
            } catch {
                /* content irrelevant — we only care the continuation runs */
            }
            print('[gio] async callback fired');
            Promise.resolve()
                .then(() => print('[gio] microtask depth 1'))
                .then(() => print('[gio] microtask depth 2'))
                .then(() => {
                    print('[gio] continuation chain drained under TLA');
                    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                        system.exit(0);
                        return GLib.SOURCE_REMOVE;
                    });
                });
        });
        print('[gio] entering top-level await');
        await new Promise(() => {});
    },

    // 3. THE BUG — top-level await + a registered main-loop hook (what gjsify's
    //    ensureMainLoop() does via GLib.MainLoop.runAsync()/setMainLoopHook) +
    //    process termination via a BARE `system.exit()` from a microtask.
    //    Expectation: DEADLOCK (parent times out → STALL).
    //
    //    Why: under a main-loop hook, GJS's eval_module runs the hook's blocking
    //    `loop.run()`. `system.exit()` only sets GJS's internal m_should_exit +
    //    throws the uncatchable exit exception; it does NOT call loop.quit().
    //    The nested loop.run() never returns, so eval_module never reaches the
    //    real `::exit()`. The process hangs.
    'tla-hook-bare-exit-deadlocks': async () => {
        const loop = new GLib.MainLoop(null, false);
        if (GLib.main_depth() === 0) {
            try {
                loop.runAsync(); // registers the main-loop hook (gjsify style)
            } catch {
                /* a hook is already set */
            }
        }
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 30, () => {
            Promise.resolve().then(() => {
                print('[deadlock] microtask calling BARE system.exit(0)');
                system.exit(0); // does NOT quit loop.run() → hang
            });
            return GLib.SOURCE_REMOVE;
        });
        print('[deadlock] entering top-level await (hook registered)');
        await new Promise(() => {});
    },

    // 4. THE MITIGATION — same as #3, but terminate via the gjsify-owned path:
    //    idle_add(loop.quit() + system.exit()). loop.quit() unblocks the nested
    //    hook loop.run() so eval_module regains control and exits cleanly.
    //    This is exactly what @gjsify/process's exitProcess() (process.exit)
    //    does. Expectation: clean exit 0.
    'tla-hook-idle-exit-ok': async () => {
        const loop = new GLib.MainLoop(null, false);
        if (GLib.main_depth() === 0) {
            try {
                loop.runAsync();
            } catch {
                /* a hook is already set */
            }
        }
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 30, () => {
            Promise.resolve().then(() => {
                print('[mitigation] microtask scheduling idle exit (quit + exit)');
                GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    loop.quit(); // unblocks the nested hook loop.run()
                    system.exit(0);
                    return GLib.SOURCE_REMOVE;
                });
            });
            return GLib.SOURCE_REMOVE;
        });
        print('[mitigation] entering top-level await (hook registered)');
        await new Promise(() => {});
    },
};

const expectations = {
    'tla-microtask-drains': { expectExit: 0, note: 'microtasks drain under TLA' },
    'tla-gio-async-chain': { expectExit: 0, note: 'Gio async + Promise chain drains under TLA' },
    'tla-hook-bare-exit-deadlocks': {
        expectExit: STALL,
        note: 'bare system.exit() under TLA+hook deadlocks (documented upstream gap)',
    },
    'tla-hook-idle-exit-ok': { expectExit: 0, note: 'gjsify idle-scheduled exit escapes the deadlock' },
};

// ---------------------------------------------------------------------------
// Child mode: run exactly one scenario, then it exits the process itself.
// ---------------------------------------------------------------------------
const argv = system.programArgs ?? [];
const childName = argv[0];

if (childName) {
    const fn = scenarios[childName];
    if (!fn) {
        printerr(`unknown scenario: ${childName}`);
        system.exit(2);
    }
    // The scenario's top-level await keeps the module evaluation pending; the
    // scenario exits the process from inside its own callbacks.
    await fn();
    // Unreachable for the await-forever scenarios; a guard in case a scenario
    // ever returns without exiting.
    system.exit(0);
}

// ---------------------------------------------------------------------------
// Parent mode: spawn each scenario as a child `gjs` process with a timeout and
// compare the exit code to the expectation.
// ---------------------------------------------------------------------------
const SELF = import.meta.url.replace(/^file:\/\//, '');
const TIMEOUT_MS = 4000;

/** Run one scenario child, return its observed exit code (STALL on timeout). */
function runChild(name) {
    // `timeout <secs> gjs -m <self> <name>` — `timeout` exits 124 on expiry,
    // which we treat as the stall sentinel. We go through `timeout` rather than
    // a GLib-side watchdog so a genuinely hung child cannot wedge the parent.
    const launcher = Gio.SubprocessLauncher.new(Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_MERGE);
    const secs = String(Math.ceil(TIMEOUT_MS / 1000));
    const proc = launcher.spawnv(['timeout', secs, 'gjs', '-m', SELF, name]);
    const [, stdout] = proc.communicate_utf8(null, null);
    proc.wait(null);
    const status = proc.get_exit_status();
    return { status, stdout: (stdout ?? '').trimEnd() };
}

let failures = 0;
print(`# TLA / main-loop reproduction on ${GLib.get_real_name ? 'gjs' : 'gjs'} ${imports.system.version ?? ''}`);
for (const [name, { expectExit, note }] of Object.entries(expectations)) {
    const { status, stdout } = runChild(name);
    const ok = status === expectExit;
    if (!ok) failures++;
    print(`\n## ${name} — ${ok ? 'PASS' : 'FAIL'} (got ${status}, expected ${expectExit})`);
    print(`#  ${note}`);
    for (const line of stdout.split('\n')) if (line) print(`   ${line}`);
}

print(`\n# ${failures === 0 ? 'ALL SCENARIOS BEHAVED AS DOCUMENTED' : `${failures} SCENARIO(S) REGRESSED`}`);
system.exit(failures === 0 ? 0 : 1);
