// SPDX-License-Identifier: MIT
// camelCase CONSTRUCT-property keys (GAP B) for @gjsify/node-gi.
//
// GJS accepts a construct-property dict key in camelCase (`{maximumSize: 400}`),
// snake_case (`{maximum_size}`) or already-dashed (`{'maximum-size'}`) form and maps
// it to the GObject property. node-gi's native newObject/constructType layer looks
// each key up against the GParamSpec by its canonical dashed name, so the JS proxy
// must normalize the key first (in unwrapProps, via the SAME `toKebab` the property
// getter/setter accessor path uses — one source of truth). This must hold on ALL
// three construct paths: an introspected `new Ns.Class({...})`, a registerClass'd
// subclass `new Sub({...})`, and a subclass ctor's `super({...})` chain-up.
//
// All headless: Gio.BufferedInputStream is a plain GObject (no display) carrying the
// multi-word construct props `buffer-size` + `base-stream`; the registered subtypes
// extend the bare GObject.Object base. GTypes are process-global, so each registered
// type uses a unique name.
import test from 'node:test';
import assert from 'node:assert/strict';

import { requireGi, unwrap } from '../gi.js';
import native from '../index.js';

const Gio = requireGi('Gio', '2.0');
const GObject = requireGi('GObject', '2.0');
const RW = GObject.ParamFlags.READWRITE;

test('introspected: a multi-word camelCase construct prop is accepted', () => {
    const base = new Gio.MemoryInputStream({});
    // `bufferSize` (camelCase) must reach the `buffer-size` GParamSpec — the exact
    // shape the Adwaita storybook uses (`new Adw.Clamp({maximumSize: 400})`).
    const bis = new Gio.BufferedInputStream({ baseStream: base, bufferSize: 1024 });
    assert.equal(native.getTypeName(unwrap(bis)), 'GBufferedInputStream');
    // Read it back BOTH via the camelCase accessor and the canonical native name.
    assert.equal(bis.bufferSize, 1024);
    assert.equal(native.getProperty(unwrap(bis), 'buffer-size'), 1024);
});

test('introspected: snake_case + dashed construct keys still work (idempotent)', () => {
    const snake = new Gio.BufferedInputStream({
        base_stream: new Gio.MemoryInputStream({}),
        buffer_size: 2048,
    });
    assert.equal(snake.bufferSize, 2048);

    const dashed = new Gio.BufferedInputStream({
        'base-stream': new Gio.MemoryInputStream({}),
        'buffer-size': 4096,
    });
    assert.equal(dashed.bufferSize, 4096);
});

test('registerClass: a camelCase construct prop on a registered subclass', () => {
    const Widget = GObject.registerClass(
        {
            GTypeName: 'NodeGiCamelConstructWidget',
            Properties: {
                'max-count': GObject.ParamSpec.int('max-count', 'Max Count', 'a count', RW, 0, 1000, 5),
            },
        },
        class CamelConstructWidget extends GObject.Object {},
    );

    // camelCase key → the declared `max-count` property.
    const w = new Widget({ maxCount: 42 });
    assert.equal(native.getTypeName(unwrap(w)), 'NodeGiCamelConstructWidget');
    assert.equal(w.maxCount, 42);

    // dashed key still works; a fresh instance with no args sees the default.
    const dashed = new Widget({ 'max-count': 99 });
    assert.equal(dashed.maxCount, 99);
    assert.equal(new Widget({}).maxCount, 5);
});

test('super({camelCaseProp}) in a subclass ctor chains the construct prop', () => {
    let countInCtor = null;
    const Sub = GObject.registerClass(
        {
            GTypeName: 'NodeGiCamelConstructSuper',
            Properties: {
                'max-count': GObject.ParamSpec.int('max-count', 'Max Count', 'a count', RW, 0, 1000, 7),
            },
        },
        class CamelConstructSuper extends GObject.Object {
            constructor(n) {
                // The camelCase key passed UP through super({...}) must apply the construct
                // prop on the registered GType (the constructType path), not be dropped.
                super(n === undefined ? {} : { maxCount: n });
                countInCtor = this.maxCount;
            }
        },
    );

    const s = new Sub(123);
    assert.equal(s.maxCount, 123, 'super({maxCount}) applied the construct prop');
    assert.equal(countInCtor, 123, 'the value was already set when the ctor body ran');

    // super({}) with no arg falls back to the declared default.
    assert.equal(new Sub(undefined).maxCount, 7);
});

test('a single-word camelCase=canonical key is unaffected', () => {
    // `name` is already its canonical form — toKebab is a no-op, so plain keys that
    // happen to equal their GObject name keep working.
    const action = new Gio.SimpleAction({ name: 'act', enabled: false });
    assert.equal(action.name, 'act');
    assert.equal(action.enabled, false);
});
