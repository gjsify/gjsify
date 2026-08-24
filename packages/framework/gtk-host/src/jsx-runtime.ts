/**
 * The JSX surface — our OWN jsx-runtime, and the measurement that made that the
 * only option.
 *
 * The obvious alternative is to augment Solid's namespace:
 * `declare module 'solid-js' { namespace JSX { interface IntrinsicElements … } }`.
 * Measured, that leaves all 208 tags Solid pre-declares (113 HTML + 4 deprecated
 * HTML + 59 SVG + 32 MathML) valid on a GTK renderer: `<div/>` and `<circle/>`
 * type-check clean and then render NOTHING, silently. Closing them needs 208
 * `never` overrides and produces `Type '{}' is not assignable to type 'never'`
 * instead of "no such element". With our own runtime, `<div/>` is
 * `TS2339: Property 'div' does not exist on type 'JSX.IntrinsicElements'`.
 *
 * TWO CONFIGURATION FACTS A CONSUMER MUST KNOW, both measured:
 *
 *  - `jsxImportSource` must point here, and `noImplicitAny` must be ON. With
 *    `jsx: "preserve"`, no `jsxImportSource` and `noImplicitAny` off, every JSX
 *    element is implicitly `any` and `tsc` exits 0 having checked NOTHING — the one
 *    configuration in which this whole surface evaporates in silence.
 *  - `jsx: "react"` is refused outright (TS5089); `preserve` (what
 *    babel-preset-solid needs) and `react-jsx` both work.
 *
 * AND ONE HOLE THAT CANNOT BE CLOSED: TypeScript exempts every HYPHENATED JSX
 * attribute from excess-property checking, so `<gtk-box no-such={1}/>` is accepted
 * — on intrinsics and on components alike. Three index-signature shapes were tried
 * (`\`${string}-${string}\`` mapped to `unknown`, to `never`, and to a subtracted
 * union); all three either changed nothing or collided with the declared kebab
 * keys (TS2411). The camelCase spelling of every property IS checked, which is why
 * both spellings are generated and camelCase is the one to prefer.
 */

import type { JsxAttributes, WithOnce } from './attrs.js';
import type { HostNode } from './types.js';
import type { WidgetClassByTag, WidgetPropsByTag } from './generated/props.js';

/** Every GTK/Adwaita tag, with its properties, its handlers and its `ref`. */
export type GtkIntrinsicElements = {
    [K in keyof WidgetPropsByTag]: WithOnce<WidgetPropsByTag[K]> & JsxAttributes<WidgetClassByTag[K]>;
};

export namespace JSX {
    /**
     * The type of a JSX EXPRESSION — a host node, not `ElementChild`.
     *
     * It was `ElementChild` (`HostNode | ElementChildren | string | number |
     * boolean | null | undefined`), which reads like the right answer because that
     * is what may be PASSED as a child. It is not what a JSX element evaluates
     * TO: the compiler's `createElement` returns a node, always.
     *
     * The imprecision was not cosmetic. `<For>`, `<Index>` and `<Show>` are typed
     * in `adapters/solid.ts` against `HostNode` — deliberately, because Solid's own
     * signatures pin `JSX.Element` to the DOM's `Element` — so with `Element` this
     * wide the FIRST `<For>` in any application failed with
     * `Type 'ElementChild' is not assignable to type 'HostNode'`, and the whole
     * control-flow surface was untypeable. Found by the first real JSX app
     * (`showcases/gtk/solid-host-counter`); the fixtures in `type-tests/jsx/` had
     * never used a control-flow component, which is why they went green over it.
     * `positive-control-flow.tsx` is that gap closed.
     *
     * Children stay wide: they are typed by `JsxAttributes.children`, not by this.
     */
    export type Element = HostNode;
    /** Names the prop children arrive on — without it, nesting is an error. */
    export interface ElementChildrenAttribute {
        children: Record<never, never>;
    }
    export interface IntrinsicElements extends GtkIntrinsicElements {}
}

/**
 * The runtime half, which exists to REFUSE rather than to work.
 *
 * `jsx: "react-jsx"` type-checks against this surface, and TypeScript then emits
 * calls to these functions. Nothing here can build a GTK tree: Solid's reactivity
 * lives in the compiler output that `babel-preset-solid` generates, and Vue's in
 * its own renderer. So the automatic runtime fails at the call with the setting to
 * change, rather than rendering an empty window.
 */
const AUTOMATIC_RUNTIME_UNSUPPORTED =
    '@gjsify/gtk-host/jsx-runtime is a TYPE surface, not an automatic JSX runtime. ' +
    'Set "jsx": "preserve" and compile with babel-preset-solid (Solid) or the Vue SFC ' +
    'compiler (Vue) — those emit the renderer calls. With "jsx": "react-jsx" TypeScript ' +
    'emits jsx()/jsxs() calls instead, and no GTK tree can come out of them.';

export function jsx(): never {
    throw new Error(AUTOMATIC_RUNTIME_UNSUPPORTED);
}

export function jsxs(): never {
    throw new Error(AUTOMATIC_RUNTIME_UNSUPPORTED);
}

export function jsxDEV(): never {
    throw new Error(AUTOMATIC_RUNTIME_UNSUPPORTED);
}

export function Fragment(): never {
    throw new Error(AUTOMATIC_RUNTIME_UNSUPPORTED);
}
