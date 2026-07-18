// SPDX-License-Identifier: MIT
// GObject.js override parity (phase 3.2) via headless Gio/GObject (no test typelib
// needed): the by-function signal-handler ops, GObject.Value construction +
// set_*/get_*/copy + the 2-arg convenience + instanceof + a static, GObject.Object.new
// by GType, and the AccumulatorType fake enum. The golden is the gjs output;
// node/bun/deno must match it byte-for-byte. Deterministic — no addresses/timestamps.
import GObject from 'gi://GObject?version=2.0';
import Gio from 'gi://Gio?version=2.0';

// ---- signal_handlers_{block,unblock,disconnect}_by_func -------------------
const a = new Gio.SimpleAction({ name: 'x', enabled: true });
let count = 0;
const handler = () => {
  count++;
};
a.connect('notify::enabled', handler);
a.connect('notify::enabled', handler);
a.connect('notify::enabled', () => {});
a.set_enabled(false);
print('after1:', count);
print('blocked:', GObject.signal_handlers_block_by_func(a, handler));
a.set_enabled(true);
print('after2:', count);
print('unblocked:', GObject.signal_handlers_unblock_by_func(a, handler));
a.set_enabled(false);
print('after3:', count);
print('disconnected:', GObject.signal_handlers_disconnect_by_func(a, handler));
a.set_enabled(true);
print('after4:', count);

// block_signal_handler / unblock_signal_handler (prototype methods)
let c2 = 0;
const b = new Gio.SimpleAction({ name: 'y', enabled: true });
const idb = b.connect('notify::enabled', () => {
  c2++;
});
b.block_signal_handler(idb);
b.set_enabled(false);
print('blockmethod:', c2);
b.unblock_signal_handler(idb);
b.set_enabled(true);
print('unblockmethod:', c2);

// ---- GObject.Value --------------------------------------------------------
const v = new GObject.Value();
v.init(GObject.TYPE_INT);
v.set_int(42);
print('value int:', v.get_int());
print('value string:', new GObject.Value(GObject.TYPE_STRING, 'hi').get_string());
print('value bool:', new GObject.Value(GObject.TYPE_BOOLEAN, true).get_boolean());
print('value double:', new GObject.Value(GObject.TYPE_DOUBLE, 3.5).get_double());
const copyTarget = new GObject.Value();
copyTarget.init(GObject.TYPE_INT);
v.copy(copyTarget);
print('value copy:', copyTarget.get_int());
print('value instanceof:', v instanceof GObject.Value);
print('type_compatible:', GObject.Value.type_compatible(GObject.TYPE_INT, GObject.TYPE_INT));

// ---- GObject.Object.new ---------------------------------------------------
const made = GObject.Object.new(Gio.SimpleAction.$gtype, { name: 'made', enabled: false });
print('object.new name:', made.name);
print('object.new get_name():', made.get_name());

// ---- AccumulatorType ------------------------------------------------------
print('accumulator NONE/FIRST_WINS/TRUE_HANDLED:', GObject.AccumulatorType.NONE, GObject.AccumulatorType.FIRST_WINS, GObject.AccumulatorType.TRUE_HANDLED);
