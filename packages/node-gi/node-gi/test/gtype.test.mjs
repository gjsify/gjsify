// SPDX-License-Identifier: MIT
// Real `Class.$gtype` + G_TYPE_GTYPE / GI_TYPE_TAG_GTYPE marshalling (G4) for
// @gjsify/node-gi.
//
// A GType is represented as a dedicated, tag-distinct External (NOT a number, NOT
// a GObject/boxed handle). Every introspected class/struct ctor gains a lazy
// `$gtype` getter (the engine's getGType), and a registerClass'd type's `$gtype`
// is the same handle constructType consumes. GType-typed GI arguments marshal both
// ways (`GObject.type_ensure(X.$gtype)`, `GObject.type_name(gt)` IN;
// `GObject.type_from_name(name)` returning a GType). This unblocks the storybook's
// module-top-level `GObject.type_ensure(StoryWidget.$gtype)` + `Adw.Clamp.$gtype`.
//
// Reference: GJS's GType marshalling (refs/gjs/gi/{gtype,arg}.cpp). GTypes are
// process-global + permanent, so each registered type uses a unique name.
import test from 'node:test';
import assert from 'node:assert/strict';

import { requireGi } from '../gi.js';
import { isGObjectHandle, isBoxedHandle, getGType } from '../index.js';

const GObject = requireGi('GObject', '2.0');
const Gio = requireGi('Gio', '2.0');

test('an introspected class exposes a real $gtype (a tag-distinct handle)', () => {
  const gt = Gio.SimpleAction.$gtype;
  // Not undefined, not a string ($gtypeName), not a GObject/boxed handle.
  assert.notEqual(gt, undefined);
  assert.notEqual(typeof gt, 'string');
  assert.equal(typeof gt, 'object');
  assert.equal(isGObjectHandle(gt), false);
  assert.equal(isBoxedHandle(gt), false);
  // It names the right GType.
  assert.equal(GObject.type_name(gt), 'GSimpleAction');
  // $gtypeName stays the namespaced string (unchanged by $gtype).
  assert.equal(Gio.SimpleAction.$gtypeName, 'Gio.SimpleAction');
});

test('$gtype is cached (lazily memoised) — stable identity across reads', () => {
  const a = Gio.SimpleAction.$gtype;
  const b = Gio.SimpleAction.$gtype;
  assert.equal(a, b, 'the lazy getter caches the handle as a value after first read');
});

test('an introspected struct (boxed) exposes a $gtype', () => {
  const GLib = requireGi('GLib', '2.0');
  assert.equal(GObject.type_name(GLib.DateTime.$gtype), 'GDateTime');
});

test('a registerClass type exposes its own real $gtype', () => {
  const Thing = GObject.registerClass(class NodeGiGTypeThing extends GObject.Object {});
  const gt = Thing.$gtype;
  assert.notEqual(gt, undefined);
  assert.equal(typeof gt, 'object');
  assert.equal(GObject.type_name(gt), 'NodeGiGTypeThing');
});

test('GObject.type_ensure(X.$gtype) runs without error (GType IN arg)', () => {
  const Thing = GObject.registerClass(class NodeGiGTypeEnsure extends GObject.Object {});
  // type_ensure takes a single GI_TYPE_TAG_GTYPE arg; returns void.
  assert.doesNotThrow(() => GObject.type_ensure(Thing.$gtype));
  assert.doesNotThrow(() => GObject.type_ensure(Gio.SimpleAction.$gtype));
});

test('a GI call taking AND returning a GType round-trips', () => {
  const Thing = GObject.registerClass(class NodeGiGTypeRoundTrip extends GObject.Object {});
  // IN: type_name(GType) -> string.
  const name = GObject.type_name(Thing.$gtype);
  assert.equal(name, 'NodeGiGTypeRoundTrip');
  // RETURN: type_from_name(string) -> GType (a handle), which marshals back.
  const back = GObject.type_from_name(name);
  assert.notEqual(back, null);
  assert.equal(typeof back, 'object');
  assert.equal(GObject.type_name(back), 'NodeGiGTypeRoundTrip');
});

test('type_parent(X.$gtype) returns a GType handle (return marshalling)', () => {
  // Gio.SimpleAction's parent is GObject; type_parent returns a GType.
  const parent = GObject.type_parent(Gio.SimpleAction.$gtype);
  assert.notEqual(parent, null);
  assert.equal(GObject.type_name(parent), 'GObject');
});

test('type_is_a(X.$gtype, GObject.$gtype) — two GType IN args', () => {
  assert.equal(GObject.type_is_a(Gio.SimpleAction.$gtype, GObject.Object.$gtype), true);
});

test('the native getGType returns null for an unknown name', () => {
  assert.equal(getGType('Gio', 'NoSuchType_xyz'), null);
});

test('type_from_name of an unregistered name returns null (0 GType → null)', () => {
  assert.equal(GObject.type_from_name('NodeGiNoSuchGType_xyz'), null);
});
