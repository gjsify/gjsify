// SPDX-License-Identifier: MIT
// `vfunc_<name>` is reachable ON AN INSTANCE of an introspected class, and it
// dispatches — no `GObject.registerClass` anywhere in sight.
//
// This is the only route to a vfunc GI exposes as a slot and nothing else: GTK4
// deleted GtkContainer, and `Gtk.Buildable.add_child` is introspected as a vfunc with
// no method form, so `new Gtk.Box().vfunc_add_child(builder, child, null)` is what two
// React-for-GJS renderers route every insertion through. ADR 0027 § Context rests on
// that call being available.
//
// node-gi had it two ways wrong. `vfunc_*` lookups fell through to ONE shared Proxy
// under every class prototype which trapped `get` only — so `Cls.prototype.vfunc_x`
// was a function while `inst.vfunc_x` was `undefined` (the wrapper resolves members by
// DESCRIPTOR, and a get-only Proxy reports no descriptor and no `in`), and the thunk it
// returned could only chain up to a registerClass override's captured parent pointer,
// so on a plain instance it threw. Both halves are one claim: an instance reaches the
// vfunc, and the call reaches the class's own vtable slot.
//
// Headless Gio only — `Gio.ListModel`'s vfuncs are the same mechanism as
// `Gtk.Buildable`'s (an INTERFACE slot on an object that implements it), and
// `Gio.SimpleAction`'s `activate` is the same mechanism as a class vfunc.
import GObject from 'gi://GObject?version=2.0';
import Gio from 'gi://Gio?version=2.0';

const store = new Gio.ListStore({ 'item-type': Gio.SimpleAction.$gtype });
const first = new Gio.SimpleAction({ name: 'first' });
store.append(first);

// ---- an INTERFACE vfunc, on the instance, returning a value ----
print('typeof store.vfunc_get_n_items:', typeof store.vfunc_get_n_items);
print('store.vfunc_get_n_items():', store.vfunc_get_n_items());
print('type_name(store.vfunc_get_item_type()):', GObject.type_name(store.vfunc_get_item_type()));
print('store.vfunc_get_item(0) === the appended action:', store.vfunc_get_item(0) === first);
// Out of range: the slot returns NULL, which GI marshals as an object-typed null.
print('typeof store.vfunc_get_item(5):', typeof store.vfunc_get_item(5));

// ---- the SAME interface vfunc on a different implementor ----
const menu = new Gio.Menu();
menu.append('label', null);
print('menu.vfunc_get_n_items():', menu.vfunc_get_n_items());

// ---- a vfunc with an IN argument, observed through the effect it has ----
let fired = 0;
first.connect('activate', () => {
    fired++;
});
first.vfunc_activate(null);
print('vfunc_activate reached the implementation:', fired);

// ---- how the member is reachable: through the prototype, not off the instance ----
print('inst fn === proto fn:', store.vfunc_get_n_items === Gio.ListStore.prototype.vfunc_get_n_items);
print("'vfunc_get_n_items' in store:", 'vfunc_get_n_items' in store);
print('own on the instance:', Object.prototype.hasOwnProperty.call(store, 'vfunc_get_n_items'));
print(
    'the prototype reports a value descriptor:',
    typeof Object.getOwnPropertyDescriptor(Gio.ListStore.prototype, 'vfunc_get_n_items')?.value,
);
// An unknown vfunc name is `undefined`, never a throw-on-call thunk — real consumers
// feature-detect optional slots, and a thunk makes the detection lie.
print('typeof store.vfunc_not_a_real_vfunc:', typeof store.vfunc_not_a_real_vfunc);

// ---- `super.vfunc_<name>()` still reaches the introspected base's slot ----
// The registerClass path resolves `super` through the SAME prototype member, so this
// row is what stops the direct-dispatch fix from breaking chain-up.
const Chained = GObject.registerClass(
    { GTypeName: 'ConfVfuncChainedAction' },
    class Chained extends Gio.SimpleAction {
        vfunc_constructed() {
            super.vfunc_constructed();
            this.seen = true;
        }
    },
);
const chained = new Chained({ name: 'chained' });
print('subclass ctor ran through the chained vfunc:', chained.seen === true, chained.get_name());

// Deliberately NOT asserted: a vfunc a class DECLARES but does not implement
// (`vfunc_notify` on any GObject). gjs 1.88.1 throws "Virtual function not
// implemented: Class GSimpleAction doesn't implement notify" from the property READ;
// node-gi reports the name as absent instead. Recorded in packages/node-gi/AGENTS.md
// rather than ledgered here — a ledger entry would excuse this whole program.
