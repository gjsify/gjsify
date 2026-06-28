// SPDX-License-Identifier: MIT
// GVariant build + unpack for @gjsify/node-gi — the GJS GLib.Variant ergonomics.
//
// Reference: gjs/modules/core/overrides/GLib.js (_packVariant / _unpackVariant /
// unpack / deepUnpack / recursiveUnpack). Exercises both the native primitives
// (variantNew / variantUnpack / variantGetTypeString) and the L1 GLib.Variant
// surface (new GLib.Variant(sig, value) + .deepUnpack()/.unpack()/.recursive-
// Unpack()/.get_type_string()), plus an end-to-end Gio.SimpleAction round-trip
// (a built Variant carried through new_stateful / change_state / get_state and
// observed on the change-state signal). Headless — no main loop needed.
import test from 'node:test';
import assert from 'node:assert/strict';

import { variantNew, variantUnpack, variantGetTypeString, isVariantHandle } from '../index.js';
import { requireGi } from '../gi.js';

const GLib = requireGi('GLib', '2.0');

// ---- native primitives ----------------------------------------------------

test('native: basic round-trips (b/y/n/q/i/u/x/t/d/s/o/g)', () => {
  assert.equal(variantUnpack(variantNew('b', true)), true);
  assert.equal(variantUnpack(variantNew('b', false)), false);
  assert.equal(variantUnpack(variantNew('y', 200)), 200);
  assert.equal(variantUnpack(variantNew('n', -1234)), -1234);
  assert.equal(variantUnpack(variantNew('q', 4321)), 4321);
  assert.equal(variantUnpack(variantNew('i', -42)), -42);
  assert.equal(variantUnpack(variantNew('u', 42)), 42);
  assert.equal(variantUnpack(variantNew('x', 9000)), 9000);
  assert.equal(variantUnpack(variantNew('t', 9000)), 9000);
  assert.equal(variantUnpack(variantNew('d', 3.5)), 3.5);
  assert.equal(variantUnpack(variantNew('s', 'hello')), 'hello');
  assert.equal(variantUnpack(variantNew('o', '/org/example/Foo')), '/org/example/Foo');
  assert.equal(variantUnpack(variantNew('g', 'a{sv}')), 'a{sv}');
});

test('native: get_type_string reflects the built type', () => {
  assert.equal(variantGetTypeString(variantNew('s', 'x')), 's');
  assert.equal(variantGetTypeString(variantNew('a{sv}', {})), 'a{sv}');
  assert.equal(variantGetTypeString(variantNew('(si)', ['a', 1])), '(si)');
});

test('native: isVariantHandle distinguishes variants', () => {
  assert.equal(isVariantHandle(variantNew('s', 'x')), true);
  assert.equal(isVariantHandle('x'), false);
  assert.equal(isVariantHandle({}), false);
  assert.equal(isVariantHandle(null), false);
});

test('native: invalid signatures throw clear errors', () => {
  assert.throws(() => variantNew('', 'x'), /signature cannot be empty/);
  assert.throws(() => variantNew('ss', ['a', 'b']), /more than one single complete type/);
  assert.throws(() => variantNew('Z', 1), /Invalid GVariant signature/);
});

// ---- L1 GLib.Variant: new GLib.Variant(sig, value) + unpack flavours -------

test('L1: new GLib.Variant("s", "x").deepUnpack() === "x"', () => {
  assert.equal(new GLib.Variant('s', 'x').deepUnpack(), 'x');
});

test('L1: boolean / int32 / double round-trip', () => {
  assert.equal(new GLib.Variant('b', true).deepUnpack(), true);
  assert.equal(new GLib.Variant('i', -7).deepUnpack(), -7);
  assert.equal(new GLib.Variant('d', 2.25).deepUnpack(), 2.25);
});

test('L1: "as" → string[] (deepUnpack)', () => {
  const v = new GLib.Variant('as', ['a', 'b', 'c']);
  assert.deepEqual(v.deepUnpack(), ['a', 'b', 'c']);
  assert.equal(v.get_type_string(), 'as');
});

test('L1: "ai" → number[] (deepUnpack)', () => {
  assert.deepEqual(new GLib.Variant('ai', [1, 2, 3]).deepUnpack(), [1, 2, 3]);
});

test('L1: "ay" → bytes (Uint8Array)', () => {
  const v = new GLib.Variant('ay', [1, 2, 250, 255]);
  const bytes = v.deepUnpack();
  assert.ok(bytes instanceof Uint8Array);
  assert.deepEqual(Array.from(bytes), [1, 2, 250, 255]);
});

test('L1: "(si)" tuple → array', () => {
  const v = new GLib.Variant('(si)', ['answer', 42]);
  assert.deepEqual(v.deepUnpack(), ['answer', 42]);
  assert.equal(v.get_type_string(), '(si)');
});

test('L1: "(sib)" mixed tuple → array', () => {
  assert.deepEqual(new GLib.Variant('(sib)', ['x', -1, true]).deepUnpack(), ['x', -1, true]);
});

test('L1: "a{ss}" dict → plain object (deepUnpack)', () => {
  const v = new GLib.Variant('a{ss}', { one: '1', two: '2' });
  assert.deepEqual(v.deepUnpack(), { one: '1', two: '2' });
});

// The headline deep-vs-recursive distinction for a{sv}.
test('L1: "a{sv}" deepUnpack yields { key: Variant }; recursiveUnpack yields plain', () => {
  const v = new GLib.Variant('a{sv}', {
    name: new GLib.Variant('s', 'Ada'),
    age: new GLib.Variant('i', 36),
  });
  assert.equal(v.get_type_string(), 'a{sv}');

  // deepUnpack: one level — keys are JS, but the `v` values STAY Variants.
  const deep = v.deepUnpack();
  assert.deepEqual(Object.keys(deep).sort(), ['age', 'name']);
  assert.equal(typeof deep.name.deepUnpack, 'function'); // a GLib.Variant wrapper
  assert.equal(deep.name.deepUnpack(), 'Ada');
  assert.equal(deep.age.deepUnpack(), 36);

  // recursiveUnpack: fully plain JS, no Variants.
  assert.deepEqual(v.recursiveUnpack(), { name: 'Ada', age: 36 });
});

test('L1: unpack() keeps children as Variants (single level)', () => {
  const v = new GLib.Variant('as', ['x', 'y']);
  const shallow = v.unpack();
  assert.ok(Array.isArray(shallow));
  assert.equal(shallow.length, 2);
  // Each element is still a Variant wrapper.
  assert.equal(typeof shallow[0].deepUnpack, 'function');
  assert.equal(shallow[0].deepUnpack(), 'x');
  assert.equal(shallow[1].deepUnpack(), 'y');
});

test('L1: nested "v" — deepUnpack keeps it a Variant, recursiveUnpack unwraps', () => {
  const v = new GLib.Variant('v', new GLib.Variant('i', 5));
  assert.equal(v.get_type_string(), 'v');
  // deepUnpack of a top-level `v` returns the inner Variant (still a Variant).
  const inner = v.deepUnpack();
  assert.equal(typeof inner.deepUnpack, 'function');
  assert.equal(inner.deepUnpack(), 5);
  // recursiveUnpack unwraps fully.
  assert.equal(v.recursiveUnpack(), 5);
});

test('L1: "mi" maybe — value and null', () => {
  assert.equal(new GLib.Variant('mi', 7).deepUnpack(), 7);
  assert.equal(new GLib.Variant('mi', null).deepUnpack(), null);
});

test('L1: deep_unpack alias + GJS toString shape', () => {
  const v = new GLib.Variant('i', 11);
  assert.equal(v.deep_unpack(), 11);
  assert.equal(v.toString(), '[object variant of type "i"]');
});

test('L1: GLib.Variant.new(sig, value) deprecated alias works', () => {
  assert.equal(GLib.Variant.new('s', 'legacy').deepUnpack(), 'legacy');
});

test('L1: a built Variant routes other GVariant methods (n_children)', () => {
  const v = new GLib.Variant('as', ['a', 'b', 'c']);
  assert.equal(v.n_children(), 3);
});

// ---- end-to-end: Gio.SimpleAction carrying a built Variant -----------------

test('e2e: SimpleAction state round-trips through built Variants + the change-state signal', () => {
  const Gio = requireGi('Gio', '2.0');

  // A stateful action whose state is a built GLib.Variant (parameter_type null).
  const action = Gio.SimpleAction.new_stateful('counter', null, new GLib.Variant('i', 0));
  assert.equal(action.get_name(), 'counter');
  // get_state() returns a GVariant → wrapped as a GLib.Variant → deepUnpack.
  assert.equal(action.get_state().deepUnpack(), 0);

  // The change-state signal carries the requested value Variant (marshalled
  // through GValue → wrapped) — observe it, then let the default handler apply.
  let observed = null;
  action.connect('change-state', (value) => {
    observed = value.deepUnpack();
    action.set_state(value); // commit (SimpleAction has no default change-state handler)
  });

  action.change_state(new GLib.Variant('i', 5));
  assert.equal(observed, 5);
  assert.equal(action.get_state().deepUnpack(), 5);
});

test('e2e: a{sv} payload (the GAction/GSettings/DBus shape) survives a full round-trip', () => {
  const built = new GLib.Variant('a{sv}', {
    enabled: new GLib.Variant('b', true),
    label: new GLib.Variant('s', 'Run'),
    count: new GLib.Variant('i', 3),
  });
  assert.equal(built.get_type_string(), 'a{sv}');
  assert.deepEqual(built.recursiveUnpack(), { enabled: true, label: 'Run', count: 3 });
});
