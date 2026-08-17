---
title: GObject Classes
description: How to register a TypeScript class with the GObject type system - properties, signals, interfaces, the static-block ordering rule, and when $gtype needs a type annotation.
---

`GObject.registerClass()` puts your JavaScript class into the GObject type system, so GTK
can see its properties, signals, vfuncs and interfaces. You need it for every widget
subclass you write.

It belongs to the GObject layer rather than to one runtime, so everything on this page
holds for an `--app gjs` build and an `--app node` one alike:
[`@gjsify/node-gi`](/gjsify/projects/node-gi/) carries `registerClass`, the dual
snake_case/camelCase accessors and `Gio._promisify` across for Node, Bun and Deno.

The samples below print with `print()`, one of the GJS ambient globals. A `--app node`
build injects a shim for those when your bundled output still reaches for one, and
`console.log()` needs no shim anywhere.

## Write it like this

If you don't have a reason to do otherwise, use a static block at the **bottom** of the
class body and pass all metadata inline:

```ts
class MyButton extends Gtk.Button {
    pressedCount = 0;

    onPressed(): void {
        this.pressedCount += 1;
        print(`pressed ${this.pressedCount} times`);
    }

    static {
        GObject.registerClass({
            GTypeName: 'MyButton',
            Properties: {
                'pressed-count': GObject.ParamSpec.int(
                    'pressed-count', null, null,
                    GObject.ParamFlags.READABLE, 0, GLib.MAXINT32, 0,
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

Two habits make this hold up:

1. **Put the static block last.** Everything above it (methods, instance fields, other
   static fields) is already in place when `registerClass` runs. See
   [Put the static block last](#put-the-static-block-last) for what happens otherwise.
2. **Pass the metadata inline** to `registerClass({…}, this)` rather than through
   `static [GObject.properties] = …` fields. Then there is no ordering question at all.

Inside the static block, `this` is the class. Prefer it over spelling the class name again:
the code stays correct after a rename.

## Add a property

Properties are GObject `ParamSpec`s, keyed by their kebab-case GObject name. Read and write
them from JS with the camelCase or snake_case accessor the GObject layer generates for
them. Both spellings exist on `gjs` and under node-gi, so pick one and stay with it.

```ts
class Counter extends GObject.Object {
    static {
        GObject.registerClass({
            GTypeName: 'ExampleCounter',
            Properties: {
                count: GObject.ParamSpec.int(
                    'count', null, null,
                    GObject.ParamFlags.READWRITE, 0, GLib.MAXINT32, 0,
                ),
                label: GObject.ParamSpec.string(
                    'label', null, null,
                    GObject.ParamFlags.READWRITE, 'counter',
                ),
            },
        }, this);
    }
}

const c = new Counter();
c.count = 5;
c.label = 'hello';
c.connect('notify::count', () => print(`count is now ${c.count}`));
```

Keep the bounds inside the C type. `ParamSpec.int` is a `gint`, so its maximum is
`GLib.MAXINT32`; hand it `Number.MAX_SAFE_INTEGER` and the value wraps, the
`default_value <= maximum` assertion fails, and you get `null` back with nothing but a
`GLib-GObject-CRITICAL` on stderr to say why. The same holds for `uint`, `int64` and
friends.

The full `ParamSpec` surface (`boolean`, `double`, `enum`, `object`, `boxed`, `flags`, …)
is exercised in
[`examples/gobject-param-spec`](https://github.com/gjsify/ts-for-gir/tree/main/examples/gobject-param-spec).

## Add a signal

`Signals` takes a map of signal name to its declaration. `param_types` lists the argument
GTypes; `return_type` is optional.

```ts
static {
    GObject.registerClass({
        GTypeName: 'MyEmitter',
        Signals: {
            'row-picked': { param_types: [GObject.TYPE_STRING, GObject.TYPE_INT] },
        },
    }, this);
}

// later
this.emit('row-picked', 'overview', 3);
this.connect('row-picked', (_self, id: string, index: number) => { /* … */ });
```

## Override a vfunc

`vfunc_*` overrides are ordinary instance methods. They can sit anywhere in the class body,
because they live on the prototype and are not affected by static evaluation order.

```ts
class Initable extends GObject.Object {
    vfunc_init(_cancellable: Gio.Cancellable | null): boolean {
        return true;
    }

    static {
        GObject.registerClass({ GTypeName: 'MyInitable', Implements: [Gio.Initable] }, this);
    }
}
```

## Subclass a registered class

Register each subclass with its own static block. If TypeScript reports *"property X does
not exist on Subclass"*, a missing `registerClass` on the subclass is the usual cause.

```ts
class Parent extends GObject.Object {
    parentMethod(): void { /* … */ }
    static { GObject.registerClass({ GTypeName: 'Parent' }, this); }
}

class Child extends Parent {
    childMethod(): void { /* … */ }
    static { GObject.registerClass({ GTypeName: 'Child' }, this); }
}
```

## Put the static block last

This is the one ordering rule that bites. `static` fields and static blocks run in source
order, so a metadata field written *below* the block is assigned after `registerClass` has
already read (and not found) it:

```ts
class Foo extends GObject.Object {
    static { GObject.registerClass(Foo); }        // runs FIRST
    static [GObject.interfaces] = [Gio.Initable]; // runs after, too late
    vfunc_init(): boolean { return true; }
}
// Gjs-CRITICAL: Could not find definition of virtual function init
```

The ordering itself is plain ECMAScript, so the bug is the same wherever you build. What
differs is only the message. On current GJS the error is thrown while the class declaration
is being evaluated, so the whole module fails to load; older GJS deferred the same error to
the first `.init()` call. Either way it is a source-ordering bug, not a missing API.

Two ways out, both fine:

```ts
// Preferred: metadata inline, so nothing can be assigned too late.
class Foo extends GObject.Object {
    vfunc_init(): boolean { return true; }
    static {
        GObject.registerClass({ GTypeName: 'Foo', Implements: [Gio.Initable] }, this);
    }
}

// Also works: every static field above the block.
class Bar extends GObject.Object {
    static [GObject.interfaces] = [Gio.Initable];
    vfunc_init(): boolean { return true; }
    static { GObject.registerClass(Bar); }
}
```

The second form is more fragile: a refactor that moves the field breaks it at runtime with
nothing at the type level to catch it. A working side-by-side demo of the broken and fixed
versions lives at
[`examples/gobject-static-block-ordering`](https://github.com/gjsify/ts-for-gir/tree/main/examples/gobject-static-block-ordering).

## Register without a static block

`registerClass` also takes an anonymous class and returns the registered constructor:

```ts
const Foo = GObject.registerClass(
    {
        GTypeName: 'Foo',
        Implements: [Gio.Initable],
        Properties: { /* … */ },
    },
    class extends GObject.Object {
        vfunc_init(): boolean { return true; }
    },
);
```

This form has the best type inference: property types from the `Properties` block show up on
instances, and `Foo.$gtype` is already typed as the registered class, so you never need the
`$gtype` annotation below. The cost is the anonymous class, which makes stack traces and
debugger names less helpful. Reach for it when you don't need to subclass `Foo`.
[`examples/gobject-register-class-inference`](https://github.com/gjsify/ts-for-gir/tree/main/examples/gobject-register-class-inference)
has it running with type assertions.

## When `$gtype` needs an annotation

Subclasses inherit `static $gtype: GObject.GType<GObject.Object>` from the base class,
because TypeScript does not narrow static-side `this`. **That is usually fine.** Anything
that takes a GType (`GObject.signal_lookup`, `Gio.ListStore`'s `item_type`, a
`Gtk.FileFilter.$gtype` argument) accepts the wider type without complaint.

You only need the annotation when you want the `T` in `GType<T>` back, typically for
narrowing:

```ts
class Foo extends GObject.Object {
    static override $gtype: GObject.GType<Foo>;
    static { GObject.registerClass({ GTypeName: 'Foo' }, this); }
}

if (GObject.type_is_a(x, Foo)) {
    // x is Foo, thanks to the annotation above
}
```

`override` tells TypeScript you are narrowing the base class declaration on purpose. At
runtime `registerClass` still sets the value; the declaration is type-level only. Don't add
it speculatively.

## Checklist

- [ ] `static { GObject.registerClass(...) }` is the last thing in the class body.
- [ ] Metadata goes inline: `registerClass({…}, this)`. If you use `static [GObject.*]`
      fields instead, every one of them sits above the block.
- [ ] `this` inside the static block, not the class name.
- [ ] Each subclass has its own `registerClass` call.
- [ ] `vfunc_*` overrides are plain instance methods, no `static`.
- [ ] `static override $gtype: GObject.GType<ThisClass>` only where you actually need the
      narrowed type.

## References

- [GNOME/gjs work_items/704](https://gitlab.gnome.org/GNOME/gjs/-/work_items/704) is the
  upstream report behind the ordering rule.
- [`examples/gobject-param-spec`](https://github.com/gjsify/ts-for-gir/tree/main/examples/gobject-param-spec)
- [`examples/gobject-register-class-inference`](https://github.com/gjsify/ts-for-gir/tree/main/examples/gobject-register-class-inference)
- [`examples/gobject-static-block-ordering`](https://github.com/gjsify/ts-for-gir/tree/main/examples/gobject-static-block-ordering)
- [Native Adwaita Apps](../../guides/native-adwaita-app/) puts these classes into a running
  application.
