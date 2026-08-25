// THE REACT-SPECIFIC PLUMBING — the half of this surface nothing measured.
//
// `src/react-jsx-runtime.ts` declares its own `JSX` namespace, and four of its
// members are React's rather than this repository's: `Element` is a
// `ReactElement`, `ElementType` is `GtkElementType`, `IntrinsicAttributes` carries
// only `key`, and `ref`/`children` are React's `Ref<T>`/`ReactNode` spellings. The
// ADR-0028 § 8 measurements those four answer were taken on the SOLID surface, one
// file over, and re-derived here by READING. This file re-measures them.
//
// Grammar and mechanism: see the header of `negative-tags.tsx`.
//
// NOTHING IN THIS FILE IMPORTS `react`, AND THAT IS LOAD-BEARING FOR THE PROBES.
// `@types/react` declares a GLOBAL `JSX` namespace, so the moment any file in the
// program imports React's types, all 208 tags it pre-declares become the fallback
// surface — and probe `evaporate`, which takes `jsxImportSource` away, would land
// on React's element list instead of on nothing at all. Measured: with a `react`
// type import present, `evaporate` silences 1 of 8 assertions; without it, 6 of 8.
// The two React types this file needs (`RefObject`, `ReactNode`) are therefore
// spelled STRUCTURALLY below; the positives, which no probe compiles, use React's
// own API.
//
// `HostNode` comes in RELATIVELY, and the depth is what makes it work in both
// programs: this directory and the script's stripped-copy directory
// (`<pkg>/tmp/type-surfaces`) are both two levels under the package root. If that
// ever stops holding, the baseline run reports a `TS2307` no directive covers and
// fails — the mechanism reports itself rather than silently checking less.

import type Gtk from '@girs/gtk-4.0';

import type { HostNode } from '../../src/types.js';

/**
 * `JSX.Element` is React's `ReactElement` and deliberately NOT a `HostNode`.
 *
 * The Solid surface next door declares `Element = HostNode`, because Solid's
 * control-flow components are typed against host nodes and the first `<For>` in an
 * application was otherwise a type error. React's control flow is plain JavaScript,
 * and its `jsx()` builds a renderer-agnostic element record whose host mapping
 * happens later, in `react-reconciler`. The two files answer different questions
 * and will keep disagreeing on this line, which is why the disagreement is
 * ASSERTED rather than left to whoever reaches for the one-line "consistency" fix.
 */
// @ts-expect-error TS2322 — a React JSX expression is a ReactElement, never a host node
export const notAHostNode: HostNode = <gtk-box />;

/**
 * Only a GTK tag or a component may stand in a tag position.
 *
 * `needs=none`: TS2604 comes from TypeScript's own "a tag must be callable" rule
 * and holds with no JSX surface at all — measured, it is one of the two assertions
 * that survive `evaporate`. So this pins the tag position being CHECKED, not
 * `JSX.ElementType` narrowing it; that narrowing is asserted from the positive
 * side, where `positive-element-is-react.tsx` puts a function component in a tag
 * position and only `ElementType` admitting `(props) => ReactNode` lets it compile.
 */
declare const NotAComponent: { nope: true };
// @ts-expect-error TS2604 needs=none — a tag position takes a tag or a function, nothing else
export const nonComponentTag = <NotAComponent />;

/**
 * `IntrinsicAttributes` carries `key` and NOTHING else.
 *
 * TypeScript unions it into the attributes of a COMPONENT and not of an intrinsic
 * element — the measured reason `ref`, `children` and `key` are declared per
 * element in `ReactWidgetAttributes` instead. A component therefore gets `key` for
 * free (`positive-element-is-react.tsx`) and nothing more: an `IntrinsicAttributes`
 * that had grown a catch-all would accept every misspelled prop on every component
 * in a consumer's tree, in silence.
 */
declare function TakesNoProps(): null;
// @ts-expect-error TS2322 — IntrinsicAttributes adds `key`, not an escape hatch
export const unknownComponentProp = <TakesNoProps nope={1} />;

/**
 * React's `ref` is `Ref<T>` — a callback OR a `useRef`/`createRef` object — and the
 * `T` is the element's own widget class.
 *
 * This is exactly why the React surface does not reuse `JsxAttributes` from
 * `./attrs.js`: that one types `ref` as `T | ((el: T) => void)`, Solid's spelling,
 * which rejects the single most common way a React author holds a widget. The
 * OBJECT form is what this negative exercises, and it is per element — the
 * diagnostic names `Ref<Box>` itself, so the structural stand-in below reaches the
 * same type React's `RefObject<Gtk.Button>` would.
 */
declare const buttonRef: { readonly current: Gtk.Button | null };
// @ts-expect-error TS2322 — Ref<T> is per element; a Gtk.Button ref cannot hold a Gtk.Box
export const wrongRefTarget = <gtk-box ref={buttonRef} />;

/** `children` is React's `ReactNode`, not an arbitrary value. */
// @ts-expect-error TS2353 — an object literal is not a ReactNode
export const badChild = <gtk-box children={{ deep: 'wrong' }} />;
