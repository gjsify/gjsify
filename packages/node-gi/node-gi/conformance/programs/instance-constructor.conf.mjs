// SPDX-License-Identifier: MIT
// An introspected instance's `constructor` IS its class object — the very object
// `requireGi` hands back — so it carries `$gtype`.
//
// node-gi wrapped instances in a Proxy whose target had NO prototype of its own and
// carried the class prototype as a SYMBOL instead, while `constructor` is a RESERVED
// name the get trap passes straight to that target: every introspected instance
// answered `Object`. `Object` has no `$gtype`, so `GObject.type_name(inst.constructor
// .$gtype)` was `null` and every consumer that names an instance by its GType read
// the string "null" — measured as 99 of the 125 failures in @gjsify/gtk-host's node
// leg, all of them `No descriptor registered for null` out of `adopt()`,
// `nearestRegistered()` and every descriptor lookup, which read exactly that field.
//
// The fix is the LINK, not a `$gtype` getter on instances: a wrapper's [[Prototype]]
// is now its class's prototype, whose own `constructor` back-link is the class object
// (makeClass). Headless Gio/GObject only — nothing here is toolkit-specific.
import GObject from 'gi://GObject?version=2.0';
import Gio from 'gi://Gio?version=2.0';

const named = (cls) => GObject.type_name(cls.$gtype);

// ---- a directly constructed instance ----
for (const [label, cls, inst] of [
    ['Gio.SimpleAction', Gio.SimpleAction, new Gio.SimpleAction({ name: 'a' })],
    ['Gio.Menu', Gio.Menu, new Gio.Menu()],
    ['Gio.MemoryOutputStream', Gio.MemoryOutputStream, new Gio.MemoryOutputStream()],
    ['GObject.Object', GObject.Object, new GObject.Object()],
]) {
    print(`${label}: ctor === the class:`, inst.constructor === cls);
    print(`${label}: type_name(ctor.$gtype):`, GObject.type_name(inst.constructor.$gtype));
    print(`${label}: named by its own class:`, GObject.type_name(inst.constructor.$gtype) === named(cls));
    // Inherited, never an own field: the class prototype is what supplies it.
    print(`${label}: own 'constructor':`, Object.prototype.hasOwnProperty.call(inst, 'constructor'));
    print(`${label}: [[Prototype]] is the class prototype:`, Object.getPrototypeOf(inst) === cls.prototype);
}

// ---- a GObject.registerClass subclass answers with ITS class and ITS GType ----
const Sub = GObject.registerClass({ GTypeName: 'ConfInstanceCtorSub' }, class Sub extends Gio.SimpleAction {});
const sub = new Sub({ name: 'sub' });
print('subclass: ctor === the subclass:', sub.constructor === Sub);
print('subclass: type_name(ctor.$gtype):', GObject.type_name(sub.constructor.$gtype));
print('subclass: an instance of the base too:', sub instanceof Gio.SimpleAction);

// ---- an instance that came BACK from C, never constructed in this scope ----
// The seam a renderer adopting a foreign container reads: whatever handed the object
// over, `constructor.$gtype` must still name it.
const store = new Gio.ListStore({ 'item-type': Gio.SimpleAction.$gtype });
const first = new Gio.SimpleAction({ name: 'first' });
store.append(first);
const back = store.get_item(0);
print('round-trip: same wrapper:', back === first);
print('round-trip: type_name(ctor.$gtype):', GObject.type_name(back.constructor.$gtype));

// ---- the instance a SIGNAL delivers ----
let senderName = 'never fired';
store.connect('items-changed', (sender) => {
    senderName = GObject.type_name(sender.constructor.$gtype);
});
store.append(new Gio.SimpleAction({ name: 'second' }));
print('signal sender: type_name(ctor.$gtype):', senderName);

// ---- a plain JS object is NOT named by a GType through this path ----
// Deliberately not asserted: `({}).constructor.$gtype` — gjs boxes every JS object as
// a `JSObject` GType and node-gi does not, a divergence @gjsify/gtk-host's
// describeValue() already handles by treating 'JSObject' as the absence of a GType.
print('plain object ctor:', {}.constructor === Object);
