// SPDX-License-Identifier: MIT
// @gjsify/node-gi — a CONSTRUCT GObject property whose class also defines a matching
// JS getter/setter reaches the JS backing field at construction.
//
// The bug this guards against (the Learn6502 Display "DrawingArea is required" wall,
// surfaced once C-instantiated ctors ran): a class declares a GObject property
// (`Properties: { value: ParamSpec.int(..., READWRITE|CONSTRUCT, default) }`) AND a
// matching JS accessor (`get/set value` over a `_value` backing field). On GJS the
// property set vfunc delegates to the JS setter, so the CONSTRUCT default reaches
// `_value` during construction. node-gi builds the wrapper AFTER g_object_new, so the
// CONSTRUCT value landed only in the engine's per-instance store while the class's
// `get value()` read an unset `_value` → undefined. The construct-property flush
// (gi.js flushConstructProperties) routes the construct value through the JS setter
// once the user prototype is attached.
//
// Headless (pure GObject, no widget/display), so it runs on every `npm test` leg.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireGi } from '../gi.js';

const GObject = requireGi('GObject', '2.0');

const DEFAULT_VALUE = 42;

// A property WITH a JS accessor (the split-brain shape) + a plain property WITHOUT
// one (must stay store-backed, i.e. unchanged).
const Widget = GObject.registerClass(
  {
    GTypeName: 'NodeGiConstructAccessor',
    Properties: {
      value: GObject.ParamSpec.int(
        'value',
        'Value',
        'A CONSTRUCT int with a JS getter/setter over a backing field',
        GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT,
        0,
        1000,
        DEFAULT_VALUE,
      ),
      // No JS accessor for this one — it must keep using the engine store.
      plain: GObject.ParamSpec.int(
        'plain',
        'Plain',
        'A CONSTRUCT int with NO JS accessor',
        GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT,
        0,
        1000,
        7,
      ),
      // A NON-CONSTRUCT property WITH a JS setter that has a side effect touching
      // ctor-body-initialised state. The flush must NOT run this at construction —
      // GObject never applies a plain READWRITE property at construct, and running
      // the setter early crashes against uninitialised state (the Learn6502
      // SourceView `selectable` → `_signalHandlers.forEach` regression).
      touchy: GObject.ParamSpec.boolean(
        'touchy',
        'Touchy',
        'A READWRITE (non-CONSTRUCT) bool whose setter must not fire at construct',
        GObject.ParamFlags.READWRITE,
        false,
      ),
    },
  },
  class Widget extends GObject.Object {
    // Backing field with NO runtime initializer — populated only via the setter.
    // (declare in TS; a bare field here.)
    get value() {
      return this._value;
    }
    set value(v) {
      this._value = v;
    }
    get touchy() {
      return this._touchy;
    }
    set touchy(v) {
      // Side effect that only works once the ctor body has initialised _log; if the
      // flush ran this during construction (before the ctor body), _log is undefined
      // and this throws — exactly the SourceView `selectable` shape.
      this._log.push(v);
      this._touchy = v;
    }
    constructor(params) {
      super(params);
      // Runs AFTER the base ctor (where the flush lives) — proves ordering.
      if (this._log === undefined) this._log = [];
    }
  },
);

test('a CONSTRUCT property default reaches the class JS backing field', () => {
  const w = new Widget();
  // The core assertion: the CONSTRUCT default flowed through `set value` → `_value`,
  // so the class getter sees it (was `undefined` before the flush).
  assert.equal(w.value, DEFAULT_VALUE, 'get value() returns the CONSTRUCT default');
  assert.equal(w._value, DEFAULT_VALUE, 'the _value backing field is populated');
});

test('an explicitly-passed construct value reaches the JS backing field', () => {
  const w = new Widget({ value: 123 });
  assert.equal(w.value, 123, 'the passed construct value flowed through the JS setter');
  assert.equal(w._value, 123, 'the _value backing field carries the passed value');
});

test('a plain CONSTRUCT property (no JS accessor) still works via the store', () => {
  const w = new Widget();
  // Unchanged store-backed path — the flush skips it (no prototype setter).
  assert.equal(w.plain, 7, 'plain property returns its CONSTRUCT default from the store');
  const w2 = new Widget({ plain: 99 });
  assert.equal(w2.plain, 99, 'plain property carries the passed construct value');
});

test('setting the accessor property after construction round-trips', () => {
  const w = new Widget();
  w.value = 500; // JS setter → _value
  assert.equal(w.value, 500, 'post-construction set/get round-trips through the accessor');
});

test('a NON-CONSTRUCT property with a JS setter is NOT flushed at construction', () => {
  // If the flush ran `set touchy` during construction, the setter would throw on the
  // undefined `_log` (uninitialised until the ctor body). Construction must succeed
  // and the setter must not have fired.
  const w = new Widget();
  assert.deepEqual(w._log, [], 'the touchy setter did NOT run during construction');
  // And it still works normally after construction.
  w.touchy = true;
  assert.equal(w.touchy, true, 'the non-construct accessor works post-construction');
  assert.deepEqual(w._log, [true], 'the setter ran exactly once, post-construction');
});
