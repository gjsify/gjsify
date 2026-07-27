// SPDX-License-Identifier: MIT
// Process lifetime, half 2: the keep-alive contract of the GLib↔runtime pump.
//
// Three properties, byte-compared against gjs in one program:
//   1. work armed from INSIDE a dispatched GLib callback keeps the process alive
//      for its own completion — the chained-timeout shape a test suite produces
//      once `globalThis.setTimeout` has been swapped for `GLib.timeout_add`
//      (`@gjsify/node-globals/register` does exactly that);
//   2. a source armed and then REMOVED holds nothing open and never fires;
//   3. with nothing left scheduled the program exits on its own — the pump alone
//      must never keep a finished program alive.
//
// Under gjs all three hold trivially: the GLib loop IS the process loop. On the
// reverse bridge they are the pump's ref/unref accounting, and Bun/Deno had none
// of it — the portable main-context pump was opt-in and permanently unref'd, so
// the same bundle exited 0 MID-flight with the program half-run
// (`@gjsify/node-globals` stopped after 16 of 221 tests, at the first spec that
// awaited a swapped `setTimeout`).
import GLib from 'gi://GLib?version=2.0';

print('start');

// A one-shot GLib timeout resolving a promise — the only thing keeping the
// process alive across each step.
const step = (label, ms) =>
    new Promise((resolve) => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            print('tick', label);
            resolve(label);
            return GLib.SOURCE_REMOVE;
        });
    });

// 1. Chained: each timeout is armed from within the previous one's dispatch.
for (const label of ['a', 'b', 'c']) {
    print('awaited', await step(label, 5));
}

// 2. Armed, then removed before it can fire.
const doomed = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10, () => {
    print('removed source fired — it must not');
    return GLib.SOURCE_REMOVE;
});
GLib.Source.remove(doomed);
print('removed a pending source');

// 3. One more await proves the loop is still healthy after the removal; then the
// program ends with nothing scheduled and must exit on its own.
print('awaited', await step('d', 5));
print('done');
