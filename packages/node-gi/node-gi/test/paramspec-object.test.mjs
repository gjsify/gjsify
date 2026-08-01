// SPDX-License-Identifier: MIT
// GObject.ParamSpec.object / .boxed (G1) for @gjsify/node-gi.
//
// The scalar ParamSpec kinds (string/boolean/int/…) gained two GType-valued
// siblings: `GObject.ParamSpec.object(name, nick, blurb, flags, gtype)` and
// `.boxed(...)`, where `gtype` is a class ctor (its real `$gtype` is read, G4) or
// a GType handle. They build a real g_param_spec_object / g_param_spec_boxed via
// the engine's BuildParamSpec, so a registerClass property typed as a GObject can
// be set + read back as a wrapped instance (round-tripping identity). This is the
// storybook's first crash (`StoryWidget`'s `meta`/`args` are ParamSpec.object).
//
// Reference: GJS's GObject.ParamSpec.object/.boxed argument order
// (refs/gjs/modules/core/overrides/GObject.js). GTypes are process-global +
// permanent, so each test registers a uniquely-named type.
import test from 'node:test';
import assert from 'node:assert/strict';

import { requireGi } from '../gi.js';

const GObject = requireGi('GObject', '2.0');
const Gio = requireGi('Gio', '2.0');
const GLib = requireGi('GLib', '2.0');
const RW = GObject.ParamFlags.READWRITE;

test('GObject.ParamSpec.object/.boxed are surfaced as factories', () => {
    assert.equal(typeof GObject.ParamSpec.object, 'function');
    assert.equal(typeof GObject.ParamSpec.boxed, 'function');
    // The factory returns a GJS-shaped descriptor carrying the resolved value gtype.
    const desc = GObject.ParamSpec.object('meta', 'Meta', 'an object prop', RW, GObject.Object);
    assert.equal(desc.$paramSpec, true);
    assert.equal(desc.type, 'object');
    assert.equal(desc.name, 'meta');
    assert.notEqual(desc.gtype, undefined); // GObject.Object.$gtype handle
});

test('an object property set+get round-trips a wrapped instance (identity)', () => {
    const Holder = GObject.registerClass(
        {
            GTypeName: 'NodeGiParamSpecObjectHolder',
            Properties: {
                meta: GObject.ParamSpec.object('meta', 'Meta', 'a GObject-typed prop', RW, GObject.Object),
            },
        },
        class Holder extends GObject.Object {},
    );

    const h = new Holder();
    const payload = new Gio.SimpleAction({ name: 'act' });

    // set then get round-trips the SAME wrapper (the toggle-ref identity cache).
    h.meta = payload;
    const got = h.meta;
    assert.equal(got === payload, true, 'the object property reads back the identical wrapper');
    assert.equal(got.get_name(), 'act', 'the round-tripped GObject is the real instance');

    // a different instance replaces it.
    const other = new Gio.SimpleAction({ name: 'other' });
    h.meta = other;
    assert.equal(h.meta === other, true);

    // null clears it.
    h.meta = null;
    assert.equal(h.meta, null);
});

test('an object property accepts the value at construction time', () => {
    const Holder = GObject.registerClass(
        {
            GTypeName: 'NodeGiParamSpecObjectCtor',
            Properties: {
                meta: GObject.ParamSpec.object('meta', '', '', RW, GObject.Object),
            },
        },
        class Holder extends GObject.Object {},
    );
    const payload = new Gio.SimpleAction({ name: 'ctor' });
    const h = new Holder({ meta: payload });
    assert.equal(h.meta === payload, true);
});

test('a .boxed ParamSpec builds and installs (GLib.DateTime is a boxed type)', () => {
    const desc = GObject.ParamSpec.boxed('when', 'When', 'a boxed prop', RW, GLib.DateTime);
    assert.equal(desc.$paramSpec, true);
    assert.equal(desc.type, 'boxed');
    assert.notEqual(desc.gtype, undefined);

    const Boxer = GObject.registerClass(
        {
            GTypeName: 'NodeGiParamSpecBoxer',
            Properties: { when: desc },
        },
        class Boxer extends GObject.Object {},
    );
    // The class registered (so the boxed pspec installed without error).
    assert.equal(GObject.type_name(Boxer.$gtype), 'NodeGiParamSpecBoxer');
});

test('error: an object/boxed ParamSpec without a gtype is rejected clearly', () => {
    assert.throws(
        () =>
            GObject.registerClass(
                {
                    GTypeName: 'NodeGiParamSpecObjectNoGType',
                    Properties: { x: GObject.ParamSpec.object('x', '', '', RW, undefined) },
                },
                class extends GObject.Object {},
            ),
        /requires a gtype/,
    );
});

test('error: an object ParamSpec gtype that is not a GObject type is rejected', () => {
    assert.throws(
        () =>
            GObject.registerClass(
                {
                    GTypeName: 'NodeGiParamSpecObjectBadGType',
                    // GLib.DateTime is a boxed (not GObject) type → invalid for .object.
                    Properties: { x: GObject.ParamSpec.object('x', '', '', RW, GLib.DateTime) },
                },
                class extends GObject.Object {},
            ),
        /must be a GObject type/,
    );
});
