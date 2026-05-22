---
title: GObject classes
description: registerClass() forms — static-block vs functional, init-order rules, $gtype declarations, and the rough edges to avoid.
---

`GObject.registerClass()` is how a JavaScript class gets registered with the GObject type system so GTK can introspect its properties, signals, vfuncs, and implemented interfaces. There are **three forms** that all work, but they differ in type safety, init order, and how clearly they survive maintenance. Pick whichever fits your codebase — but know the trade-offs before you mix them.

## TL;DR — pick this one

If you don't know what you want, write:

```ts
class MyButton extends Gtk.Button {
    pressedCount = 0;

    onPressed(): void {
        this.pressedCount += 1;
        print(`pressed ${this.pressedCount}× total`);
    }

    static {
        GObject.registerClass({
            GTypeName: 'MyButton',
            Properties: {
                'pressed-count': GObject.ParamSpec.int(
                    'pressed-count', null, null,
                    GObject.ParamFlags.READABLE, 0, Number.MAX_SAFE_INTEGER, 0,
                ),
            },
            Signals: {
                'pressed-with-count': { param_types: [GObject.TYPE_INT] },
            },
            Implements: [Gtk.Accessible],
        }, this);
    }
}
```

Two things make this form robust:

1. **`static { GObject.registerClass(...) }` is the *last* element in the class body.** Anything in the class — methods, instance fields, *other* static fields — has already been picked up by the time `registerClass` runs.
2. **All GObject metadata is passed inline** to `registerClass({…}, this)` instead of via `static [GObject.interfaces] = …` / `static [GObject.properties] = …`. This sidesteps the init-order trap entirely (see [Static-block ordering trap](#static-block-ordering-trap) below). Using `this` inside the static block (instead of the class name) avoids repeating the identifier and is GJS-idiomatic.

You may also see `static override $gtype: GObject.GType<MyClass>;` written next to the static block. That's only necessary when you actually use `MyClass.$gtype` somewhere that needs the narrowed `GType<MyClass>` — typically `GObject.type_is_a(x, MyClass)` to type-narrow `x` to `MyClass`. For the common case (passing `MyClass` to APIs that accept any GType), the inherited `GType<GObject.Object>` from the base class is fine — no override needed. See [`$gtype` narrowing](#gtype-is-typed-as-the-base-class) below for when the override is worth writing.

## The three forms

### Form A — static block, metadata inline (recommended)

```ts
class Foo extends GObject.Object {
    vfunc_init(): void { /* … */ }

    static {
        GObject.registerClass({
            GTypeName: 'Foo',
            Implements: [Gio.Initable],
            Properties: { … },
        }, this);
    }
}
```

Everything `registerClass` needs is in its own arguments. No static fields outside the block can fire too early. `static { … }` lives at the bottom so it runs last in source order. Inside the static block, `this` refers to the class itself — preferred over `Foo` because the body doesn't repeat the identifier and the snippet stays correct after a rename.

### Form B — static block, metadata in fields

```ts
class Foo extends GObject.Object {
    static [GObject.interfaces] = [Gio.Initable];        // ← must come BEFORE registerClass
    static [GObject.properties] = { … };

    vfunc_init(): void { /* … */ }

    static { GObject.registerClass(this); }              // ← still last
```

Works **only if** every `static [GObject.*] = …` initializer appears *above* the static block. ES class evaluation is strict source-order, so `static [GObject.interfaces] = …` must be assigned *before* `registerClass()` reads it. **Form A is preferable** because the rule isn't enforceable at the type level — a refactor that moves a static field around breaks Form B silently at runtime.

### Form C — functional (no static block)

```ts
const Foo = GObject.registerClass(
    {
        GTypeName: 'Foo',
        Implements: [Gio.Initable],
        Properties: { … },
    },
    class extends GObject.Object {
        vfunc_init(): void { /* … */ }
    },
);
```

Has the strongest inference path in our generated types — `Foo` is typed as `RegisteredClass<typeof InnerClass, Props, Implements>` and `Foo.$gtype` is correctly typed as `GObject.GType<RegisteredClass<…>>`, no `static override $gtype` needed. The downside: TypeScript loses the named class symbol — `class extends X { … }` is anonymous, so stack traces, debugger names, and `instanceof Foo` checks against subclasses get less helpful. Use this form when you don't need to subclass `Foo`.

A working example lives at [`examples/gobject-register-class-inference`](https://github.com/gjsify/ts-for-gir/tree/main/examples/gobject-register-class-inference).

## Rough edges

### Static-block ordering trap

The trap that drove [GNOME/gjs#704](https://gitlab.gnome.org/GNOME/gjs/-/work_items/704):

```ts
class Foo extends GObject.Object {
    static { GObject.registerClass(Foo); }              // ← runs FIRST (source order)
    static [GObject.interfaces] = [Gio.Initable];       // ← runs AFTER — too late
    vfunc_init(): void {}
}

new Foo().init(null);
// Gjs-CRITICAL: Could not find definition of virtual function init
```

`registerClass()` fires before `[GObject.interfaces]` is assigned, so the Initable vtable never gets attached. The vfunc lookup at `.init()` time fails.

**Rule of thumb:** `static { GObject.registerClass(...); }` is **always** the last element in the class body. Methods and instance-side declarations don't matter (they're on the prototype, not subject to static evaluation order). Static fields (`static [GObject.interfaces]`, `static [GObject.properties]`, anything else `registerClass` reads) must appear *above* the block — or, preferably, be passed inline to `registerClass({…}, Foo)` so the ordering question doesn't arise.

### `$gtype` is typed as the base class

Subclasses inherit `static $gtype: GObject.GType<GObject.Object>` from the base class — TS doesn't narrow static-side `this` to the subclass. **This is usually fine.** Most APIs that take a GType (e.g. `GObject.signal_lookup`, `Gio.ListStore`'s `item_type` constructor prop, anywhere you pass `Foo.$gtype`) accept any `GType<T>`, so the wider `GType<Object>` matches without complaint.

The override is only worth writing when you actually need the `T` in `GType<T>` to be the subclass — typically because you're calling `GObject.type_is_a(x, Foo)` and want `x is Foo` narrowing:

```ts
class Foo extends GObject.Object {
    static { GObject.registerClass({ GTypeName: 'Foo' }, this); }
}

GObject.type_is_a(x, Foo);
// ^ Foo.$gtype is inferred as GType<Object>, not GType<Foo>
//   so this narrows `x` to Object, not Foo
```

Fix only the consumer that needs the narrowing, by adding the override on the class:

```ts
class Foo extends GObject.Object {
    static override $gtype: GObject.GType<Foo>;        // ← narrows the static type
    static { GObject.registerClass({ GTypeName: 'Foo' }, this); }
}

GObject.type_is_a(x, Foo);
// ^ now `x is Foo` ✓
```

The `override` keyword tells TS *"yes, I know the base class declares this; I'm narrowing it intentionally"*. At runtime the property is still set by `registerClass` — the declaration is purely a type-system hint. **Don't add it speculatively** — most code never hits the case that needs it.

### Subclassing a registered class

`GObject.registerClass()` returns a constructor that's structurally identical to its argument, but TypeScript sometimes loses fidelity when you subclass. If you hit *"property X does not exist on Subclass"* errors, register the subclass too:

```ts
class Parent extends GObject.Object {
    parentMethod(): void { … }
    static { GObject.registerClass({ GTypeName: 'Parent' }, this); }
}

class Child extends Parent {
    childMethod(): void { … }
    static { GObject.registerClass({ GTypeName: 'Child' }, this); }
}
```

Each subclass goes through its own `static { GObject.registerClass(...) }` block. Add `static override $gtype: GObject.GType<Child>;` on the subclass only if `Child.$gtype` needs the narrowed type (same rule as for the base — most code doesn't).

## Quick checklist

When you write or review a class that goes through `GObject.registerClass()`:

- [ ] `static { GObject.registerClass(...) }` is the last element of the class body.
- [ ] Inside the static block, `registerClass({...}, this)` — `this` instead of the class name avoids the rename trap and is GJS-idiomatic.
- [ ] Either: metadata is passed *inline* to `registerClass({…}, this)` (Form A — preferred), or: every `static [GObject.*] = …` initializer comes *above* the block (Form B — fragile under refactor).
- [ ] `vfunc_*` overrides are normal instance methods (no `static`), declared anywhere in the class body.
- [ ] `static override $gtype: GObject.GType<ThisClass>` only when you actually need the narrowed type (e.g. `GObject.type_is_a(x, ThisClass)` to type-narrow). Most consumers accept any GType and don't need the override.

## References

- [GNOME/gjs work_items/704](https://gitlab.gnome.org/GNOME/gjs/-/work_items/704) — the upstream bug report behind the static-block ordering trap, plus discussion of an ESLint rule that would catch it.
- [`examples/gobject-register-class-inference`](https://github.com/gjsify/ts-for-gir/tree/main/examples/gobject-register-class-inference) — Form C in action with type-inference assertions.
- [`examples/gobject-param-spec`](https://github.com/gjsify/ts-for-gir/tree/main/examples/gobject-param-spec) — Form A with the full ParamSpec surface.
- [`examples/gobject-static-block-ordering`](https://github.com/gjsify/ts-for-gir/tree/main/examples/gobject-static-block-ordering) — side-by-side broken / fixed demo of the ordering trap, with a runtime assertion.
