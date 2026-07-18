// SPDX-License-Identifier: MIT
// JS function → GClosure IN-argument parity (base typelibs, deterministic output).
// A JS function passed for a GObject.Closure IN-arg is marshalled as a real
// GClosure whose marshal converts the invocation's GValue params to JS, calls the
// function, and marshals the JS return back. gjs is the gold standard — node / bun
// / deno must print byte-identical output.
//
// Covered here (all on base GLib/GObject/Gio, no test typelib, no addresses/timers):
//   • GObject.signal_connect_closure — a JS fn as a GClosure signal handler
//   • GObject.Object.prototype.bind_property_full — the JS transform actually
//     transforms (to + bidirectional from), and [false, …] leaves it unchanged.
import GObject from 'gi://GObject?version=2.0';
import Gio from 'gi://Gio?version=2.0';

// ---- signal_connect_closure ------------------------------------------------
const action = new Gio.SimpleAction({ name: 'x', enabled: true });
const seen = [];
const id = GObject.signal_connect_closure(
  action,
  'notify::enabled',
  (obj, pspec) => {
    seen.push([obj === action, pspec.name]);
  },
  false,
);
print('id is number:', typeof id === 'number' && id > 0);
action.set_enabled(false);
print('handler saw:', JSON.stringify(seen));
GObject.signal_handler_disconnect(action, id);
action.set_enabled(true);
print('after disconnect:', JSON.stringify(seen));

// ---- bind_property_full ----------------------------------------------------
const T = GObject.registerClass(
  {
    GTypeName: 'NodeGiConfBindFull',
    Properties: {
      bool: GObject.ParamSpec.boolean('bool', 'Bool', 'B', GObject.ParamFlags.READWRITE, true),
      num: GObject.ParamSpec.int('num', 'Num', 'N', GObject.ParamFlags.READWRITE, -1000, 1000, 0),
      string: GObject.ParamSpec.string('string', 'String', 'S', GObject.ParamFlags.READWRITE, ''),
    },
  },
  class NodeGiConfBindFull extends GObject.Object {},
);

const a = new T();
const b = new T();
a.bind_property_full(
  'bool',
  b,
  'string',
  GObject.BindingFlags.NONE,
  (_binding, source) => [true, `${source}`],
  null,
);
a.bool = true;
print('transform-to result:', JSON.stringify(b.string));

const c = new T();
const d = new T();
d.string = 'unchanged';
c.bind_property_full('num', d, 'string', GObject.BindingFlags.NONE, () => [false, 'nope'], null);
c.num = 7;
print('false-return keeps target:', JSON.stringify(d.string));

const e = new T();
const f = new T();
e.bind_property_full(
  'num',
  f,
  'string',
  GObject.BindingFlags.BIDIRECTIONAL,
  (_binding, src) => [true, `n:${src}`],
  (_binding, src) => [true, parseInt(String(src).replace('n:', ''), 10) + 1],
);
e.num = 5;
print('bidirectional to:', JSON.stringify(f.string));
f.string = 'n:41';
print('bidirectional from:', e.num);
