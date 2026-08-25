// WHAT A REACT JSX EXPRESSION EVALUATES TO, and what React itself adds to it.
//
// `positive.tsx` next door asserts what may go IN. This file asserts what comes
// OUT and what surrounds it — the four members of the `JSX` namespace that are
// React's rather than this repository's. `negative-react-plumbing.tsx` holds the
// same four from the other side; both directions are needed, because a surface
// that refuses everything scores perfect on negatives alone.

import { Fragment, type ReactElement, type ReactNode } from 'react';

/** A JSX element IS a `ReactElement` — `JSX.Element` says so. */
export const element: ReactElement = <gtk-label label="a label" />;

/** …and therefore a `ReactNode`, which is what `children` is typed as. */
declare function render(node: ReactNode): void;
render(<gtk-button label="Go" />);

/**
 * A component in a tag position, with `key` supplied by `IntrinsicAttributes`.
 *
 * `key` is NOT declared on this component's props. TypeScript unions
 * `JSX.IntrinsicAttributes` into the attributes of a component, so this is exactly
 * the one prop it may add — and `negative-react-plumbing.tsx` asserts it adds
 * nothing else.
 */
function Caption({ text }: { readonly text: string }): ReactElement {
    return <gtk-label label={text} />;
}
export const composed = <Caption text="composed" key="only-child" />;

/** `key` on an INTRINSIC element, which `IntrinsicAttributes` does not reach. */
export const keyedIntrinsic = <gtk-label label="x" key="k" />;

/**
 * The fragment, in both spellings.
 *
 * `<>…</>` compiles to the `Fragment` export of `<jsxImportSource>/jsx-runtime`,
 * which is why that module re-exports React's own rather than declaring one: the
 * export NAME is the framework's contract, and a rename is a `MISSING_EXPORT` in a
 * consumer's build.
 */
export const shorthand = (
    <>
        <gtk-label label="one" />
        <gtk-label label="two" />
    </>
);
export const explicit = (
    <Fragment>
        <gtk-label label="one" />
    </Fragment>
);
