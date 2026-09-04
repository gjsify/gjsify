// The attribute machinery the two dialect surfaces share.
//
// Everything in here is HAND-WRITTEN on purpose: it is the part of the surface
// that belongs to the FRAMEWORK rather than to GTK, and each member is here
// because a measurement said the surface is unusable without it.

import type GObject from '@girs/gobject-2.0';
import type { AdwMenuInput } from '@gjsify/adwaita-core';

import type { HostNode } from './types.js';

/**
 * A `notify::` handler.
 *
 * The host strips the emitting object (`next(...args.slice(1))` in `signals.ts`),
 * so what reaches the callback is the ParamSpec alone. Declared HERE rather than in
 * the generated file because it is the same for every property in GTK — and because
 * a generator that emitted it would have to import GObject for a type that has
 * nothing to do with the GIR it read.
 */
export type NotifyHandler = (pspec: GObject.ParamSpec) => void;

declare const outParam: unique symbol;

/**
 * A signal parameter GIR declares `out`/`inout` with `caller-allocates="0"`.
 *
 * GJS still passes an argument in that position, and what it holds is whatever
 * was in the memory the marshaller allocated: measured on gjs 1.88.1 / GTK
 * 4.22.4, a handler on `Gtk.SpinButton::input` receives `new_value` as
 * `6.9526682391035e-310`, and one on `Gtk.Editable::insert-text` receives
 * `position` as `1711500784`. Both arrive as ordinary numbers. Nothing warns.
 *
 * So the slot is DECLARED — dropping it would silently shift every parameter
 * after it — and given a type nothing can be read out of, and nothing but
 * itself assigns to. Annotating the parameter `number` is then a compile error
 * naming the position, which is the only place a reader would have looked.
 *
 * `caller-allocates="1"` is a different thing and keeps its real type: there the
 * callee is handed a live object to FILL, as `Gtk.Overlay::get-child-position`
 * is handed a `Gdk.Rectangle`.
 */
export type OutParam = { readonly [outParam]: never };

// NOT emitted by the generator any more. Signal signatures are `@girs`'
// `SignalSignatures` since the vocabulary migration (ADR 0029 § Amendment), so how an
// out parameter is spelled is answered there. Kept because the rule above is a fact
// about GJS rather than about this generator, and a consumer writing a signature by
// hand still needs it. If `@girs` turns out to spell one `number`, that is a defect to
// report upstream, not a reason to re-derive the type here.

/**
 * What may appear as a child, mirroring Solid's own `JSX.Element`.
 *
 * The shape is copied from `solid-js/types/jsx.d.ts` because a renderer's element
 * union is not a free choice: a string, a number and a boolean are all legal
 * children there, an array of children is legal recursively, and a FUNCTION is
 * not. Substituting our host node for the DOM's `Node` is the only change.
 */
export type ElementChild = HostNode | ElementChildren | string | number | boolean | null | undefined;

export interface ElementChildren extends Array<ElementChild> {}

/**
 * Add the `.once` spelling of every event prop, without generating 2× the members.
 *
 * `signals.ts` accepts `onClickedOnce` for every `onClicked`, including every
 * `onNotifyFooOnce`, which would be another ~1000 generated members. A mapped type
 * derives them from the interface instead — including the ones a consumer adds by
 * declaration merging.
 */
export type WithOnce<T> = T & {
    [K in keyof T & string as K extends `on${string}` ? `${K}Once` : never]?: T[K];
};

/** Which of a container's slots this child goes into. Read by `setSlot()`. */
export interface SlotAttribute {
    slot?: string | null;
}

/**
 * The `on:<raw-signal-name>` escape hatch, typed.
 *
 * `parseEventProp` takes `on:` + a signal name verbatim, which is how a signal
 * whose name resists the camelCase derivation gets bound at all. The handler type
 * is deliberately the widest one that is not `any`: parameters of `never` accept
 * a handler declared with any parameters, so nothing a consumer writes is refused.
 * An inline arrow's parameter arrives as `never` here, which is the price of an
 * escape hatch that carries no signal-specific knowledge.
 */
export interface RawSignalAttributes {
    [key: `on:${string}`]: ((...args: never[]) => unknown) | undefined;
}

/**
 * Per-element attributes a JSX dialect needs on top of the GObject properties.
 *
 * `ref` and `children` MUST be real members of the element's own props. Measured:
 * TypeScript unions `JSX.IntrinsicAttributes` into the attributes of a COMPONENT
 * and not of an intrinsic element, so a `ref` that is not declared here is
 * rejected outright (TS2322) — and `children` that is not declared makes every
 * nested element an error (TS2559). `children` must also be OPTIONAL: a required
 * one makes `<gtk-box/>` an error (TS2741).
 *
 * `T` is the widget's own instance type, so `ref={(el) => …}` infers `el` as
 * `Gtk.Box` rather than the `unknown` a DOM renderer settles for.
 */
export interface JsxAttributes<T> extends SlotAttribute, RawSignalAttributes {
    children?: ElementChild;
    ref?: T | ((el: T) => void) | undefined;
}

/**
 * Per-element attributes for Vue.
 *
 * Deliberately NOT `JsxAttributes`: Vue supplies `ref` and `key` itself through
 * `VNodeProps`, which every registered component's props are intersected with.
 * Declaring our own `ref` would intersect two different `ref` types and could
 * leave the property unusable, so the Vue surface adds only what Vue does not —
 * and `children` is a SLOT in Vue, never a prop.
 */
export interface VueAttributes extends SlotAttribute, RawSignalAttributes {}

/**
 * The properties whose GObject type is a `GMenuModel`, in both spellings.
 *
 * A NAME LIST, not a type test, and the reason is measured rather than stylistic: the
 * obvious `Gio.MenuModel extends NonNullable<T[K]> ? …` also matches every property
 * typed as a wider GObject — `Gio.MenuModel extends GObject.Object` is TRUE — so the
 * widening would leak onto properties that take an entirely different object. The three
 * names below are the whole set on the shipped table (`menu-model` on the two menu
 * buttons, the popover menu and the menu bar; `extra-menu` on the text widgets;
 * `secondary-menu` on `AdwToolbarView`'s header bar), and `type-tests/` holds the
 * widening against real markup in both dialects.
 */
type MenuModelProp = 'menuModel' | 'menu-model' | 'extraMenu' | 'extra-menu' | 'secondaryMenu' | 'secondary-menu';

/**
 * A props interface with every `GMenuModel` property widened to accept the PORTABLE
 * menu model as well (ADR 0042).
 *
 * `Gio.MenuModel` is a GObject with no literal spelling, so before this a declarative
 * dialect could not express a menu at all — the website gallery refused a Solid, Vue and
 * React snippet for `Adw.SplitButton`, `Gtk.MenuButton` and `Gtk.PopoverMenu` for
 * exactly that reason. The runtime half is `coerce`'s `GMenuModel` branch, which turns
 * an authored array into a real `Gio.Menu` at the ParamSpec seam; this is the type that
 * lets the array be written.
 *
 * A widget with NO such property is returned unchanged: `Omit` over a key it has not got
 * is a no-op, and `MenuModelProp & keyof T` is then empty, so nothing is added either.
 */
export type WithPortableMenu<T> = Omit<T, MenuModelProp> & {
    [K in MenuModelProp & keyof T]?: T[K] | AdwMenuInput;
};
