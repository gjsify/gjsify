// SPDX-License-Identifier: MIT
// Process lifetime, half 1: `System.exit` is TERMINAL.
//
// Under gjs `imports.system.exit(code)` IS the exit() syscall: it never returns
// and nothing a program installs can intercept it. On the reverse bridge it must
// therefore bind the RUNTIME's own process and never read `globalThis.process`,
// which a bridged GJS program routinely shadows with the `@gjsify/process`
// polyfill whose `exit()` delegates BACK into `imports.system.exit` through a
// GLib idle — an infinite, idle-driven recursion at 100 % CPU that let
// `@gjsify/node-globals` run its 221-test suite green and then hang forever.
// Rationale: packages/node-gi/AGENTS.md § axis 5.
//
// This program is that shape, minimized. The golden (gjs) has no sentinel after
// the exit call: a runtime whose System.exit returns, or recurses, fails.
import GLib from 'gi://GLib?version=2.0';

const System = imports.system;

print('start');

globalThis.process = {
    exit(code) {
        // The polyfill defers to a fresh main-loop iteration instead of calling
        // inline; that is what makes this the idle-driven recursion that shipped.
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            System.exit(code);
            return GLib.SOURCE_REMOVE;
        });
    },
};

print('exiting');
System.exit(0);
print('System.exit returned — it is not terminal');
