// SPDX-License-Identifier: MIT
//
// Cross-runtime scenario: property round-trips + signal connect/disconnect +
// multi-handler notify + a registerClass custom signal.
//
// BYTE-IDENTICAL input to `gjsify build --app {gjs,node}`, run on gjs/node/bun/deno
// (see harness.mjs). Signals are exercised by COUNTING emissions only — never by
// reading callback arguments — because the callback-arg shape (e.g. whether the
// emitter is passed first) differs across the native gi:// and node-gi paths. That
// keeps the printed output identical on every runtime.
import GObject from 'gi://GObject?version=2.0';
import Gio from 'gi://Gio?version=2.0';

print('node-gi signals example');

// 1. Property round-trip on a plain GObject (get/set + property read).
const action = new Gio.SimpleAction({ name: 'act', enabled: true });
print(`name: ${action.get_name()}`);
action.set_enabled(false);
print(`enabled-after-set: ${action.get_enabled()}`);

// 2. notify:: counting across TWO handlers; disconnect() stops one of them.
let a = 0;
let b = 0;
const idA = action.connect('notify::enabled', () => {
    a += 1;
});
action.connect('notify::enabled', () => {
    b += 1;
});
action.set_enabled(true); // both fire
action.set_enabled(false); // both fire
action.disconnect(idA);
action.set_enabled(true); // only b fires
print(`notify: a=${a} b=${b}`);

// 3. A registerClass subclass with a custom void signal, emitted in a loop + counted.
let total = 0;
const Emitter = GObject.registerClass(
    {
        GTypeName: 'NodeGiSignalsEmitter',
        Signals: { ping: {} },
    },
    class Emitter extends GObject.Object {
        fireN(n) {
            for (let k = 0; k < n; k++) this.emit('ping');
        }
    },
);
const em = new Emitter();
em.connect('ping', () => {
    total += 1;
});
em.fireN(5);
print(`ping-total: ${total}`);

print('done');
