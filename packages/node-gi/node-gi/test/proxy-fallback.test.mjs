// SPDX-License-Identifier: MIT
// L1 instance-proxy get-trap fallback + userProto-cache behavior (gi.js).
//
// Guards two residual fixes in the toggle-ref PR:
//   * minor 4 — the get trap's own-property-only narrowing dropped the inherited
//     Object.prototype-method fallback, so `inst.hasOwnProperty('x')` resolved to a
//     GI callMethod thunk and threw. Inherited members must resolve to the real
//     function (RESERVED already covers toString/valueOf; this covers the rest).
//   * minor 3 — the instanceCache is keyed on the handle; a subclass instance
//     re-wrapped generically must KEEP its prototype methods (no downgrade) and
//     stay identical (===). The userProto now lives on the target so a later
//     userProto wrap can also upgrade a generic wrapper in place.
import test from 'node:test';
import assert from 'node:assert/strict';
import { requireGi } from '../gi.js';

const Gio = requireGi('Gio', '2.0');
const GObject = requireGi('GObject', '2.0');

test('minor 4: inherited Object.prototype methods resolve (not GI thunks)', () => {
    const a = new Gio.SimpleAction({ name: 'h', enabled: true });
    a.__expando = 7;
    // hasOwnProperty must be the real function and return correct booleans — NOT a
    // GI callMethod thunk (which would throw on the non-existent `has_own_property`).
    assert.equal(typeof a.hasOwnProperty, 'function');
    assert.equal(a.hasOwnProperty('__expando'), true);
    assert.equal(a.hasOwnProperty('nope'), false);
    assert.equal(typeof a.isPrototypeOf, 'function');
    assert.equal(typeof a.propertyIsEnumerable, 'function');
    // Expando reads + RESERVED names + real GI methods all still work alongside it.
    assert.equal(a.__expando, 7);
    assert.equal(typeof a.toString, 'function');
    assert.equal(a.get_name(), 'h', 'a genuine GI method is still routed');
});

test('minor 3: a generically re-wrapped subclass keeps its prototype methods (no downgrade)', () => {
    class Widget extends GObject.Object {
        myMethod() {
            return 'mine';
        }
    }
    const Klass = GObject.registerClass({ GTypeName: 'NodeGiProxyNoDowngrade' }, Widget);
    const inst = new Klass();
    assert.equal(inst.myMethod(), 'mine', 'userProto method resolves on the constructed instance');
    // ref() hands the SAME GObject back generically (wrapReturn, no userProto). The
    // cache must return the identical proxy WITH its prototype methods intact.
    const back = inst.ref();
    assert.strictEqual(back, inst, 'generic re-wrap returns the identical proxy');
    assert.equal(typeof back.myMethod, 'function', 'prototype method survives a generic re-wrap');
    assert.equal(back.myMethod(), 'mine');
    inst.unref();
});
