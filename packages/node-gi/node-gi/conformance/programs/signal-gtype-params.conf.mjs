// SPDX-License-Identifier: MIT
// GJS-canonical `Signals` declarations are GTYPE-valued: GJS's own GObject override
// (refs/gjs modules/core/overrides/GObject.js) hands `param_types` straight to
// g_signal_new, so `[GObject.TYPE_INT]` / `[SomeClass.$gtype]` is the ONLY spelling a
// ported GJS class ever uses. node-gi's L1 read only strings and ParamSpec
// descriptors, so a GType-valued entry was DROPPED and the signal was registered
// with zero parameters — `emit` then delivered no payload and the handler's argument
// was silently `undefined`. The golden is the gjs output; node/bun/deno must match it
// byte-for-byte. Deterministic — no addresses, paths or timings.
import GObject from 'gi://GObject?version=2.0';
import Gio from 'gi://Gio?version=2.0';

const Counter = GObject.registerClass(
    {
        GTypeName: 'NodeGiConfGTypeSignals',
        Signals: {
            changed: { param_types: [GObject.TYPE_INT, GObject.TYPE_STRING] },
            sum: { param_types: [GObject.TYPE_INT, GObject.TYPE_INT], return_type: GObject.TYPE_INT },
            got: { param_types: [Gio.SimpleAction.$gtype] },
        },
    },
    class Counter extends GObject.Object {},
);

// The registration itself: every declared param must reach g_signal_newv.
for (const name of ['changed', 'sum', 'got']) {
    const query = GObject.signal_query(GObject.signal_lookup(name, Counter.$gtype));
    print(`${name} n_params:`, query.n_params);
}

const c = new Counter();

// Delivery: fundamental params, a value-returning signal, and an object param.
c.connect('changed', (_emitter, n, s) => print('changed payload:', n, JSON.stringify(s)));
c.emit('changed', 42, 'hi');

c.connect('sum', (_emitter, a, b) => a + b);
print('sum result:', c.emit('sum', 3, 4));

c.connect('got', (_emitter, action) => print('got action:', action.get_name()));
c.emit('got', new Gio.SimpleAction({ name: 'x' }));
