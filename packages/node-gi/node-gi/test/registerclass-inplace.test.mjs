// SPDX-License-Identifier: MIT
// G3 — GObject.registerClass mutate-in-place + `new.target` construction routing.
//
// `GObject.registerClass(meta, X)` registers the GType for the GIVEN class and
// returns that SAME class (GJS-faithful — refs/gjs/modules/core/overrides/
// GObject.js mutates `klass` and returns it). So the GJS idiom
// `static { GObject.registerClass({…}, X) }` (return discarded) leaves `X` itself
// bound to the registered GType, and `new X(args)`:
//   - constructs the REGISTERED GType (routed via the introspected base ctor on
//     `new.target`), not a plain instance of the introspected base,
//   - RUNS the user JS constructor body against the canonical toggle-ref wrapper
//     (this REVERSES the old "ctor body is not run" caveat),
//   - chains construct props through `super(args)`,
//   - keeps ONE canonical wrapper identity (=== across the ctor `this`, the
//     constructed instance, and a vfunc `this`).
// A 2-level JS hierarchy where BOTH levels are registered is still rejected (G2).
//
// GTypes are process-global + permanent, so every test registers a uniquely-named
// type. Reference: refs/gjs/modules/core/overrides/GObject.js (registerClass
// mutates + returns klass; the `static { registerClass(...) }` idiom).
import test from 'node:test';
import assert from 'node:assert/strict';

import { requireGi, unwrap } from '../gi.js';
import native from '../index.js';

const GObject = requireGi('GObject', '2.0');
const Gio = requireGi('Gio', '2.0');
const RW = GObject.ParamFlags.READWRITE;

test('static{} registerClass(meta, X) makes X itself the registered GType', () => {
  class InPlaceStatic extends GObject.Object {
    static {
      // The return is DISCARDED — the GJS static-block idiom. X must still BE the
      // registered GType.
      GObject.registerClass(
        {
          GTypeName: 'NodeGiInPlaceStatic',
          Properties: {
            label: GObject.ParamSpec.string('label', 'Label', 'a label', RW, 'def'),
          },
          Signals: { pinged: { param_types: ['int'] } },
        },
        InPlaceStatic,
      );
    }
    greet() {
      return 'hi ' + this.label;
    }
  }

  // X itself carries the registered GType identity (return discarded).
  assert.equal(InPlaceStatic.$gtypeName, 'NodeGiInPlaceStatic');
  assert.equal(GObject.type_name(InPlaceStatic.$gtype), 'NodeGiInPlaceStatic');

  // `new X(props)` constructs the REGISTERED type (not a plain GObject.Object).
  const obj = new InPlaceStatic({ label: 'world' });
  assert.equal(native.getTypeName(unwrap(obj)), 'NodeGiInPlaceStatic');

  // Custom property + user prototype method.
  assert.equal(obj.label, 'world');
  assert.equal(obj.greet(), 'hi world');
  obj.label = 'changed';
  assert.equal(obj.greet(), 'hi changed');

  // The declared signal connects + emits on the registered type.
  let received = null;
  const id = obj.connect('pinged', (n) => {
    received = n;
  });
  obj.emit('pinged', 7);
  assert.equal(received, 7);
  obj.disconnect(id);
  obj.emit('pinged', 99);
  assert.equal(received, 7, 'a disconnected handler does not fire again');
});

test('registerClass returns the SAME class (mutate-in-place)', () => {
  class InPlaceReturn extends GObject.Object {}
  const ret = GObject.registerClass({ GTypeName: 'NodeGiInPlaceReturn' }, InPlaceReturn);
  // GJS-faithful: the returned constructor IS the class passed in.
  assert.equal(ret === InPlaceReturn, true);
  // The const-assignment form still constructs the registered type.
  const obj = new ret();
  assert.equal(native.getTypeName(unwrap(obj)), 'NodeGiInPlaceReturn');
});

test('the JS constructor body RUNS against the canonical wrapper', () => {
  let thisInCtor = null;
  class InPlaceCtor extends GObject.Object {
    static {
      GObject.registerClass({ GTypeName: 'NodeGiInPlaceCtor' }, InPlaceCtor);
    }
    constructor() {
      super();
      this.tag = 'ran'; // a plain JS expando written in the ctor body
      thisInCtor = this;
    }
  }
  const obj = new InPlaceCtor();
  // The ctor body executed (reversing the old "ctor body not run" caveat) and its
  // expando survives on the canonical wrapper.
  assert.equal(obj.tag, 'ran');
  // `this` inside the ctor IS the constructed instance.
  assert.equal(thisInCtor === obj, true);
});

test('super(args) chaining applies construct props passed to the base', () => {
  class InPlaceSuper extends GObject.Object {
    static {
      GObject.registerClass(
        {
          GTypeName: 'NodeGiInPlaceSuper',
          Properties: {
            title: GObject.ParamSpec.string('title', 'Title', 't', RW, 'untitled'),
          },
        },
        InPlaceSuper,
      );
    }
    constructor(title) {
      // A subclass ctor passing args UP to the introspected base via super(): the
      // base ctor must apply the construct prop, then return the wrapper.
      super(title === undefined ? {} : { title });
    }
  }
  const obj = new InPlaceSuper('chained');
  assert.equal(obj.title, 'chained', 'the prop passed through super({...}) was applied');
  // A super({}) with no title still falls back to the declared default.
  const def = new InPlaceSuper(undefined);
  assert.equal(def.title, 'untitled');
});

test('toggle-ref identity: ctor `this`, vfunc `this`, and the instance are all ===', () => {
  let thisInCtor = null;
  let thisInVfunc = null;
  class InPlaceIdentity extends GObject.Object {
    static {
      GObject.registerClass({ GTypeName: 'NodeGiInPlaceIdentity' }, InPlaceIdentity);
    }
    constructor() {
      super();
      this.marker = 'M';
      thisInCtor = this;
    }
    self() {
      return this;
    }
    vfunc_constructed() {
      // Fires DURING construction; `this` must be the same canonical wrapper.
      thisInVfunc = this;
    }
  }
  const obj = new InPlaceIdentity();
  // The ctor `this`, the constructed instance, a method returning `this`, and the
  // vfunc `this` are ALL the one canonical toggle-ref wrapper (===).
  assert.equal(thisInCtor === obj, true, 'ctor `this` === the instance');
  assert.equal(obj.self() === obj, true, 'a method returning `this` === the instance');
  assert.equal(thisInVfunc === obj, true, 'vfunc `this` === the instance');
  assert.equal(obj.marker, 'M');
});

test('a 2-level registered hierarchy is still rejected (G2 guard)', () => {
  class InPlaceMultiBase extends GObject.Object {
    static {
      GObject.registerClass({ GTypeName: 'NodeGiInPlaceMultiBase' }, InPlaceMultiBase);
    }
  }
  // The base registered fine (single-level over an introspected parent).
  assert.equal(GObject.type_name(InPlaceMultiBase.$gtype), 'NodeGiInPlaceMultiBase');

  // Registering a subclass of a REGISTERED class is G2 — the static block runs at
  // class-definition time and must throw the clear multi-level guard error.
  assert.throws(() => {
    class InPlaceMultiChild extends InPlaceMultiBase {
      static {
        GObject.registerClass({ GTypeName: 'NodeGiInPlaceMultiChild' }, InPlaceMultiChild);
      }
    }
    return InPlaceMultiChild;
  }, /multi-level registerClass subclassing is not yet supported/);
});

test('#667: a raw (unregistered) subclass does not inherit the parent GType', () => {
  // An introspected class resolves its real $gtype on a direct read.
  assert.notEqual(Gio.SimpleAction.$gtype, undefined);
  // A raw subclass that NEVER called registerClass is not a GType — an inherited
  // read must NOT leak the parent's GType.
  class RawUnregistered extends Gio.SimpleAction {}
  assert.equal(RawUnregistered.$gtype, undefined);
  // A registered subclass DOES carry its own $gtype.
  const Registered = GObject.registerClass(class NodeGiInPlace667 extends Gio.SimpleAction {});
  assert.notEqual(Registered.$gtype, undefined);
  assert.equal(GObject.type_name(Registered.$gtype), 'NodeGiInPlace667');
});
