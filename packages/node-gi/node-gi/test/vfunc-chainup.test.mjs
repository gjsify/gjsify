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

test('the chain-up thunk requires a node-gi instance as `this`', () => {
  const GObject = requireGi('GObject', '2.0');
  // Reach the thunk off the base class prototype chain and call it unbound — it
  // must reject a non-instance receiver rather than dereference undefined.
  const baseProto = GObject.Object.prototype;
  const thunk = baseProto.vfunc_constructed;
  assert.equal(typeof thunk, 'function');
  assert.throws(() => thunk.call({}), /chain-up requires a node-gi instance/);
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

// ---- OUT/INOUT vfunc chain-up is REJECTED (not a crash) ----
//
// GApplication.local_command_line has an INOUT `arguments` + an OUT `exit_status`.
// Marshalling those for chain-up is unsupported; a non-optional OUT slot is a
// pointer the C parent writes THROUGH, so passing null would SIGSEGV the process.
// The guard must turn that into a clear, CATCHABLE throw.

test('chain-up of a vfunc with OUT/INOUT args throws, does not crash (native)', () => {
  requireNamespace('Gio', '2.0');
  const Type = registerClass('NodeGiChainOutGuard', 'Gio', 'Application', {
    vfuncs: {
      local_command_line() {
        return false;
      },
    },
  });
  const app = constructType(Type, { 'application-id': 'eu.gjsify.ChainOutGuard' });
  assert.throws(
    () => callParentVfunc(app, 'local_command_line', []),
    /OUT\/INOUT args is not yet supported/,
  );
});

test('chain-up of a vfunc with OUT/INOUT args throws via L1 super', () => {
  const GObject = requireGi('GObject', '2.0');
  const Gio = requireGi('Gio', '2.0');
  const Klass = GObject.registerClass(
    { GTypeName: 'NodeGiL1ChainOutGuard' },
    class extends Gio.Application {
      vfunc_local_command_line() {
        return super.vfunc_local_command_line();
      }
    },
  );
  const app = new Klass({ 'application-id': 'eu.gjsify.L1ChainOutGuard' });
  assert.throws(() => app.vfunc_local_command_line(), /OUT\/INOUT args is not yet supported/);
});
