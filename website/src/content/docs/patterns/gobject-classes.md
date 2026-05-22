---
title: GObject classes
description: registerClass() forms — static-block vs functional, init-order rules, $gtype declarations, and the rough edges to avoid.
---

`GObject.registerClass()` is how a JavaScript class gets registered with the GObject type system so GTK can introspect its properties, signals, vfuncs, and implemented interfaces. There are **three forms** that all work, but they differ in type safety, init order, and how clearly they survive maintenance. Pick whichever fits your codebase — but know the trade-offs before you mix them.

## TL;DR — pick this one

If you don't know what you want, write:

```ts
class MyButton extends Gtk.Button {
    static override $gtype: GObject.GType<MyButton>;

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
        }, MyButton);
    }
}
```

Two things make this form robust:

1. **`static { GObject.registerClass(...) }` is the *last* element in the class body.** Anything in the class — methods, instance fields, *other* static fields — has already been picked up by the time `registerClass` runs.
2. **All GObject metadata is passed inline** to `registerClass({…}, MyButton)` instead of via `static [GObject.interfaces] = …` / `static [GObject.properties] = …`. This sidesteps the init-order trap entirely (see [Static-block ordering trap](#static-block-ordering-trap) below).

The `static override $gtype: GObject.GType<MyButton>` declaration is the **type-safety fix** ptomato flagged in the [matrix discussion](#references): without it, `MyButton.$gtype` is typed as `GObject.GType<Object>` (TS static inheritance is invariant), so any code that does `GObject.type_is_a(x, MyButton)` or passes `MyButton` to APIs expecting `GType<MyButton>` gets the wrong narrowed type. The `override` keyword satisfies TS without changing runtime behaviour — GJS sets the property on the constructor as part of `registerClass`.

## The three forms

### Form A — static block, metadata inline (recommended)

```ts
class Foo extends GObject.Object {
    static override $gtype: GObject.GType<Foo>;

    vfunc_init(): void { /* … */ }

    static {
        GObject.registerClass({
            GTypeName: 'Foo',
            Implements: [Gio.Initable],
            Properties: { … },
        }, Foo);
    }
}
```

Everything `registerClass` needs is in its own arguments. No static fields outside the block can fire too early. `static { … }` lives at the bottom so it runs last in source order.

### Form B — static block, metadata in fields

```ts
class Foo extends GObject.Object {
    static override $gtype: GObject.GType<Foo>;
    static [GObject.interfaces] = [Gio.Initable];        // ← must come BEFORE registerClass
    static [GObject.properties] = { … };

    vfunc_init(): void { /* … */ }

    static { GObject.registerClass(Foo); }               // ← still last
}
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

Even with our generated types in `@girs/gobject-2.0`, subclasses inherit `static $gtype: GType<GObject.Object>` — TS doesn't narrow static-side `this` to the subclass. Code like this fails type-check:

```ts
class Foo extends GObject.Object {
    static { GObject.registerClass({ GTypeName: 'Foo' }, Foo); }
}

GObject.type_is_a(x, Foo);
// ^ Foo is inferred as { $gtype: GType<Object> }, not GType<Foo>
//   so this returns `x is Object`, not `x is Foo`
```

Fix with the `static override` declaration shown in [TL;DR](#tldr--pick-this-one):

```ts
class Foo extends GObject.Object {
    static override $gtype: GObject.GType<Foo>;        // ← narrows the static type
    static { GObject.registerClass({ GTypeName: 'Foo' }, Foo); }
}
```

The `override` keyword tells TS *"yes, I know the base class declares this; I'm narrowing it intentionally"*. At runtime the property is still set by `registerClass` — the declaration is purely a type-system hint.

### Subclassing a registered class

`GObject.registerClass()` returns a constructor that's structurally identical to its argument, but TypeScript sometimes loses fidelity when you subclass. If you hit *"property X does not exist on Subclass"* errors, register the subclass too:

```ts
class Parent extends GObject.Object {
    static override $gtype: GObject.GType<Parent>;
    parentMethod(): void { … }
    static { GObject.registerClass({ GTypeName: 'Parent' }, Parent); }
}

class Child extends Parent {
    static override $gtype: GObject.GType<Child>;        // ← re-narrow for Child
    childMethod(): void { … }
    static { GObject.registerClass({ GTypeName: 'Child' }, Child); }
}
```

Each subclass needs its own `static override $gtype` to keep `Child.$gtype` correctly typed.

## Quick checklist

When you write or review a class that goes through `GObject.registerClass()`:

- [ ] `static override $gtype: GObject.GType<ThisClass>` declared (Form A / B only — Form C inherits the right type automatically).
- [ ] `static { GObject.registerClass(...) }` is the last element of the class body.
- [ ] Either: metadata is passed *inline* to `registerClass({…}, Class)` (Form A — preferred), or: every `static [GObject.*] = …` initializer comes *above* the block (Form B — fragile under refactor).
- [ ] `vfunc_*` overrides are normal instance methods (no `static`), declared anywhere in the class body.
- [ ] No `this`-typed `static` recommended — TS has no `typeof this` for statics; the explicit `override` per subclass is the cleanest workaround.

## References

- [GNOME/gjs work_items/704](https://gitlab.gnome.org/GNOME/gjs/-/work_items/704) — the upstream bug report behind the static-block ordering trap, plus discussion of an ESLint rule that would catch it.
- [`examples/gobject-register-class-inference`](https://github.com/gjsify/ts-for-gir/tree/main/examples/gobject-register-class-inference) — Form C in action with type-inference assertions.
- [`examples/gobject-param-spec`](https://github.com/gjsify/ts-for-gir/tree/main/examples/gobject-param-spec) — Form A with the full ParamSpec surface.
- [`examples/gobject-static-block-ordering`](https://github.com/gjsify/ts-for-gir/tree/main/examples/gobject-static-block-ordering) — side-by-side broken / fixed demo of the ordering trap, with a runtime assertion.
