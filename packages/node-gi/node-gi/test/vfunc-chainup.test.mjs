// SPDX-License-Identifier: MIT
// registerClass vfunc CHAIN-UP (`super.vfunc_<name>(...)`) for @gjsify/node-gi.
//
// A registered subclass overriding a parent GObject vfunc can now invoke the
// PARENT implementation — the C default, or a JS override further up the chain.
// At registration the parent's vtable function pointer for the overridden slot is
// captured BEFORE the trampoline overwrites it (in class_init the new class struct
// is a memcpy of the parent's, so the slot holds the parent impl). The native
// callParentVfunc ffi_call's that captured pointer, reusing the same cif the
// override's closure was built from (instance + declared args → return). The L1
// `gi.js` layer wires `super.vfunc_<name>` to it via the introspected base class's
// prototype chain. Mirrors GJS's gi/object.cpp chain-up model.
//
// All scenarios are headless (no GTK/display). `Gio.SimpleAction` is the
// no-return base (its inherited GObject `constructed` is a safe no-op chain
// target); `Gio.Application.name_lost` is the args-less boolean-returning vfunc
// whose C default returns TRUE — proving the return marshalling path. GTypes are
// process-global, so each test uses a unique GType name.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    registerClass,
    constructType,
    callParentVfunc,
    callMethod,
    callStaticMethod,
    getProperty,
    isGObjectHandle,
    requireNamespace,
} from '../index.js';
import { requireGi } from '../gi.js';

// ---- native engine layer (callParentVfunc) ----

test('callParentVfunc chains up to the C parent during construction (order + this)', () => {
    requireNamespace('GObject', '2.0');
    requireNamespace('Gio', '2.0');
    const order = [];
    let thisInside = null;
    const Type = registerClass('NodeGiChainConstructed', 'Gio', 'SimpleAction', {
        vfuncs: {
            constructed() {
                order.push('child-before');
                thisInside = this;
                // Chain up to the parent's `constructed`. If parentPtr were wrongly our
                // own trampoline this would recurse forever — terminating proves the
                // captured pointer is the PARENT, not the override.
                callParentVfunc(this, 'constructed', []);
                order.push('child-after');
            },
        },
    });

    const inst = constructType(Type, { name: 'greet' });
    // The override ran, chained up to the parent, then resumed — in order.
    assert.deepEqual(order, ['child-before', 'child-after']);
    // `this` inside the override is the SAME canonical wrapper construct returned.
    assert.equal(isGObjectHandle(thisInside), true);
    assert.equal(thisInside, inst);
    // The instance is fully constructed + usable after chain-up (inherited
    // GAction/property path intact — chain-up did not corrupt the object).
    assert.equal(callMethod(inst, 'get_name'), 'greet');
    assert.equal(getProperty(inst, 'name'), 'greet');
});

test('callParentVfunc marshals a boolean RETURN from the parent vfunc', () => {
    requireNamespace('Gio', '2.0');
    // GApplication.name_lost has no args and a `gboolean` return; its C default
    // returns TRUE. Overriding it installs the trampoline (so a parent pointer is
    // captured); chaining up runs the C default and returns its value to JS.
    const Type = registerClass('NodeGiChainNameLost', 'Gio', 'Application', {
        vfuncs: {
            name_lost() {
                return false;
            },
        },
    });
    const app = constructType(Type, { 'application-id': 'eu.gjsify.ChainNameLost' });
    const parentResult = callParentVfunc(app, 'name_lost', []);
    assert.equal(parentResult, true, 'the parent GApplication.name_lost returns TRUE');
    assert.equal(typeof parentResult, 'boolean');
});

test('callParentVfunc throws cleanly when there is no overridden vfunc to chain to', () => {
    requireNamespace('Gio', '2.0');
    // A plain subclass with NO vfunc override — no captured parent pointer exists.
    const Plain = registerClass('NodeGiChainNoOverride', 'Gio', 'SimpleAction');
    const inst = constructType(Plain, { name: 'plain' });
    assert.throws(() => callParentVfunc(inst, 'constructed', []), /no parent vfunc 'constructed'/);
    // The instance is unharmed.
    assert.equal(callMethod(inst, 'get_name'), 'plain');
});

test('callParentVfunc validates its arguments', () => {
    requireNamespace('Gio', '2.0');
    const Type = registerClass('NodeGiChainArgCheck', 'Gio', 'SimpleAction', {
        vfuncs: {
            constructed() {
                /* no chain-up here */
            },
        },
    });
    const inst = constructType(Type, { name: 'x' });
    // Missing vfunc name.
    assert.throws(() => callParentVfunc(inst), /callParentVfunc/);
    // Non-string vfunc name.
    assert.throws(() => callParentVfunc(inst, 123), /callParentVfunc/);
});

test('two sibling subclasses each chain up to their own parent independently', () => {
    requireNamespace('Gio', '2.0');
    const seen = [];
    const A = registerClass('NodeGiChainSiblingA', 'Gio', 'SimpleAction', {
        vfuncs: {
            constructed() {
                seen.push('A');
                callParentVfunc(this, 'constructed', []);
            },
        },
    });
    const B = registerClass('NodeGiChainSiblingB', 'Gio', 'SimpleAction', {
        vfuncs: {
            constructed() {
                seen.push('B');
                callParentVfunc(this, 'constructed', []);
            },
        },
    });
    const a = constructType(A, { name: 'a' });
    const b = constructType(B, { name: 'b' });
    assert.deepEqual(seen, ['A', 'B']);
    assert.equal(callMethod(a, 'get_name'), 'a');
    assert.equal(callMethod(b, 'get_name'), 'b');
});

// ---- L1 layer (`super.vfunc_<name>()` through gi.js) ----

test('super.vfunc_constructed() runs the parent during construction (real C flow)', () => {
    const GObject = requireGi('GObject', '2.0');
    const order = [];
    let thisInConstructed = null;
    const Klass = GObject.registerClass(
        { GTypeName: 'NodeGiL1ChainConstructed' },
        class extends GObject.Object {
            vfunc_constructed() {
                order.push('child-before');
                thisInConstructed = this;
                this.markerField = 'set-before-super';
                super.vfunc_constructed();
                order.push('child-after');
            }
        },
    );

    const obj = new Klass();
    // The C constructor invoked our trampoline → the user method → super → the
    // parent → and resumed, all in order.
    assert.deepEqual(order, ['child-before', 'child-after']);
    // `this` inside the override is the same canonical wrapper `new` returned, and a
    // plain JS field set before chain-up survives (toggle-ref instance identity).
    assert.equal(thisInConstructed, obj);
    assert.equal(obj.markerField, 'set-before-super');
});

test('super.vfunc_name_lost() returns the parent vfunc return value', () => {
    const GObject = requireGi('GObject', '2.0');
    const Gio = requireGi('Gio', '2.0');
    let fromSuper;
    const Klass = GObject.registerClass(
        { GTypeName: 'NodeGiL1ChainNameLost' },
        class extends Gio.Application {
            vfunc_name_lost() {
                fromSuper = super.vfunc_name_lost();
                return fromSuper;
            }
        },
    );
    const app = new Klass({ 'application-id': 'eu.gjsify.L1ChainNameLost' });
    // Invoke the override directly (no app lifecycle needed): it chains up to the
    // C parent, whose default returns TRUE.
    const result = app.vfunc_name_lost();
    assert.equal(fromSuper, true);
    assert.equal(result, true);
});

test('a vfunc member off the prototype requires a node-gi instance as `this`', () => {
    const GObject = requireGi('GObject', '2.0');
    const Gio = requireGi('Gio', '2.0');
    // Reach the member off the base class prototype and call it unbound — it must
    // reject a non-instance receiver rather than dereference undefined. BOTH routes
    // are pinned, because a prototype's `vfunc_*` resolves to one of two things: the
    // DIRECT dispatch materialized for an addressable slot (`constructed`), and the
    // chain-up thunk for a slot girepository cannot address — `quit_mainloop` is
    // declared on GApplication and left NULL, so it still falls through.
    const direct = GObject.Object.prototype.vfunc_constructed;
    assert.equal(typeof direct, 'function');
    assert.throws(() => direct.call({}), /vfunc_constructed: `this` is not a node-gi instance/);

    const chainUp = Gio.Application.prototype.vfunc_quit_mainloop;
    assert.equal(typeof chainUp, 'function');
    assert.throws(() => chainUp.call({}), /chain-up requires a node-gi instance/);
});

// ---- can-throw vfunc: the parent's GError propagates (GError** indirection) ----
//
// GBufferedInputStream.fill is a can-throw vfunc; its C default reads from the
// base stream, so over a CLOSED base it sets G_IO_ERROR_CLOSED. Chaining up must
// pass the parent a VALID GError** (one level of indirection) so the error
// surfaces — passing the GError* by address would hand the parent a NULL GError**
// and silently swallow the error (no throw).

test('chain-up surfaces a can-throw parent vfunc GError (native)', () => {
    requireNamespace('Gio', '2.0');
    const base = callStaticMethod('Gio', 'MemoryInputStream', 'new', []);
    callMethod(base, 'close', [null]); // closing the base makes fill error
    const Type = registerClass('NodeGiChainFillThrow', 'Gio', 'BufferedInputStream', {
        vfuncs: {
            fill() {
                return -1;
            },
        },
    });
    const buf = constructType(Type, { 'base-stream': base });
    // The parent fill reads the closed base → G_IO_ERROR_CLOSED → propagated + thrown
    // (NOT swallowed, NOT returned). With the buggy &error indirection this would
    // return -1 with no throw.
    assert.throws(() => callParentVfunc(buf, 'fill', [-1, null]), /closed/i);
});

test('chain-up surfaces a can-throw parent vfunc as a real GLib.Error (L1 super)', () => {
    const GObject = requireGi('GObject', '2.0');
    const Gio = requireGi('Gio', '2.0');
    const GLib = requireGi('GLib', '2.0');
    const base = Gio.MemoryInputStream.new();
    base.close(null);
    const Klass = GObject.registerClass(
        { GTypeName: 'NodeGiL1ChainFillThrow' },
        class extends Gio.BufferedInputStream {
            vfunc_fill(count, cancellable) {
                return super.vfunc_fill(count, cancellable);
            }
        },
    );
    const b = new Klass({ 'base-stream': base });
    let thrown;
    try {
        b.vfunc_fill(-1, null);
    } catch (e) {
        thrown = e;
    }
    assert.ok(thrown, 'super.vfunc_fill must throw the parent GError');
    assert.ok(thrown instanceof GLib.Error, 'it is a real GLib.Error');
    assert.equal(thrown.domain, 'g-io-error-quark');
    assert.equal(thrown.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CLOSED), true);
});

// ---- OUT-arg vfunc chain-up: the parent fills an OUT param, it flows back ----
//
// `Gio.TlsPassword.get_value(out length) -> guint8[]` has a REAL C default that
// returns the stored value bytes and writes their count into the OUT `length`
// slot (which is the return array's length-index). Chaining up must: pass the
// parent a valid pointer for the OUT length slot, run the C default, read the
// length back, and marshal the returned byte array — surfacing it as a bare
// Uint8Array (the single-value tuple). Verified byte-identical to gjs 1.88:
//   subclass Gio.TlsPassword { vfunc_get_value() { return super.vfunc_get_value(); } }
//   set_value([104,105]); super.vfunc_get_value() === Uint8Array [104, 105]

test('chain-up reads an OUT parameter the C parent fills (native)', () => {
    requireNamespace('Gio', '2.0');
    const Type = registerClass('NodeGiChainOutValue', 'Gio', 'TlsPassword', {
        vfuncs: {
            get_value() {
                return new Uint8Array();
            },
        },
    });
    const pw = constructType(Type, { flags: 0, description: 'secret' });
    callMethod(pw, 'set_value', [new Uint8Array([104, 105])]); // "hi"
    // The parent get_value writes the byte count into the OUT length slot and returns
    // the value array; chain-up reads both back → a bare Uint8Array [104, 105].
    const out = callParentVfunc(pw, 'get_value', []);
    assert.ok(out instanceof Uint8Array, 'the OUT-carried byte array flows back as a Uint8Array');
    assert.deepEqual(Array.from(out), [104, 105]);
});

test('super.vfunc_get_value() returns the OUT-carried byte array (L1)', () => {
    const GObject = requireGi('GObject', '2.0');
    const Gio = requireGi('Gio', '2.0');
    let fromSuper;
    const Klass = GObject.registerClass(
        { GTypeName: 'NodeGiL1ChainOutValue' },
        class extends Gio.TlsPassword {
            vfunc_get_value() {
                fromSuper = super.vfunc_get_value();
                return fromSuper;
            }
        },
    );
    const pw = new Klass({ flags: 0, description: 'secret' });
    pw.set_value(new Uint8Array([1, 2, 3]));
    const result = pw.vfunc_get_value();
    assert.ok(fromSuper instanceof Uint8Array);
    assert.deepEqual(Array.from(fromSuper), [1, 2, 3]);
    assert.deepEqual(Array.from(result), [1, 2, 3]);
});

// ---- INOUT container chain-up (read-modify-write a caller-built container) ----
//
// GApplication.local_command_line has an INOUT `arguments` (a strv) + an OUT
// `exit_status` + a boolean return. Chaining up to the parent marshals the JS
// array IN as the strv, passes it INOUT, and reads the (possibly modified) strv +
// the OUT exit_status back. Verified against gjs 1.88: for a no-op command line,
// super.vfunc_local_command_line(['myapp']) → [true, ['myapp'], 0] (return, the
// round-tripped INOUT argv, the OUT exit_status). Was DEFERRED with a clean throw
// before INOUT containers landed; now it round-trips like gjs.

test('chain-up of a vfunc with an INOUT container round-trips (native)', () => {
    requireNamespace('Gio', '2.0');
    const Type = registerClass('NodeGiChainInoutGuard', 'Gio', 'Application', {
        vfuncs: {
            local_command_line() {
                return false;
            },
        },
    });
    const app = constructType(Type, { 'application-id': 'eu.gjsify.ChainInoutGuard' });
    assert.deepEqual(callParentVfunc(app, 'local_command_line', [['myapp']]), [true, ['myapp'], 0]);
});

test('chain-up of a vfunc with an INOUT container round-trips via L1 super', () => {
    const GObject = requireGi('GObject', '2.0');
    const Gio = requireGi('Gio', '2.0');
    let received;
    const Klass = GObject.registerClass(
        { GTypeName: 'NodeGiL1ChainInoutGuard' },
        class extends Gio.Application {
            vfunc_local_command_line(argv) {
                received = argv;
                return super.vfunc_local_command_line(argv);
            }
        },
    );
    const app = new Klass({ 'application-id': 'eu.gjsify.L1ChainInoutGuard' });
    assert.deepEqual(app.vfunc_local_command_line(['myapp']), [true, ['myapp'], 0]);
    assert.deepEqual(received, ['myapp']);
});
