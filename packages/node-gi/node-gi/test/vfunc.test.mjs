// SPDX-License-Identifier: MIT
// registerClass vfunc overrides (milestone) for @gjsify/node-gi.
//
// A registered subtype can override a parent GObject vfunc with a JS function.
// The override is hooked into the new type's class vtable in class_init: the
// vfunc info is resolved by walking the parent object-info chain, the slot is
// located via the matching class-struct field offset, and an ffi closure is
// written into it. The override is held by a per-CLASS strong napi_ref + closure
// that live for the (process-permanent) GType lifetime — the same ownership
// model as a signal class-handler, NOT a per-instance cycle (no toggle-ref).
// GTypes are process-global, so each test uses a unique name. Chain-up to the
// parent vfunc lands in a later drop; the tests use `constructed`, whose GObject
// base impl is a no-op, so they are correct without it.
import test from 'node:test';
import assert from 'node:assert/strict';

import { registerClass, constructType, getProperty, callMethod, isGObjectHandle, requireNamespace } from '../index.js';

test('constructed vfunc override runs during construction, with the instance as `this`', () => {
    requireNamespace('GObject', '2.0');
    let ran = false;
    let receiverWasHandle = false;
    const Type = registerClass('NodeGiVFuncConstructed', 'GObject', 'Object', {
        vfuncs: {
            constructed() {
                ran = true;
                // The receiver is the instance being constructed (a node-gi handle).
                receiverWasHandle = isGObjectHandle(this);
            },
        },
    });

    assert.equal(ran, false, 'override must not fire before construction');
    constructType(Type, {});
    assert.equal(ran, true, 'the constructed override ran during construction');
    assert.equal(receiverWasHandle, true, '`this` is the constructed GObject instance');
});

test('a vfunc override can read inherited construct properties via `this`', () => {
    requireNamespace('Gio', '2.0');
    let nameDuringConstructed = null;
    const Type = registerClass('NodeGiVFuncReadProp', 'Gio', 'SimpleAction', {
        vfuncs: {
            constructed() {
                // `name` is a CONSTRUCT_ONLY property set before `constructed` runs.
                nameDuringConstructed = getProperty(this, 'name');
            },
        },
    });

    constructType(Type, { name: 'greet' });
    assert.equal(nameDuringConstructed, 'greet');
});

test('overriding one vfunc leaves the parent get/set_property vfuncs intact', () => {
    let ran = false;
    const Type = registerClass('NodeGiVFuncNoRegress', 'Gio', 'SimpleAction', {
        vfuncs: {
            constructed() {
                ran = true;
            },
        },
    });
    const a = constructType(Type, { name: 'act', enabled: false });

    // The override fired, and the (NOT overridden) parent set/get_property +
    // GAction method path still work — writing into the `constructed` slot did not
    // corrupt the rest of the vtable.
    assert.equal(ran, true);
    assert.equal(callMethod(a, 'get_name'), 'act');
    assert.equal(getProperty(a, 'enabled'), false);
});

test('a sibling subclass without a vfunc override constructs normally', () => {
    const Overriding = registerClass('NodeGiVFuncSiblingA', 'Gio', 'SimpleAction', {
        vfuncs: {
            constructed() {
                /* no-op */
            },
        },
    });
    const Plain = registerClass('NodeGiVFuncSiblingB', 'Gio', 'SimpleAction');

    constructType(Overriding, { name: 'a' });
    const b = constructType(Plain, { name: 'b' });
    // The plain sibling is unaffected — its inherited constructed/methods work.
    assert.equal(callMethod(b, 'get_name'), 'b');
});

test('non-function vfunc entries are ignored', () => {
    const Type = registerClass('NodeGiVFuncIgnored', 'GObject', 'Object', {
        // Not a function — must be skipped, not crash construction.
        vfuncs: { constructed: 123 },
    });
    const o = constructType(Type, {});
    assert.equal(isGObjectHandle(o), true);
});
