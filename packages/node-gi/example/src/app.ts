// SPDX-License-Identifier: MIT
//
// One source, two runtimes — the @gjsify/node-gi capstone.
//
// This file is BYTE-IDENTICAL input to both builds:
//   gjsify build src/app.ts --app gjs   → native `gi://` under GJS
//   gjsify build src/app.ts --app node  → `@gjsify/node-gi` under Node.js
//
// The `gi://` imports are rewritten by the bundler: kept native for `--app gjs`,
// routed to the node-gi L1 runtime (`requireGi`) for `--app node`. The `print`
// global is ambient under GJS and injected by `--globals auto` (the
// `@gjsify/node-gi/globals` shim) for the node build — NO explicit `/register`
// import needed.
//
// Every value printed below is DETERMINISTIC: no hostname, no varying paths, no
// dependence on callback arguments (Node's node-gi omits the emitter as the
// first signal-callback arg, so we only ever COUNT emissions). Running either
// build prints the same fixed sequence of lines — the golden output asserted by
// `dual.e2e.mjs`.

import GObject from 'gi://GObject?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';

print('node-gi dual example');

// 1. A namespace-level function call (deterministic — pure string transform).
print(`basename-fn: ${GLib.path_get_basename('/usr/bin/gjs')}`);

// 2. Enums / flags / constants.
print(`bus-session: ${Gio.BusType.SESSION}`);
print(`priority-default: ${GLib.PRIORITY_DEFAULT}`);

// 3. Construct a GObject the GJS way; call methods; read a property.
//    4. A signal exercised via a COUNTER (we never touch the callback args):
//       set_enabled() toggles fire `notify::enabled`, counted to 2.
const action = new Gio.SimpleAction({ name: 'greet', enabled: true });
print(`action-name: ${action.get_name()}`);
print(`action-enabled: ${action.get_enabled()}`);
let notifyCount = 0;
action.connect('notify::enabled', () => {
    notifyCount += 1;
});
action.set_enabled(false);
print(`action-enabled-after: ${action.enabled}`);
action.set_enabled(true);
print(`notify-count: ${notifyCount}`);

// 5. A constructor/static method + a deterministic instance method.
const file = Gio.File.new_for_path('/usr/share');
print(`file-basename: ${file.get_basename()}`);

// 6. A `GObject.registerClass` subclass: custom property + signal + a user
//    method + `vfunc_constructed`. State lives in GObject PROPERTIES (which
//    cross the node-gi vfunc/instance boundary). The JS constructor body now DOES
//    run under node-gi (G3), exactly as under GJS; this example still uses
//    `vfunc_constructed` (which fires during construction on both runtimes) and a
//    CONSTRUCT property so the init is byte-identical across the two runtimes.
let constructedCount = 0;
const Counter = GObject.registerClass(
    {
        GTypeName: 'NodeGiDualCounter',
        Properties: {
            // CONSTRUCT so the value passed to `new Counter({ count })` is
            // applied BEFORE `vfunc_constructed` runs.
            count: GObject.ParamSpec.int(
                'count',
                'Count',
                'a counter',
                GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT,
                0,
                100,
                0,
            ),
            label: GObject.ParamSpec.string(
                'label',
                'Label',
                'a label set during construction',
                GObject.ParamFlags.READWRITE,
                'unset',
            ),
        },
        Signals: {
            // A void signal (no param types) — dual-safe: GJS wants GTypes in
            // `param_types`, node-gi wants strings, so we declare none and only
            // count emissions.
            bumped: {},
        },
    },
    class Counter extends GObject.Object {
        describe() {
            return `${this.label} count=${this.count}`;
        }

        bump() {
            this.count = this.count + 1;
            this.emit('bumped');
        }

        vfunc_constructed() {
            constructedCount += 1;
            // `count` is a CONSTRUCT property, already set here; `label` is a
            // plain property we set during construction.
            this.label = `built@${this.count}`;
        }
    },
);

const counter = new Counter({ count: 10 });
let bumps = 0;
counter.connect('bumped', () => {
    bumps += 1;
});
counter.bump();
counter.bump();
print(`counter: describe="${counter.describe()}" bumps=${bumps} constructed=${constructedCount}`);

// 7. A bounded GLib main loop driven by a `GLib.timeout_add` ticker: it counts
//    to 3 (~30 ms) then quits the loop. The libuv↔GLib bridge keeps Node alive
//    during the blocking `loop.run()`; under GJS this is the native loop.
const loop = GLib.MainLoop.new(null, false);
let ticks = 0;
GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10, () => {
    ticks += 1;
    if (ticks >= 3) {
        loop.quit();
        return false; // G_SOURCE_REMOVE
    }
    return true; // G_SOURCE_CONTINUE
});
loop.run();
print(`ticks: ${ticks}`);

print('done');
