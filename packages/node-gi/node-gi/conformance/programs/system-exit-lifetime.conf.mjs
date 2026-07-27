// SPDX-License-Identifier: MIT
// Process lifetime, half 1: `System.exit` is TERMINAL.
//
// Under gjs `imports.system.exit(code)` IS the exit() syscall — it never
// returns, and nothing a program installs can intercept it. On the reverse
// bridge the equivalent is the RUNTIME's own process exit, and reaching that
// through `globalThis.process` is NOT the same thing: a GJS program run through
// the bridge routinely shadows that global (`@gjsify/node-globals/register`
// installs the `@gjsify/process` polyfill unconditionally), and the polyfill's
// `exit()` delegates BACK into `imports.system.exit` — through a GLib idle —
// whenever it sees one. Reading the global therefore closes the loop into an
// infinite, idle-driven recursion that spins at 100 % CPU and never terminates:
// `@gjsify/node-globals` ran its whole 221-test suite green under node-gi and
// then hung forever.
//
// This program is that exact shape, minimized: shadow `process` with a shim
// that defers to System.exit, then call System.exit and print a sentinel after
// it. The golden (gjs) has no sentinel — a runtime whose System.exit returns,
// or recurses, fails.
import GLib from 'gi://GLib?version=2.0';

const System = imports.system;

print('start');

globalThis.process = {
    exit(code) {
        // The polyfill schedules the real exit from a fresh main-loop iteration
        // rather than calling it inline; keeping that here is what turns a plain
        // recursion into the idle-driven one that actually shipped.
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            System.exit(code);
            return GLib.SOURCE_REMOVE;
        });
    },
};

print('exiting');
System.exit(0);
print('System.exit returned — it is not terminal');
