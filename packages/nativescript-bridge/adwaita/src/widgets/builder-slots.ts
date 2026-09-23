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
// its constructor and exposes `add_top_bar` / `set_content` / `pack_start` /
// `set_child` to reach them, so that inherited default drops an XML child into the
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
 * Every name a widget's `_addChildFromBuilder` answers to — its own slots and the
 * fallback, in one list.
 *
 * WHY A WIDGET DECLARES THEM AT ALL, when {@link resolveBuilderSlot} already routes:
 * routing is total by design, so an XML child naming a slot this widget does not have
 * takes the fallback and lands somewhere plausible, silently — which is exactly right
 * for a bare `<AdwHeaderBar>` child arriving under its ELEMENT name, and exactly wrong
 * for a tree that AUTHORED a placement. A builder realising an authored tree has to be
 * able to ask, before the write, whether the name means anything here; the answer is
 * the widget's own, so it lives on the widget rather than in a table beside it.
 *
 * The fallback is IN the list: it is a name this widget honours — `content` on a
 * toolbar view, `row` on an expander — and a caller that spells it deliberately gets
 * the placement it asked for rather than a refusal.
 */
export function builderSlotsOf<Slot extends string, Fallback extends string>(
    slots: readonly Slot[],
    fallback: Fallback,
): readonly (Slot | Fallback)[] {
    return (slots as readonly (Slot | Fallback)[]).includes(fallback) ? slots : [...slots, fallback];
}

/** A widget class that declares {@link builderSlotsOf} — read by the shared-tree builder. */
export interface BuilderSlotDeclaring {
    readonly builderSlots: readonly string[];
}

/**
 * The slots a widget CLASS declares, or `null` when it declares none.
 *
 * `null` and an empty list are different answers: a class with no declaration cannot be
 * asked, so the builder refuses every authored slot for it rather than inventing one.
 */
export function declaredBuilderSlots(ctor: unknown): readonly string[] | null {
    const slots = (ctor as Partial<BuilderSlotDeclaring> | undefined)?.builderSlots;
    return Array.isArray(slots) ? slots : null;
}

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

/**
 * A widget class that declares which of its properties hold ANOTHER OBJECT of the tree,
 * named by id — read by the shared-tree builder.
 *
 * WHY A DECLARATION, when the builder could look for a string that matches an id: a projected
 * `.blp` carries `stack: stack` as the prop `stack` holding the STRING `"stack"`, exactly as it
 * carries `name: "inbox"` — the projection keeps the value and drops the type. GtkBuilder tells
 * the two apart by the property's `GParamSpec` (an object pspec resolves the id, deferred to
 * the end of the parse so a reference may point forward), and a runtime without GI has no
 * pspec to ask. So the widget says which of its properties are object-valued, and the builder
 * resolves exactly those — never a `name` that happens to equal an id.
 */
export interface BuilderReferenceDeclaring {
    readonly builderReferences: readonly string[];
}

/**
 * The object-valued properties a widget CLASS declares, as the camelCase names its accessors
 * carry; an empty list when it declares none.
 */
export function declaredBuilderReferences(ctor: unknown): readonly string[] {
    const references = (ctor as Partial<BuilderReferenceDeclaring> | undefined)?.builderReferences;
    return Array.isArray(references) ? references : [];
}
