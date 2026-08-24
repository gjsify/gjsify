/**
 * The React JSX surface: React's OWN automatic runtime, our OWN element list.
 *
 * `./jsx-runtime` in this package deliberately THROWS from `jsx()`/`jsxs()`, and
 * that refusal is correct for the dialects it serves — Solid's reactivity lives in
 * what `babel-preset-solid` emits from `jsx: "preserve"`, and Vue's in its SFC
 * compiler, so an automatic runtime reaching those functions means the pipeline was
 * misconfigured and nothing would render. React is the opposite case and the
 * difference is structural rather than a matter of taste: React's `jsx()` builds a
 * plain, renderer-agnostic React ELEMENT (a `{type, props, key}` record), and the
 * host mapping happens later, in `react-reconciler`. So the automatic runtime is
 * exactly the right thing here, and it is React's own — reimplementing it would be
 * a second `createElement` to keep in step with React's element format.
 *
 * That is why this is a SEPARATE subpath instead of a change to `./jsx-runtime`:
 * one module cannot both refuse the automatic runtime (for Solid) and provide it
 * (for React). A consumer picks by pointing `jsxImportSource` at one or the other,
 * and TypeScript appends `/jsx-runtime` (`/jsx-dev-runtime` under
 * `jsx: "react-jsxdev"`) — hence two export keys beside `./react`. The tsconfig
 * recipe is in the package README.
 *
 * WHY NOT just `jsxImportSource: "react"`. Then the element list comes from
 * `@types/react`'s own `JSX.IntrinsicElements`, which is the 208-tag problem ADR
 * 0028 § 8 measured on Solid, one package over: every HTML, SVG and MathML tag
 * type-checks clean on a GTK renderer and then renders NOTHING. Declaring the
 * namespace here is what makes `<div/>` a `TS2339` naming the element.
 *
 * The element list itself is the generated `WidgetPropsByTag`/`WidgetClassByTag`,
 * which `scripts/check-type-surfaces.mjs` already holds negative-first through its
 * `jsx` half. The React-specific plumbing below has no half yet — that gap, and
 * why adding one is not a one-liner, is in `status/open-todos.md`. Its RUNTIME
 * half is `adapters/react.spec.ts`.
 */

import { jsx as reactJsx, jsxs as reactJsxs } from 'react/jsx-runtime';
import { jsxDEV as reactJsxDEV } from 'react/jsx-dev-runtime';
import type { Key, ReactElement, ReactNode, Ref } from 'react';

import type { WidgetClassByTag, WidgetPropsByTag } from './generated/props.js';
import type { RawSignalAttributes, SlotAttribute, WithOnce } from './attrs.js';

export { Fragment } from 'react/jsx-runtime';

/**
 * React's own factories, RE-TYPED over this package's element list.
 *
 * The functions are React's — identity matters, because they build React's
 * element format and a reimplementation would be a second one to keep in step.
 * Only the SIGNATURE is ours: `@types/react` types `type` as React's
 * `ElementType`, i.e. every HTML/SVG/MathML tag, so a direct call with a GTK tag
 * would be a type error while a JSX tag (checked against `JSX.IntrinsicElements`
 * below) would not. The cast is what makes the two agree.
 */
export const jsx = reactJsx as unknown as GtkJsxFactory;
export const jsxs = reactJsxs as unknown as GtkJsxFactory;
export const jsxDEV = reactJsxDEV as unknown as GtkJsxDevFactory;

/** What may stand in a JSX tag position here: a GTK tag or a component. */
export type GtkElementType = keyof GtkReactIntrinsicElements | ((props: never) => ReactNode);

type GtkJsxFactory = (type: GtkElementType, props: unknown, key?: Key) => ReactElement;
type GtkJsxDevFactory = (
    type: GtkElementType,
    props: unknown,
    key: Key | undefined,
    isStatic: boolean,
    source?: unknown,
    self?: unknown,
) => ReactElement;

/**
 * Per-element attributes React needs on top of the GObject properties.
 *
 * Deliberately not `JsxAttributes` from `./attrs.js`: that one types `ref` as
 * `T | ((el: T) => void)`, which is Solid's spelling. React's `ref` additionally
 * accepts a `useRef` object, so a shared type would reject the single most common
 * way a React author holds a widget.
 *
 * `ref`, `children` and `key` are declared per element rather than left to
 * `JSX.IntrinsicAttributes`, which TypeScript unions into the attributes of a
 * COMPONENT and not of an intrinsic element — measured in ADR 0028 § 8: an
 * undeclared `ref` is TS2322 and an undeclared `children` makes every nested
 * element TS2559. `children` must also be optional, or a self-closing tag is
 * TS2741.
 */
export interface ReactWidgetAttributes<T> extends SlotAttribute, RawSignalAttributes {
    children?: ReactNode;
    ref?: Ref<T> | undefined;
    key?: Key | null | undefined;
}

/** Every GTK/Adwaita tag, with its properties, its handlers, its `ref` and its `key`. */
export type GtkReactIntrinsicElements = {
    [K in keyof WidgetPropsByTag]: WithOnce<WidgetPropsByTag[K]> & ReactWidgetAttributes<WidgetClassByTag[K]>;
};

export namespace JSX {
    /**
     * DELIBERATELY NOT `HostNode`, and not to be made "consistent" with the Solid
     * surface next door.
     *
     * `jsx-runtime.ts` declares `Element = HostNode`, because Solid's control-flow
     * components (`<For>`, `<Index>`, `<Show>`) are typed against host nodes and the
     * first `<For>` in an application was otherwise a type error. React's is
     * `ReactElement` because that is what a React JSX expression evaluates to: `jsx()`
     * builds a renderer-agnostic element record and the host mapping happens later, in
     * the reconciler. React's control flow is plain JavaScript, not typed components,
     * so nothing here needs a host node in that position.
     *
     * The two files therefore answer two different questions and will keep disagreeing
     * on this line. That is the design, which is why it is written down at the line
     * rather than left to be rediscovered by whoever reaches for the one-line fix.
     */
    export type Element = ReactElement;
    export type ElementType = GtkElementType;
    /** Names the prop children arrive on — without it, nesting is an error. */
    export interface ElementChildrenAttribute {
        children: Record<never, never>;
    }
    /** What React itself adds to every element, intrinsic or component. */
    export interface IntrinsicAttributes {
        key?: Key | null | undefined;
    }
    export interface IntrinsicElements extends GtkReactIntrinsicElements {}
}
