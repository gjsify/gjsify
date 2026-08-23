// The attribute machinery the two dialect surfaces share.
//
// Everything in here is HAND-WRITTEN on purpose: it is the part of the surface
// that belongs to the FRAMEWORK rather than to GTK, and each member is here
// because a measurement said the surface is unusable without it.

import type GObject from '@girs/gobject-2.0';

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
