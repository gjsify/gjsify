// Which attachment an XML-inflated child asks for — the one rule every
// `_addChildFromBuilder` in this package shares.
//
// WHY IT EXISTS
//
// NativeScript's XML Builder hands a parent its children through ONE method:
// `_addChildFromBuilder(name, view)`. `name` is the complex-property name for
// `<AdwToolbarView.topBar>` and the plain ELEMENT name (`AdwHeaderBar`) for a
// bare child, and `LayoutBase`'s inherited implementation ignores it entirely and
// calls `addChild`. Every composed widget here builds its own internal boxes in
// its constructor and exposes `addTopBar` / `setContent` / `packStart` /
// `setChild` to reach them, so that inherited default drops an XML child into the
// layout's first cell instead — MEASURED on an Android emulator, 2026-08-28:
// `<AdwToolbarView.topBar>` and `<AdwToolbarView.content>` both landed at row 0
// and painted on top of each other, an `AdwHeaderBar` child left `startBox` empty,
// and an `AdwClamp` child left `child` null so the clamp never allocated.
//
// The name is therefore the whole decision, and it is the same decision in every
// widget that composes an internal tree: is this one of the slots I expose, or the
// default one? It started as four and is now nine classes across seven modules —
// which is the argument for one rule rather than a count. Keeping it here
// — free of `@nativescript/core` — is what lets the spec suite drive it off-device,
// where the widget classes cannot even be imported (their modules pull
// `@nativescript/core` at module scope).

/**
 * The slot an XML child asks for, or `fallback` when it asks for nothing this
 * widget knows.
 *
 * `slots` are the widget's own property names, because that is what NativeScript's
 * complex-property syntax spells: `<AdwToolbarView.topBar>` reaches
 * `_addChildFromBuilder('topBar', …)`. A bare `<AdwHeaderBar>` child arrives under
 * its ELEMENT name instead, which is never a slot name and so takes the fallback —
 * the same shape as GtkBuildable's untyped `<child>`.
 *
 * A dotted `name` is reduced to its last segment first. NativeScript already does
 * that before it calls us, but a caller that does not is the difference between
 * "no slot" and "the wrong slot", and this returns the answer to a question about
 * a widget's own tree.
 */
export function resolveBuilderSlot<Slot extends string, Fallback extends string>(
    name: unknown,
    slots: readonly Slot[],
    fallback: Fallback,
): Slot | Fallback {
    if (typeof name !== 'string') return fallback;
    const dot = name.lastIndexOf('.');
    const wanted = dot === -1 ? name : name.slice(dot + 1);
    return (slots as readonly string[]).includes(wanted) ? (wanted as Slot) : fallback;
}
