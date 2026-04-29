// SPDX-License-Identifier: MIT
// New tests for @ts-for-gir/lib — upstream has no unit test suite for the type system.
// Covers the TypeExpression class hierarchy from gir.ts: pure value-objects with no
// filesystem access, no GIR pipeline, no template rendering.  Safe on any JS runtime
// that can import the module.

import { describe, it, expect } from '@gjsify/unit';
import {
  TypeIdentifier,
  ModuleTypeIdentifier,
  NativeType,
  OrType,
  TupleType,
  BinaryType,
  FunctionType,
  PromiseType,
  NullableType,
  ArrayType,
  ClosureType,
  GenericType,
  // Primitive type singleton constants
  VoidType,
  BooleanType,
  StringType,
  NumberType,
  AnyType,
  NullType,
  NeverType,
  UnknownType,
  ThisType,
  ObjectType,
  AnyFunctionType,
  Uint8ArrayType,
  BigintOrNumberType,
} from '@ts-for-gir/lib';

export default async () => {
  await describe('@ts-for-gir/lib — TypeIdentifier', async () => {
    await it('constructs with name and namespace', async () => {
      const t = new TypeIdentifier('Widget', 'Gtk');
      expect(t.name).toBe('Widget');
      expect(t.namespace).toBe('Gtk');
    });

    await it('equals() returns true for same name+namespace', async () => {
      const a = new TypeIdentifier('Widget', 'Gtk');
      const b = new TypeIdentifier('Widget', 'Gtk');
      expect(a.equals(b)).toBeTruthy();
    });

    await it('equals() returns false for different name', async () => {
      const a = new TypeIdentifier('Widget', 'Gtk');
      const b = new TypeIdentifier('Button', 'Gtk');
      expect(a.equals(b)).toBeFalsy();
    });

    await it('equals() returns false for different namespace', async () => {
      const a = new TypeIdentifier('Widget', 'Gtk');
      const b = new TypeIdentifier('Widget', 'GLib');
      expect(a.equals(b)).toBeFalsy();
    });

    await it('is() matches namespace+name pair', async () => {
      const t = new TypeIdentifier('Promise', 'Gio');
      expect(t.is('Gio', 'Promise')).toBeTruthy();
      expect(t.is('Gtk', 'Promise')).toBeFalsy();
      expect(t.is('Gio', 'AsyncResult')).toBeFalsy();
    });

    await it('unwrap() returns self', async () => {
      const t = new TypeIdentifier('Object', 'GObject');
      expect(t.unwrap()).toBe(t);
    });

    await it('rewrap() returns the supplied type', async () => {
      const t = new TypeIdentifier('Widget', 'Gtk');
      const other = new NativeType('string');
      expect(t.rewrap(other)).toBe(other);
    });
  });

  await describe('@ts-for-gir/lib — ModuleTypeIdentifier', async () => {
    // ModuleTypeIdentifier(name, moduleName, namespace) — three args
    await it('constructs with name, moduleName, and namespace', async () => {
      const m = new ModuleTypeIdentifier('ApplicationWindow', 'ApplicationWindow', 'Gtk');
      expect(m.name).toBe('ApplicationWindow');
      expect(m.moduleName).toBe('ApplicationWindow');
      expect(m.namespace).toBe('Gtk');
    });

    await it('equals another ModuleTypeIdentifier with same three fields', async () => {
      const a = new ModuleTypeIdentifier('ApplicationWindow', 'ApplicationWindow', 'Gtk');
      const b = new ModuleTypeIdentifier('ApplicationWindow', 'ApplicationWindow', 'Gtk');
      expect(a.equals(b)).toBeTruthy();
    });

    await it('is NOT equal to a plain TypeIdentifier (different class check)', async () => {
      const m = new ModuleTypeIdentifier('Object', 'Object', 'GObject');
      const plain = new TypeIdentifier('Object', 'GObject');
      expect(m.equals(plain)).toBeFalsy();
    });
  });

  await describe('@ts-for-gir/lib — NativeType', async () => {
    await it('constructs from a raw TS expression string', async () => {
      const t = new NativeType('Record<string, unknown>');
      expect(t.equals(new NativeType('Record<string, unknown>'))).toBeTruthy();
    });

    await it('equals() is case-sensitive', async () => {
      expect(new NativeType('string').equals(new NativeType('String'))).toBeFalsy();
    });

    await it('equals() returns false against TypeIdentifier', async () => {
      const n = new NativeType('string');
      const id = new TypeIdentifier('string', '');
      expect(n.equals(id)).toBeFalsy();
    });
  });

  await describe('@ts-for-gir/lib — primitive type constants', async () => {
    await it('VoidType is a NativeType("void")', async () => {
      expect(VoidType instanceof NativeType).toBeTruthy();
      expect(VoidType.equals(new NativeType('void'))).toBeTruthy();
    });

    await it('BooleanType equals new NativeType("boolean")', async () => {
      expect(BooleanType.equals(new NativeType('boolean'))).toBeTruthy();
    });

    await it('StringType equals new NativeType("string")', async () => {
      expect(StringType.equals(new NativeType('string'))).toBeTruthy();
    });

    await it('NumberType equals new NativeType("number")', async () => {
      expect(NumberType.equals(new NativeType('number'))).toBeTruthy();
    });

    await it('AnyType equals new NativeType("any")', async () => {
      expect(AnyType.equals(new NativeType('any'))).toBeTruthy();
    });

    await it('NullType equals new NativeType("null")', async () => {
      expect(NullType.equals(new NativeType('null'))).toBeTruthy();
    });

    await it('NeverType equals new NativeType("never")', async () => {
      expect(NeverType.equals(new NativeType('never'))).toBeTruthy();
    });

    await it('UnknownType equals new NativeType("unknown")', async () => {
      expect(UnknownType.equals(new NativeType('unknown'))).toBeTruthy();
    });

    await it('ThisType equals new NativeType("this")', async () => {
      expect(ThisType.equals(new NativeType('this'))).toBeTruthy();
    });

    await it('ObjectType equals new NativeType("object")', async () => {
      expect(ObjectType.equals(new NativeType('object'))).toBeTruthy();
    });

    await it('Uint8ArrayType equals new NativeType("Uint8Array")', async () => {
      expect(Uint8ArrayType.equals(new NativeType('Uint8Array'))).toBeTruthy();
    });

    await it('AnyFunctionType is a NativeType', async () => {
      expect(AnyFunctionType instanceof NativeType).toBeTruthy();
    });

    await it('BigintOrNumberType is a BinaryType', async () => {
      expect(BigintOrNumberType instanceof BinaryType).toBeTruthy();
    });

    await it('primitive constants are distinct from one another', async () => {
      expect(VoidType.equals(BooleanType)).toBeFalsy();
      expect(StringType.equals(NumberType)).toBeFalsy();
      expect(NullType.equals(UnknownType)).toBeFalsy();
    });
  });

  await describe('@ts-for-gir/lib — OrType / BinaryType', async () => {
    await it('BinaryType wraps two types', async () => {
      const a = new TypeIdentifier('Widget', 'Gtk');
      const b = new NativeType('null');
      const or = new BinaryType(a, b);
      expect(or instanceof OrType).toBeTruthy();
      expect(or instanceof BinaryType).toBeTruthy();
    });

    await it('BinaryType equals another with same constituents', async () => {
      const a1 = new BinaryType(new NativeType('string'), new NativeType('null'));
      const a2 = new BinaryType(new NativeType('string'), new NativeType('null'));
      expect(a1.equals(a2)).toBeTruthy();
    });

    // OrType.equals() is SET-based: every member of this must appear somewhere in other.
    // So BinaryType(a, b).equals(BinaryType(b, a)) is TRUE — order is irrelevant.
    await it('BinaryType equality is order-independent (set semantics)', async () => {
      const a = new BinaryType(StringType, NullType);
      const b = new BinaryType(NullType, StringType);
      expect(a.equals(b)).toBeTruthy();
    });

    await it('BinaryType does not equal BinaryType with different members', async () => {
      const a = new BinaryType(StringType, NullType);
      const b = new BinaryType(StringType, NumberType);
      expect(a.equals(b)).toBeFalsy();
    });
  });

  await describe('@ts-for-gir/lib — TupleType', async () => {
    await it('TupleType extends OrType', async () => {
      const t = new TupleType(StringType, NumberType);
      expect(t instanceof OrType).toBeTruthy();
      expect(t instanceof TupleType).toBeTruthy();
    });

    await it('TupleType equals another with same member types in same order', async () => {
      const a = new TupleType(StringType, BooleanType, NumberType);
      const b = new TupleType(StringType, BooleanType, NumberType);
      expect(a.equals(b)).toBeTruthy();
    });

    await it('TupleType does not equal TupleType with fewer members', async () => {
      const a = new TupleType(StringType, NumberType);
      const b = new TupleType(StringType);
      expect(a.equals(b)).toBeFalsy();
    });

    // TupleType.equals() is positional — order IS significant
    await it('TupleType equality is order-sensitive', async () => {
      const a = new TupleType(StringType, NumberType);
      const b = new TupleType(NumberType, StringType);
      expect(a.equals(b)).toBeFalsy();
    });
  });

  await describe('@ts-for-gir/lib — NullableType', async () => {
    await it('NullableType is a BinaryType(T | null)', async () => {
      const inner = new TypeIdentifier('Widget', 'Gtk');
      const n = new NullableType(inner);
      expect(n instanceof BinaryType).toBeTruthy();
      // NullableType(Widget) === BinaryType(Widget, null)
      const manual = new BinaryType(inner, NullType);
      expect(n.equals(manual)).toBeTruthy();
    });
  });

  await describe('@ts-for-gir/lib — PromiseType', async () => {
    await it('wraps a TypeIdentifier', async () => {
      const inner = new TypeIdentifier('AsyncResult', 'Gio');
      const p = new PromiseType(inner);
      expect(p instanceof PromiseType).toBeTruthy();
    });

    await it('inner type is accessible via .type property', async () => {
      const inner = new NativeType('boolean');
      const p = new PromiseType(inner);
      expect(p.type.equals(inner)).toBeTruthy();
    });

    await it('equals another PromiseType with same inner type', async () => {
      const a = new PromiseType(StringType);
      const b = new PromiseType(StringType);
      expect(a.equals(b)).toBeTruthy();
    });

    await it('does not equal PromiseType with different inner', async () => {
      const a = new PromiseType(StringType);
      const b = new PromiseType(NumberType);
      expect(a.equals(b)).toBeFalsy();
    });

    // PromiseType.unwrap() returns self — deepUnwrap/rewrap is used for traversal
    await it('unwrap() returns self (not the inner type)', async () => {
      const p = new PromiseType(StringType);
      expect(p.unwrap()).toBe(p);
    });
  });

  await describe('@ts-for-gir/lib — ArrayType', async () => {
    await it('wraps an element type', async () => {
      const el = new TypeIdentifier('Widget', 'Gtk');
      const arr = new ArrayType(el);
      expect(arr instanceof ArrayType).toBeTruthy();
    });

    await it('equals another ArrayType with same element type', async () => {
      const a = new ArrayType(StringType);
      const b = new ArrayType(StringType);
      expect(a.equals(b)).toBeTruthy();
    });

    await it('does not equal ArrayType with different element type', async () => {
      const a = new ArrayType(StringType);
      const b = new ArrayType(NumberType);
      expect(a.equals(b)).toBeFalsy();
    });
  });

  await describe('@ts-for-gir/lib — ClosureType', async () => {
    await it('wraps an inner type', async () => {
      const inner = new TypeIdentifier('AsyncReadyCallback', 'Gio');
      const c = new ClosureType(inner);
      expect(c instanceof ClosureType).toBeTruthy();
    });

    await it('inner type is accessible via .type property', async () => {
      const inner = new TypeIdentifier('Callback', 'GLib');
      const c = new ClosureType(inner);
      expect(c.type.equals(inner)).toBeTruthy();
    });

    await it('deepUnwrap() returns the inner type', async () => {
      const inner = new TypeIdentifier('Callback', 'GLib');
      const c = new ClosureType(inner);
      expect(c.deepUnwrap().equals(inner)).toBeTruthy();
    });

    await it('equals another ClosureType with same inner', async () => {
      const a = new ClosureType(new TypeIdentifier('AsyncReadyCallback', 'Gio'));
      const b = new ClosureType(new TypeIdentifier('AsyncReadyCallback', 'Gio'));
      expect(a.equals(b)).toBeTruthy();
    });

    // ClosureType.unwrap() returns self (same as PromiseType)
    await it('unwrap() returns self (not the inner type)', async () => {
      const c = new ClosureType(StringType);
      expect(c.unwrap()).toBe(c);
    });
  });

  await describe('@ts-for-gir/lib — FunctionType', async () => {
    // FunctionType takes a plain object { [name: string]: TypeExpression }, not a Map
    await it('constructs from a plain-object parameter map and return type', async () => {
      const params: { [name: string]: TypeIdentifier } = {
        name: new TypeIdentifier('utf8', ''),
        count: new TypeIdentifier('gint', ''),
      };
      const ft = new FunctionType(params, StringType);
      expect(ft instanceof FunctionType).toBeTruthy();
    });

    await it('equals another FunctionType with same params and return', async () => {
      const params = { x: new NativeType('number') };
      const a = new FunctionType(params, NumberType);
      const b = new FunctionType({ x: new NativeType('number') }, NumberType);
      expect(a.equals(b)).toBeTruthy();
    });

    await it('does not equal FunctionType with different return type', async () => {
      const params = {};
      const a = new FunctionType(params, StringType);
      const b = new FunctionType(params, NumberType);
      expect(a.equals(b)).toBeFalsy();
    });
  });

  await describe('@ts-for-gir/lib — GenericType', async () => {
    await it('constructs with an identifier string', async () => {
      const g = new GenericType('T');
      expect(g instanceof GenericType).toBeTruthy();
    });

    await it('equals another GenericType with same identifier', async () => {
      const a = new GenericType('T');
      const b = new GenericType('T');
      expect(a.equals(b)).toBeTruthy();
    });

    await it('does not equal GenericType with different identifier', async () => {
      const a = new GenericType('T');
      const b = new GenericType('U');
      expect(a.equals(b)).toBeFalsy();
    });
  });
};
