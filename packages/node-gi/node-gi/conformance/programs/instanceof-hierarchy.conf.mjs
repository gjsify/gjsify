// SPDX-License-Identifier: MIT
// `instanceof` across the GObject hierarchy (phase 3.x) — GJS parity for the WHOLE
// class chain + implemented interfaces, not just the leaf class. Headless
// Gio/GObject (no display / test typelib). An introspected instance is a Proxy over
// a bare handle with no live JS prototype chain, so the default instanceof reported
// `false` for base classes and interfaces; node-gi now resolves it through the
// GObject type system (g_type_is_a) exactly like GJS. The golden is the gjs output;
// node/bun/deno must match it byte-for-byte. Deterministic — no addresses/timestamps.
import GObject from 'gi://GObject?version=2.0';
import Gio from 'gi://Gio?version=2.0';

const action = new Gio.SimpleAction({ name: 'x', enabled: true });
const group = new Gio.SimpleActionGroup();
const cancellable = new Gio.Cancellable();

// ---- introspected instance: exact class, base classes, implemented interfaces ----
print('action instanceof SimpleAction:', action instanceof Gio.SimpleAction);
print('action instanceof GObject.Object:', action instanceof GObject.Object);
print('action instanceof Gio.Action (iface):', action instanceof Gio.Action);
print('group instanceof SimpleActionGroup:', group instanceof Gio.SimpleActionGroup);
print('group instanceof GObject.Object:', group instanceof GObject.Object);
print('group instanceof Gio.ActionGroup (iface):', group instanceof Gio.ActionGroup);
print('group instanceof Gio.ActionMap (iface):', group instanceof Gio.ActionMap);

// ---- negatives: unrelated class, un-implemented interface, non-GObject values ----
print('action instanceof Cancellable:', action instanceof Gio.Cancellable);
print('action instanceof SimpleActionGroup:', action instanceof Gio.SimpleActionGroup);
print('cancellable instanceof Gio.Action:', cancellable instanceof Gio.Action);
print('plain {} instanceof SimpleAction:', {} instanceof Gio.SimpleAction);
print('null instanceof SimpleAction:', null instanceof Gio.SimpleAction);
print('boxed Variant instanceof SimpleAction:', new GObject.Value() instanceof Gio.SimpleAction);

// ---- registered subclass: leaf, introspected base, GObject.Object, interface ----
const MyAction = GObject.registerClass(
  { GTypeName: 'NodeGiInstanceofAction' },
  class MyAction extends Gio.SimpleAction {},
);
const OtherAction = GObject.registerClass(
  { GTypeName: 'NodeGiInstanceofOther' },
  class OtherAction extends Gio.SimpleAction {},
);
const sub = new MyAction({ name: 'sub', enabled: true });
print('sub instanceof MyAction (leaf):', sub instanceof MyAction);
print('sub instanceof SimpleAction (base):', sub instanceof Gio.SimpleAction);
print('sub instanceof GObject.Object:', sub instanceof GObject.Object);
print('sub instanceof Gio.Action (iface):', sub instanceof Gio.Action);
print('sub instanceof OtherAction (sibling):', sub instanceof OtherAction);
print('plain SimpleAction instanceof MyAction:', action instanceof MyAction);
