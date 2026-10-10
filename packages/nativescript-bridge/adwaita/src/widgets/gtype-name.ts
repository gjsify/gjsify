// The GType name of a widget class, without trusting `Function.name`.
//
// A release build mangles class names (`AdwBin` -> `t`), and every lookup that read
// `constructor.name` then answered the mangler's spelling: `Gtk.Button().name` came back
// as `e`, and `elementFor('AdwBin')` refused the very class it had just resolved. The
// explicit spelling is GObject's own: `GObject.registerClass({ GTypeName: 'AdwBin' }, …)`
// names a class by metadata, not by its identifier. Here that metadata is the static
// `GTypeName` each widget class declares; it is a subset of GObject's, so a class that
// declares none (an application's subclass) is named by its `name`, as GObject falls back
// to the registered class's own.
//
// OWN property only: a static is inherited, and `class Mine extends AdwBin {}` is not an
// `AdwBin` — it would otherwise answer its parent's name.

export interface GTypeNamed {
    readonly GTypeName?: string;
    readonly name: string;
}

export function gtypeNameOf(ctor: GTypeNamed): string {
    if (Object.hasOwn(ctor, 'GTypeName') && typeof ctor.GTypeName === 'string') return ctor.GTypeName;
    return ctor.name;
}

/** {@link gtypeNameOf} for an instance. */
export function gtypeNameOfInstance(instance: object): string {
    return gtypeNameOf(instance.constructor as GTypeNamed);
}
