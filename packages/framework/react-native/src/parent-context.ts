// The one React carrier for the one parameter L2 takes as plain data.
//
// `ChildContext` is L2's — the four facts a child needs about its parent
// (`intents.ts`) — and this module is React's way of moving it down a tree. It lives
// on its own rather than inside `components.ts` because a SECOND thing needs it: a
// list row is the root of its own React root, and a root with no published parent
// makes `flex-1` inside `renderItem` a named refusal ("this element is the root of its
// tree"), which is right for a real root and wrong for a row that has a box above it.
//
// ADR 0032 § 6 asks anyone touching this to be able to say what it is and is not: it
// is a CARRIER, not the mechanism. A Vue adapter would use `provide`/`inject`, the
// Solid adapter uses a context holding an accessor, and an attach-time resolver in the
// host would read the shadow tree. All four call the same `resolvePrimitive(name,
// props, { parent })`, and none of them can see the others' carrier.

import { createContext, createElement, type ReactElement, type ReactNode } from 'react';

import type { ChildContext } from './primitives/resolve.js';

/** `null` at a root, which is what makes an unresolvable `flex-1` there a refusal. */
export const ParentContext = createContext<ChildContext | null>(null);

/**
 * Publish `value` to everything rendered inside.
 *
 * A named component rather than `ParentContext.Provider` at each call site, so the
 * two places that publish a context (an element's own children, and a list row's
 * fresh root) spell it the same way.
 */
export function ParentProvider(props: { readonly value: ChildContext; readonly children?: ReactNode }): ReactElement {
    return createElement(ParentContext.Provider, { value: props.value }, props.children);
}
